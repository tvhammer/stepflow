#!/usr/bin/env node
/**
 * stepflow CLI
 *   stepflow list
 *   stepflow run <template> [-p NAME=value]... [--input text | --input-file f] [--dry-run]
 *   stepflow resume <runId> [--approve | --revise "feedback" | --abort]
 *   stepflow status [runId]
 * At a human gate the run is saved, instructions are printed, and the process exits.
 */
import { parseArgs } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runWorkflow, newState, loadTemplates, listRuns, loadRun, saveRun, writeArtifact, runShell,
  runsDir,
} from "../../index.ts";
import type { Hooks, Template, RunState, GateDecision } from "../../index.ts";

const BUILTIN = join(dirname(fileURLToPath(import.meta.url)), "../../../templates");
const { values: o, positionals: pos } = parseArgs({
  allowPositionals: true,
  options: {
    param: { type: "string", short: "p", multiple: true },
    input: { type: "string", short: "i" },
    "input-file": { type: "string" },
    cwd: { type: "string" },
    "dry-run": { type: "boolean" },
    approve: { type: "boolean" },
    revise: { type: "string" },
    abort: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});
const cwd = resolve(o.cwd ?? process.cwd());
const [cmd, arg] = pos;
const die = (m: string): never => { console.error(m); process.exit(1); };
const templates = () => loadTemplates([join(cwd, ".stepflow", "templates"), join(cwd, "workflows"), BUILTIN]);

function usage() {
  console.log(`Usage:
  stepflow list
  stepflow run <template> [-p NAME=value]... [--input text | --input-file file] [--dry-run] [--cwd dir]
  stepflow resume <runId> [--approve | --revise "feedback" | --abort]
  stepflow status [runId]`);
}

function describe(t: Template) {
  const ps = Object.entries(t.params ?? {}).map(([k, d]) => `      ${k}${d.default ? `=${d.default}` : ""}${d.required === false || d.default ? "" : " (required)"} ${d.description ?? ""}`);
  return `  ${t.name} – ${t.description ?? ""}${ps.length ? "\n" + ps.join("\n") : ""}`;
}

async function makeHooks(id: string, dry: boolean): Promise<Hooks> {
  let runStep: Hooks["runStep"];
  if (dry) runStep = async ({ step, model, prompt }) => {
    console.log(`\n[dry-run ${step.id}] model=${model ?? "default"}\n${prompt}`);
    return step.output ? JSON.stringify({ verdict: "pass", notes: "dry" }) : `(dry-run output of ${step.id})`;
  };
  else runStep = await (await import("../pi/steps.ts")).createStepRunner(cwd);

  return {
    runStep,
    runShell: dry
      ? async ({ command }) => { console.log(`\n[dry-run shell] ${command}`); return { exitCode: 0, output: "" }; }
      : async ({ command }) => runShell(command, cwd),
    async askHuman() { return { action: "pause" }; },
    onEvent: (e) => {
      if (e.type === "step:start") console.log(`▶ ${e.stepId}`);
      if (e.type === "step:done") console.log(`✓ ${e.stepId}`);
      if (e.type === "step:skip") console.log(`– ${e.stepId} (skipped)`);
      if (e.type === "loop:limit") console.log(`! loop limit reached at '${e.stepId}'`);
    },
    onOutput: (stepId, v, n) => { writeArtifact(cwd, id, stepId, n, v); },
    onState: (s) => saveRun(cwd, id, s),
  };
}

async function drive(t: Template, state: RunState, id: string, dry: boolean) {
  const s = await runWorkflow(t, state, await makeHooks(id, dry));
  if (s.status === "paused") {
    const gate: any = t.steps[s.cursor];
    const n = gate.show ? s.history[gate.show]?.length : 0;
    const dir = join(runsDir(cwd), id);
    console.log(`\n⏸  Paused at human checkpoint '${gate.id}' (run ${id})`);
    console.log(`\nWhat to do:`);
    console.log(`  ${gate.instructions ?? "Review the output, then decide."}`);
    if (gate.show) console.log(`  Review: ${join(dir, `${gate.show}-${n}.md`)}`);
    console.log(`  Artifacts: ${dir}/`);
    console.log(`\nWhen you are done, resume with one of:`);
    console.log(`  stepflow resume ${id} --approve`);
    console.log(`  stepflow resume ${id} --revise "what should change"`);
    console.log(`  stepflow resume ${id} --abort`);
    if (o.cwd) console.log(`  (add --cwd ${cwd})`);
    process.exit(0);
  }
  console.log(`\nRun ${id}: ${s.status}`);
  console.log(`Outputs: ${join(runsDir(cwd), id)}/`);
}

if (o.help || !cmd) { usage(); process.exit(cmd ? 0 : 1); }

if (cmd === "list") {
  console.log(templates().map(describe).join("\n") || "No templates");
} else if (cmd === "run") {
  const t = templates().find((x) => x.name === arg) ?? die(`Unknown template '${arg}'. Try: stepflow list`);
  const params: Record<string, string> = {};
  for (const kv of o.param ?? []) {
    const i = kv.indexOf("=");
    if (i < 1) die(`Bad --param '${kv}', expected NAME=value`);
    params[kv.slice(0, i)] = kv.slice(i + 1);
  }
  const input = o["input-file"] ? readFileSync(o["input-file"], "utf8") : (o.input ?? "");
  let state: RunState;
  try { state = newState(t, input, params); } catch (e) { die((e as Error).message + "\n\n" + describe(t)); }
  const id = `${t.name}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  console.log(`Run ${id}`);
  await drive(t, state, id, !!o["dry-run"]);
} else if (cmd === "resume") {
  if (!arg) die("Usage: stepflow resume <runId> [--approve | --revise text | --abort]");
  const state = loadRun(cwd, arg);
  const t = templates().find((x) => x.name === state.template) ?? die(`Template '${state.template}' not found`);
  if (state.status === "done" || state.status === "aborted") die(`Run is already ${state.status}`);
  let d: GateDecision | undefined;
  if (o.approve) d = { action: "approve" };
  else if (o.abort) d = { action: "abort" };
  else if (o.revise !== undefined) d = { action: "revise", feedback: o.revise };
  if (state.status === "paused" && !d) die("This run is waiting at a human checkpoint. Add --approve, --revise \"...\" or --abort.");
  state.decision = d;
  // Human edits to the reviewed artifact are picked up on approve (string outputs only).
  const gate: any = t.steps[state.cursor];
  if (d?.action === "approve" && gate?.show && typeof state.outputs[gate.show] === "string") {
    const f = join(runsDir(cwd), arg, `${gate.show}-${state.history[gate.show].length}.md`);
    if (existsSync(f)) {
      const edited = readFileSync(f, "utf8");
      if (edited !== state.outputs[gate.show]) {
        console.log(`Using your edited version of ${gate.show}`);
        state.outputs[gate.show] = edited;
        state.history[gate.show][state.history[gate.show].length - 1] = edited;
      }
    }
  }
  await drive(t, state, arg, !!o["dry-run"]);
} else if (cmd === "status") {
  const runs = arg ? [{ id: arg, state: loadRun(cwd, arg) }] : listRuns(cwd);
  for (const r of runs) {
    const step: any = templates().find((x) => x.name === r.state.template)?.steps[r.state.cursor];
    console.log(`${r.id}  ${r.state.status}${r.state.status === "paused" ? ` at '${step?.id}'` : ""}`);
  }
  if (!runs.length) console.log("No runs");
} else usage();
