export type Step = AgentStep | ShellStep | GateStep | ParallelStep;

interface Base {
  id: string;
  /** Skip the step unless this holds. Format: "<stepId>[.field] == value" or "!=". */
  when?: string;
}

/** Loop-back: if the condition holds after this step, jump to another step (bounded). */
export interface Branching {
  on?: { when: string; goto: string; max?: number };
}

export interface AgentStep extends Base, Branching {
  prompt: string;
  /** e.g. "anthropic/claude-opus-4-5". Falls back to template.defaults.model. */
  model?: string;
  tools?: string[];
  /** Ask the step to return JSON with these fields; stored as an object in state. */
  output?: Record<string, string>;
}

/** Runs a shell command. Output is { exitCode, output }. Good for tests/builds. */
export interface ShellStep extends Base, Branching {
  run: string;
}

export interface GateStep extends Base {
  gate: "human";
  /** Step id whose output is shown to the human. */
  show?: string;
  /** Where to go on "revise" (feedback is stored at state[<gateId>].feedback). Default: previous agent step. */
  reviseTo?: string;
  max?: number;
  /** Text shown to the human when the workflow pauses here. */
  instructions?: string;
}

export interface ParallelStep extends Base {
  parallel: AgentStep[];
}

export interface ParamDef {
  description?: string;
  default?: string;
  required?: boolean;
}

export interface Template {
  name: string;
  /** Set by the loader: path relative to the template dir, e.g. "photo/cull". */
  id?: string;
  description?: string;
  /** Named parameters, usable as {{NAME}} in prompts and commands. */
  params?: Record<string, ParamDef>;
  defaults?: { model?: string; tools?: string[] };
  steps: Step[];
}

export type Value = string | Record<string, unknown>;

export type GateDecision =
  | { action: "approve" }
  | { action: "revise"; feedback: string }
  | { action: "abort" }
  /** Save state and stop; resume later with a decision. */
  | { action: "pause" };

export interface RunState {
  template: string;
  input: string;
  params: Record<string, string>;
  /** Index of the next step to run (or the gate we are paused at). */
  cursor: number;
  /** Latest output per step id. */
  outputs: Record<string, Value>;
  /** Every output a step has produced, oldest first (iterations). */
  history: Record<string, Value[]>;
  /** Loop counters, keyed by "<fromStep>-><toStep>". */
  loops: Record<string, number>;
  /** Decision supplied on resume, consumed by the gate at the cursor. */
  decision?: GateDecision;
  status: "running" | "paused" | "done" | "aborted";
}

export interface Hooks {
  runStep(req: { step: AgentStep; prompt: string; model?: string; tools?: string[] }): Promise<Value>;
  runShell?(req: { step: ShellStep; command: string }): Promise<{ exitCode: number; output: string }>;
  askHuman(req: { step: GateStep; shown?: Value; state: RunState }): Promise<GateDecision>;
  onEvent?(e: { type: string; stepId?: string; detail?: string }): void;
  /** A step produced an output (iteration is 1-based). */
  onOutput?(stepId: string, value: Value, iteration: number): void | Promise<void>;
  /** Called after every state change; persist it for resume. */
  onState?(s: RunState): void | Promise<void>;
}
