/** Runs one agent step in a fresh in-memory pi session. Shared by the pi extension and the CLI. */
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type { Hooks } from "../../index.ts";
import { heartbeatLine, summarizeTool } from "../../core/progress.ts";

/** onProgress receives a heartbeat line every `heartbeatMs` while an agent step is running. */
export async function createStepRunner(
  cwd: string, fallbackModel?: any, signal?: AbortSignal,
  onProgress?: (line: string) => void, heartbeatMs = 30_000,
): Promise<Hooks["runStep"]> {
  const modelRuntime = await ModelRuntime.create();
  return async ({ step, prompt, model, tools }) => {
    let m = fallbackModel;
    if (model) {
      const [provider, ...rest] = model.split("/");
      m = modelRuntime.getModel(provider, rest.join("/"));
      if (!m) throw new Error(`Model not found: ${model} (step '${step.id}')`);
    }
    const { session } = await createAgentSession({
      cwd, model: m, modelRuntime, tools, sessionManager: SessionManager.inMemory(cwd),
    });
    signal?.addEventListener("abort", () => session.abort());
    const started = Date.now();
    let toolCalls = 0;
    let lastTool: string | undefined;
    const unsubscribe = session.subscribe((e: any) => {
      if (e.type === "tool_execution_start") { toolCalls++; lastTool = summarizeTool(e.toolName, e.args); }
    });
    const timer = onProgress
      ? setInterval(() => onProgress(heartbeatLine(step.id, Date.now() - started, toolCalls, lastTool)), heartbeatMs)
      : undefined;
    try {
      await session.prompt(prompt);
      return session.getLastAssistantText() ?? "";
    } finally {
      if (timer) clearInterval(timer);
      unsubscribe();
      session.dispose();
    }
  };
}

/** Returns a list of problems (unknown model or no credentials) for the given "provider/model" ids. */
export async function preflight(ids: string[]): Promise<string[]> {
  const rt = await ModelRuntime.create();
  const available = new Set((await rt.getAvailable()).map((m) => `${m.provider}/${m.id}`));
  return [...new Set(ids)].filter((id) => !available.has(id)).map((id) => `Model '${id}' is not available (unknown, or no API key). Run \`pi --list-models\`.`);
}

export function templateModels(t: { defaults?: { model?: string }; steps: any[] }): string[] {
  const out: string[] = [];
  if (t.defaults?.model) out.push(t.defaults.model);
  for (const s of t.steps) for (const x of s.parallel ?? [s]) if (x.model) out.push(x.model);
  return out;
}
