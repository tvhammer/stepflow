/**
 * pi adapter: /workflow list | run <name> [NAME=value ...] <input> | resume
 * Each agent step runs in its own in-memory pi session (own model, own tools).
 * Gates use pi's UI. Run state is saved to <cwd>/.stepflow/runs/.
 */
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { createStepRunner } from "./steps.ts";
import { runWorkflow, newState, loadTemplates, listRuns, saveRun, writeArtifact, runShell } from "../../index.ts";
import type { Hooks, Template, RunState, Value } from "../../index.ts";

const BUILTIN_TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), "../../../templates");

const templateDirs = (cwd: string) => [join(cwd, ".stepflow", "templates"), join(cwd, "workflows"), BUILTIN_TEMPLATES];

const short = (v: Value | undefined, n = 600) => {
  const s = v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v, null, 2);
  return s.length > n ? s.slice(0, n) + "\n…" : s;
};

async function execute(pi: ExtensionAPI, ctx: ExtensionCommandContext, t: Template, state: RunState, id: string) {
  const stop = new AbortController();
  const runStep = await createStepRunner(ctx.cwd, ctx.model, stop.signal);

  const hooks: Hooks = {
    runStep,
    runShell: ({ command }) => runShell(command, ctx.cwd),

    async askHuman({ step, shown }) {
      for (;;) {
        const choice = await ctx.ui.select(
          `Gate '${step.id}'${step.instructions ? `: ${step.instructions}` : ""}\n\n${short(shown)}`,
          ["Approve", "Revise…", "View full output", "Pause (resume later with the CLI)", "Abort"],
        );
        if (choice === "Approve") return { action: "approve" };
        if (choice === "View full output") { await ctx.ui.editor(`Output of ${step.show}`, short(shown, 1e6)); continue; }
        if (choice === "Revise…") {
          const feedback = await ctx.ui.input("What should change?", "");
          if (feedback === undefined) continue;
          return { action: "revise", feedback };
        }
        if (choice?.startsWith("Pause")) return { action: "pause" };
        return { action: "abort" };
      }
    },

    onEvent: (e) => {
      if (e.type === "step:start") ctx.ui.setStatus("stepflow", `${t.name}: ${e.stepId}…`);
      if (e.type === "loop:limit") ctx.ui.notify(`Loop limit reached at '${e.stepId}'`, "warning");
    },
    onOutput: (stepId, v, n) => { writeArtifact(ctx.cwd, id, stepId, n, v); },
    onState: (s) => saveRun(ctx.cwd, id, s),
  };

  try {
    const final = await runWorkflow(t, state, hooks);
    const last = t.steps[t.steps.length - 1];
    const lastOut = final.outputs[("parallel" in last ? last.parallel[last.parallel.length - 1] : last).id];
    pi.sendMessage({
      customType: "stepflow",
      display: true,
      content: final.status === "paused"
        ? `Workflow '${t.name}' paused (run ${id}). Resume: stepflow resume ${id} --approve | --revise "..." | --abort`
        : `Workflow '${t.name}' ${final.status} (run ${id}).\n\n${short(lastOut, 4000)}`,
    });
  } catch (e) {
    ctx.ui.notify(`Workflow failed: ${(e as Error).message} (resume with /workflow resume)`, "error");
  } finally {
    ctx.ui.setStatus("stepflow", undefined);
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("workflow", {
    description: "Run a workflow: /workflow list | run <name> [NAME=value ...] <input> | resume",
    handler: async (args, ctx) => {
      const [sub, name, ...rest] = args.trim().split(/\s+/);
      const templates = loadTemplates(templateDirs(ctx.cwd));

      if (!sub || sub === "list") {
        ctx.ui.notify(templates.map((t) => `${t.name} – ${t.description ?? ""}`).join("\n") || "No templates", "info");
        return;
      }
      if (sub === "run") {
        const t = templates.find((x) => x.name === name);
        if (!t) return ctx.ui.notify(`Unknown workflow '${name}'`, "error");
        // NAME=value tokens are parameters, the rest is the input text.
        const params: Record<string, string> = {};
        const words: string[] = [];
        for (const w of rest) { const m = w.match(/^([A-Za-z_]\w*)=(.*)$/); if (m && m[1] in (t.params ?? {})) params[m[1]] = m[2]; else words.push(w); }
        for (const [k, d] of Object.entries(t.params ?? {})) {
          if (params[k] === undefined && d.default === undefined && d.required !== false) {
            const v = await ctx.ui.input(`${k}${d.description ? ` – ${d.description}` : ""}:`, "");
            if (!v) return ctx.ui.notify("Cancelled", "info");
            params[k] = v;
          }
        }
        const input = words.join(" ") || (await ctx.ui.input("Input for the workflow:", "")) || "";
        const id = `${t.name}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
        return execute(pi, ctx, t, newState(t, input, params), id);
      }
      if (sub === "resume") {
        const runs = listRuns(ctx.cwd).filter((r) => r.state.status === "running" || r.state.status === "paused");
        if (!runs.length) return ctx.ui.notify("Nothing to resume", "info");
        const pick = await ctx.ui.select("Resume which run?", runs.map((r) => r.id));
        const run = runs.find((r) => r.id === pick);
        const t = run && templates.find((x) => x.name === run.state.template);
        if (!run || !t) return;
        return execute(pi, ctx, t, run.state, run.id);
      }
      ctx.ui.notify("Usage: /workflow list | run <name> [NAME=value ...] <input> | resume", "warning");
    },
  });
}
