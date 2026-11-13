/** Runs one agent step in a fresh in-memory pi session. Shared by the pi extension and the CLI. */
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type { Hooks } from "../../index.ts";

export async function createStepRunner(cwd: string, fallbackModel?: any, signal?: AbortSignal): Promise<Hooks["runStep"]> {
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
    try {
      await session.prompt(prompt);
      return session.getLastAssistantText() ?? "";
    } finally { session.dispose(); }
  };
}
