/** Small pure helpers for run safety and progress output. */

/** A dry run and a real run must never be mixed: placeholders would be treated as real outputs. */
export function dryRunProblem(runIsDry: boolean | undefined, dryFlag: boolean): string | undefined {
  if (!!runIsDry === dryFlag) return undefined;
  return runIsDry
    ? "This run was created with --dry-run: its outputs are placeholders. Continue it with --dry-run, or start a real run with `stepflow run`."
    : "This is a real run; refusing to continue it with --dry-run (placeholders would replace real work).";
}

export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** One short line describing a tool call, e.g. `read src/a.ts` or `bash npm test`. */
export function summarizeTool(name: string, args: any, max = 70): string {
  const a = args ?? {};
  const detail = a.path ?? a.file_path ?? a.command ?? a.pattern ?? a.query ?? "";
  const text = `${name} ${String(detail).replace(/\s+/g, " ").trim()}`.trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export function heartbeatLine(stepId: string, elapsedMs: number, toolCalls: number, lastTool?: string): string {
  return `  … ${stepId} still working (${formatElapsed(elapsedMs)}, ${toolCalls} tool call${toolCalls === 1 ? "" : "s"}${lastTool ? `, last: ${lastTool}` : ""})`;
}
