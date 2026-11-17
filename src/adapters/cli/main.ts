#!/usr/bin/env node
/**
 * stepflow CLI
 *   stepflow list
 *   stepflow run <template> [-p NAME=value]... [--input text | --input-file f] [--dry-run]
 *   stepflow resume <runId> [--approve | --revise "feedback" | --abort]
 *   stepflow resume <runId> --revise "feedback" --to <step>   (gates with reviseOptions)
 *   stepflow chat <runId>      discuss the open gate with pi; it can write decision.json for a later plain `resume`
 *   stepflow status [runId]
 * At a human gate the run is saved, instructions are printed, and the process exits.
 */
import { parseArgs } from "node:util";
import { readFileSync, existsSync, renameSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runWorkflow, newState, dryRunProblem, loadTemplates, findTemplate, templateDirs, listRuns, loadRun, saveRun, writeArtifact, runShell,
  runsDir,
} from "../../index.ts";
import type { Hooks, Template, RunState, GateDecision } from "../../index.ts";

const BUILTIN = join(dirname(fileURLToPath(import.meta.url)), "../../../examples");
const { values: o, positionals: pos } = parseArgs({
  allowPositionals: true,
  options: {
    param: { type: "string", short: "p", multiple: true },
    input: { type: "string", short: "i" },
    "input-file": { type: "string" },
    cwd: { type: "string" },
    templates: { type: "string", short: "t", multiple: true },
    "dry-run": { type: "boolean" },
    approve: { type: "boolean" },
    revise: { type: "string" },
    to: { type: "string" },
    abort: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});
const cwd = resolve(o.cwd ?? process.cwd());
const [cmd, arg] = pos;
const die = (m: string): never => { console.error(m); process.exit(1); };
const templates = () => loadTemplates(templateDirs(cwd, BUILTIN, o.templates));

function usage() {
  console.log(`Usage:
  stepflow list
  stepflow run <template> [-p NAME=value]... [--input text | --input-file file] [--dry-run] [--cwd dir] [-t templatesDir]...
  stepflow resume <runId> [--approve | --revise "feedback" | --abort]
  stepflow resume <runId> --revise "feedback" --to <step>   (send back to another allowed step)
  stepflow resume <runId>                                    (uses decision.json written by "stepflow chat")
  stepflow chat <runId>
  stepflow status [runId]\n\nTemplate dirs: -t <dir> (repeatable), $STEPFLOW_TEMPLATES, <cwd>/workflows, bundled examples.`);
}

function describe(t: Template) {
  const ps = Object.entries(t.params ?? {}).map(([k, d]) => `      ${k}${d.default ? `=${d.default}` : ""}${d.required === false || d.default ? "" : " (required)"} ${d.description ?? ""}`);
  return `  ${t.id ?? t.name} – ${t.description ?? ""}${ps.length ? "\n" + ps.join("\n") : ""}`;
}

async function makeHooks(id: string, dry: boolean): Promise<Hooks> {
  let runStep: Hooks["runStep"];
  if (dry) runStep = async ({ step, model, prompt }) => {
    console.log(`\n[dry-run ${step.id}] model=${model ?? "default"}\n${prompt}`);
    return step.output ? JSON.stringify({ verdict: "pass", notes: "dry" }) : `(dry-run output of ${step.id})`;
  };
  else runStep = await (await import("../pi/steps.ts")).createStepRunner(cwd, undefined, undefined, (line) => console.log(line));

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
      if (e.type === "loop:limit") console.log(`! loop limit reached at '${e.stepId}'${e.detail ? `: ${e.detail}` : ""}`);
    },
    onOutput: (stepId, v, n) => { writeArtifact(cwd, id, stepId, n, v); },
    onState: (s) => saveRun(cwd, id, s),
  };
}

async function drive(t: Template, state: RunState, id: string, dry: boolean) {
  if (!dry) {
    const { preflight, templateModels } = await import("../pi/steps.ts");
    const problems = await preflight(templateModels(t));
    if (problems.length) die(problems.join("\n") + "\nEdit the model ids in the template.");
  }
  let s: RunState;
  try { s = await runWorkflow(t, state, await makeHooks(id, dry)); }
  catch (e) { saveRun(cwd, id, state); die(`\nStep failed: ${(e as Error).message}\nRetry from that step with: stepflow resume ${id}`); }
  if (s.status === "paused") {
    const gate: any = t.steps[s.cursor];
    const n = gate.show ? s.history[gate.show]?.length : 0;
    const dir = join(runsDir(cwd), id);
    console.log(`\n⏸  Paused at human checkpoint '${gate.id}' (run ${id})`);
    if (s.dry) console.log(`    DRY RUN: all outputs so far are placeholders. Resume only with --dry-run; start a real run with \`stepflow run\`.`);
    console.log(`\nWhat to do:`);
    console.log(`  ${gate.instructions ?? "Review the output, then decide."}`);
    if (gate.show) console.log(`  Review: ${join(dir, `${gate.show}-${n}.md`)}`);
    console.log(`  Artifacts: ${dir}/`);
    console.log(`\nWhen you are done, resume with one of:`);
    console.log(`  stepflow resume ${id} --approve`);
    const targets = [gate.reviseTo ?? [...t.steps.slice(0, s.cursor)].reverse().find((x: any) => "prompt" in x)?.id, ...(gate.reviseOptions ?? [])].filter(Boolean);
    console.log(`  stepflow resume ${id} --revise "what should change"${targets.length > 1 ? `   (default target: ${targets[0]})` : ""}`);
    for (const x of targets.slice(1)) console.log(`  stepflow resume ${id} --revise "what should change" --to ${x}`);
    console.log(`  stepflow resume ${id} --abort`);
    console.log(`  stepflow chat ${id}      (discuss first; the chat can record the decision)`);
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
  const t = findTemplate(templates(), arg) ?? die(`Unknown template '${arg}'. Try: stepflow list`);
  const params: Record<string, string> = {};
  for (const kv of o.param ?? []) {
    const i = kv.indexOf("=");
    if (i < 1) die(`Bad --param '${kv}', expected NAME=value`);
    params[kv.slice(0, i)] = kv.slice(i + 1);
  }
  const input = o["input-file"] ? readFileSync(o["input-file"], "utf8") : (o.input ?? "");
  let state: RunState;
  try { state = newState(t, input, params); } catch (e) { die((e as Error).message + "\n\n" + describe(t)); }
  if (o["dry-run"]) state.dry = true;
  const id = `${o["dry-run"] ? "dry-" : ""}${(t.id ?? t.name).replace(/\//g, "_")}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  console.log(`Run ${id}${o["dry-run"] ? "  (DRY RUN: nothing real is executed, outputs are placeholders)" : ""}`);
  await drive(t, state, id, !!state.dry);
} else if (cmd === "resume") {
  if (!arg) die("Usage: stepflow resume <runId> [--approve | --revise text | --abort]");
  const state = loadRun(cwd, arg);
  const t = findTemplate(templates(), state.template) ?? die(`Template '${state.template}' not found`);
  if (state.status === "done" || state.status === "aborted") die(`Run is already ${state.status}`);
  const dryProblem = dryRunProblem(state.dry, !!o["dry-run"]);
  if (dryProblem) die(dryProblem);
  let d: GateDecision | undefined;
  if (o.approve) d = { action: "approve" };
  else if (o.abort) d = { action: "abort" };
  else if (o.revise !== undefined) d = { action: "revise", feedback: o.revise, to: o.to };
  const runDir = join(runsDir(cwd), arg);
  const decFile = join(runDir, "decision.json");
  if (!d && state.status === "paused" && existsSync(decFile)) {
    try {
      const j = JSON.parse(readFileSync(decFile, "utf8"));
      if (j.action === "approve" || j.action === "abort") d = { action: j.action };
      else if (j.action === "revise") d = { action: "revise", feedback: String(j.feedback ?? ""), to: j.to || undefined };
      else die(`decision.json: unknown action '${j.action}'`);
      console.log(`Using decision from chat: ${JSON.stringify(d)}`);
      renameSync(decFile, join(runDir, `decision.used-${Date.now()}.json`));
    } catch (e) { die(`Bad ${decFile}: ${(e as Error).message}`); }
  }
  if (d?.action === "revise") {
    const g: any = t.steps[state.cursor];
    const ok = [g.reviseTo ?? [...t.steps.slice(0, state.cursor)].reverse().find((x: any) => "prompt" in x)?.id, ...(g.reviseOptions ?? [])].filter(Boolean);
    if (d.to && !ok.includes(d.to)) die(`Cannot revise to '${d.to}'. Allowed: ${ok.join(", ")}`);
  }
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
  await drive(t, state, arg, !!state.dry);
} else if (cmd === "chat") {
  if (!arg) die("Usage: stepflow chat <runId>");
  const state = loadRun(cwd, arg);
  const t = findTemplate(templates(), state.template) ?? die(`Template '${state.template}' not found`);
  const gate: any = t.steps[state.cursor];
  if (state.status !== "paused" || !gate?.gate) die(`Run is ${state.status}, not waiting at a human checkpoint.`);
  const dir = join(runsDir(cwd), arg);
  const targets = [gate.reviseTo ?? [...t.steps.slice(0, state.cursor)].reverse().find((x: any) => "prompt" in x)?.id, ...(gate.reviseOptions ?? [])].filter(Boolean);
  const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort().map((f) => `- ${join(dir, f)}`).join("\n");
  const prompt = `You are helping a human decide at the human checkpoint '${gate.id}' of the stepflow workflow run ${arg} (template ${state.template}).
Gate instructions: ${gate.instructions ?? "(none)"}
Original request: ${state.input}
The step under review is '${gate.show ?? "?"}'. All step outputs (latest iteration has the highest number) are in:
${files}
Start by reading the output under review and summarising it and any reviewer findings in a few lines. Then discuss with the human. Do not modify project files.
When the human states a final decision, write it with the write tool to ${join(dir, "decision.json")} as JSON:
{"action": "approve" | "revise" | "abort", "feedback": "<text for the next attempt, for revise>", "to": "<step id, optional, for revise>"}
Allowed revise targets: ${targets.join(", ")} (default: ${targets[0]}). "approve" also means overriding a 'changes_required' verdict.
Only write the file after the human clearly says so, then tell them to exit and run: stepflow resume ${arg}`;
  const r = spawnSync("pi", [prompt], { stdio: "inherit", cwd });
  console.log(existsSync(join(dir, "decision.json")) ? `\nDecision recorded. Continue with: stepflow resume ${arg}` : `\nNo decision recorded. Use: stepflow resume ${arg} --approve | --revise "..." | --abort`);
  process.exit(r.status ?? 0);
} else if (cmd === "status") {
  const runs = arg ? [{ id: arg, state: loadRun(cwd, arg) }] : listRuns(cwd);
  for (const r of runs) {
    const step: any = findTemplate(templates(), r.state.template)?.steps[r.state.cursor];
    console.log(`${r.id}  ${r.state.status}${r.state.status === "paused" ? ` at '${step?.id}'` : ""}`);
  }
  if (!runs.length) console.log("No runs");
} else usage();
