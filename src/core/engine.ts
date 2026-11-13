import type { Template, RunState, Hooks, Step, AgentStep, Value } from "./types.ts";

export function outputInstruction(fields: Record<string, string>): string {
  return `\n\nFinish your reply with a single JSON object (in a \`\`\`json block) with exactly these fields: ${JSON.stringify(fields)}`;
}

/** Take the last JSON object in the text; fall back to {raw}. */
export function parseJsonOutput(text: string): Record<string, unknown> {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const braces = text.match(/\{[\s\S]*\}/);
  for (const c of [...fenced.reverse(), braces?.[0]]) {
    if (!c) continue;
    try { const v = JSON.parse(c); if (v && typeof v === "object") return { ...v, raw: text }; } catch {}
  }
  return { raw: text };
}

export function newState(t: Template, input: string): RunState {
  return { template: t.name, input, cursor: 0, outputs: {}, loops: {}, status: "running" };
}

/** Look up "a" or "a.b" in state. "input" is the run input. */
function lookup(s: RunState, path: string): unknown {
  const [head, ...rest] = path.trim().split(".");
  let v: unknown = head === "input" ? s.input : s.outputs[head];
  for (const k of rest) v = (v as any)?.[k];
  return v;
}

export function render(tpl: string, s: RunState): string {
  return tpl.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, p) => {
    const v = lookup(s, p);
    if (v === undefined) return "";
    return typeof v === "string" ? v : JSON.stringify(v, null, 2);
  });
}

/** Supports: "a.b == x", "a.b != x". Values are compared as strings. */
export function check(cond: string, s: RunState): boolean {
  const m = cond.match(/^\s*([\w.-]+)\s*(==|!=)\s*(.+?)\s*$/);
  if (!m) throw new Error(`Bad condition: ${cond}`);
  const eq = String(lookup(s, m[1]) ?? "") === m[3].replace(/^["']|["']$/g, "");
  return m[2] === "==" ? eq : !eq;
}

export async function runWorkflow(t: Template, state: RunState, hooks: Hooks): Promise<RunState> {
  const emit = (type: string, stepId?: string, detail?: string) => hooks.onEvent?.({ type, stepId, detail });
  const save = async () => { await hooks.onState?.(state); };

  const exec = async (step: AgentStep): Promise<Value> => {
    emit("step:start", step.id);
    let prompt = render(step.prompt, state);
    if (step.output) prompt += outputInstruction(step.output);
    let out = await hooks.runStep({
      step,
      prompt,
      model: step.model ?? t.defaults?.model,
      tools: step.tools ?? t.defaults?.tools,
    });
    if (step.output && typeof out === "string") out = parseJsonOutput(out);
    emit("step:done", step.id);
    return out;
  };
  const indexOf = (id: string) => t.steps.findIndex((x) => x.id === id);
  const bump = (key: string, max: number) => (state.loops[key] = (state.loops[key] ?? 0) + 1) <= max;

  while (state.status === "running" && state.cursor < t.steps.length) {
    const step: Step = t.steps[state.cursor];
    if (step.when && !check(step.when, state)) { emit("step:skip", step.id); state.cursor++; await save(); continue; }

    if ("gate" in step) {
      const d = await hooks.askHuman({ step, shown: step.show ? state.outputs[step.show] : undefined });
      if (d.action === "abort") state.status = "aborted";
      else if (d.action === "approve") state.cursor++;
      else {
        const target = step.reviseTo ?? [...t.steps.slice(0, state.cursor)].reverse().find((x) => "prompt" in x)?.id;
        if (!target || !bump(`${step.id}->${target}`, step.max ?? 3)) { state.status = "aborted"; emit("loop:limit", step.id); }
        else { state.outputs[`${step.id}`] = { feedback: d.feedback }; state.cursor = indexOf(target); }
      }
    } else if ("parallel" in step) {
      const results = await Promise.all(step.parallel.map(async (p) => [p.id, await exec(p)] as const));
      for (const [id, v] of results) state.outputs[id] = v;
      state.cursor++;
    } else {
      state.outputs[step.id] = await exec(step);
      state.cursor++;
      if (step.on && check(step.on.when, state)) {
        if (bump(`${step.id}->${step.on.goto}`, step.on.max ?? 2)) state.cursor = indexOf(step.on.goto);
        else emit("loop:limit", step.id);
      }
    }
    await save();
  }
  if (state.status === "running") state.status = "done";
  await save();
  return state;
}
