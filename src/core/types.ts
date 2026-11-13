export type Step = AgentStep | GateStep | ParallelStep;

interface Base {
  id: string;
  /** Skip the step unless this is true. Format: "<stepId>[.field] == value" or "!=". */
  when?: string;
}

export interface AgentStep extends Base {
  prompt: string;
  /** e.g. "anthropic/claude-opus-4". Falls back to template.defaults.model. */
  model?: string;
  tools?: string[];
  /** Ask the step to return JSON with these fields; stored as object in state. */
  output?: Record<string, string>;
  /** If the condition holds after this step, jump to another step (bounded). */
  on?: { when: string; goto: string; max?: number };
}

export interface GateStep extends Base {
  gate: "human";
  /** Step id whose output is shown to the human. */
  show?: string;
  /** Where to go on "revise" (feedback is stored at state[<id>.feedback]). Default: previous agent step. */
  reviseTo?: string;
  max?: number;
}

export interface ParallelStep extends Base {
  parallel: AgentStep[];
}

export interface Template {
  name: string;
  description?: string;
  defaults?: { model?: string; tools?: string[] };
  steps: Step[];
}

export type Value = string | Record<string, unknown>;

export interface RunState {
  template: string;
  input: string;
  /** Index of the next step to run. */
  cursor: number;
  outputs: Record<string, Value>;
  /** Loop counters, keyed by "<fromStep>-><toStep>". */
  loops: Record<string, number>;
  status: "running" | "done" | "aborted";
}

export type GateDecision =
  | { action: "approve" }
  | { action: "revise"; feedback: string }
  | { action: "abort" };

export interface Hooks {
  runStep(req: { step: AgentStep; prompt: string; model?: string; tools?: string[] }): Promise<Value>;
  askHuman(req: { step: GateStep; shown?: Value }): Promise<GateDecision>;
  onEvent?(e: { type: string; stepId?: string; detail?: string }): void;
  /** Called after every state change; persist it for resume. */
  onState?(s: RunState): void | Promise<void>;
}
