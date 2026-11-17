import { test } from "node:test";
import assert from "node:assert/strict";
import { dryRunProblem, formatElapsed, summarizeTool, heartbeatLine } from "../src/index.ts";

test("dry and real runs cannot be mixed", () => {
  assert.equal(dryRunProblem(undefined, false), undefined);
  assert.equal(dryRunProblem(true, true), undefined);
  assert.match(dryRunProblem(true, false)!, /placeholders/);
  assert.match(dryRunProblem(false, true)!, /real run/);
  assert.match(dryRunProblem(undefined, true)!, /real run/);
});

test("heartbeat formatting", () => {
  assert.equal(formatElapsed(0), "0:00");
  assert.equal(formatElapsed(125_000), "2:05");
  assert.equal(summarizeTool("read", { path: "src/a.ts" }), "read src/a.ts");
  assert.equal(summarizeTool("bash", { command: "npm   test\n -- x" }), "bash npm test -- x");
  assert.ok(summarizeTool("bash", { command: "x".repeat(200) }).length <= 70);
  assert.equal(summarizeTool("ls", undefined), "ls");
  assert.equal(heartbeatLine("code_review", 61_000, 1, "read a.ts"), "  … code_review still working (1:01, 1 tool call, last: read a.ts)");
  assert.equal(heartbeatLine("x", 1000, 0), "  … x still working (0:01, 0 tool calls)");
});
