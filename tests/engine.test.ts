import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseTemplate, runWorkflow, newState } from "../src/index.ts";
import type { Hooks, GateDecision } from "../src/index.ts";

const tpl = (n: string) => parseTemplate(readFileSync(new URL(`../templates/${n}.yaml`, import.meta.url), "utf8"));

function fake(decisions: GateDecision[], verdicts: string[] = []) {
  const calls: string[] = [];
  const hooks: Hooks = {
    async runStep({ step, prompt }) {
      calls.push(step.id);
      if (step.id === "review") return { verdict: verdicts.shift() ?? "pass" };
      return `out(${step.id}):${prompt.length}`;
    },
    async askHuman() { return decisions.shift() ?? { action: "approve" }; },
  };
  return { hooks, calls };
}

test("dev-flow loops back on failed review, bounded", async () => {
  const { hooks, calls } = fake([{ action: "approve" }], ["fail", "fail", "fail"]);
  const s = await runWorkflow(tpl("dev-flow"), newState(tpl("dev-flow"), "x"), hooks);
  assert.equal(s.status, "done");
  assert.deepEqual(calls, ["design", "implement", "review", "implement", "review", "implement", "review"]);
});

test("revise re-runs design; abort stops", async () => {
  const { hooks, calls } = fake([{ action: "revise", feedback: "simpler" }, { action: "abort" }]);
  const s = await runWorkflow(tpl("dev-flow"), newState(tpl("dev-flow"), "x"), hooks);
  assert.equal(s.status, "aborted");
  assert.deepEqual(calls, ["design", "design"]);
});

test("parallel step stores each output", async () => {
  const { hooks } = fake([]);
  const s = await runWorkflow(tpl("text-processing"), newState(tpl("text-processing"), "hi"), hooks);
  assert.ok(s.outputs.translation && s.outputs.keypoints && s.outputs.final);
});
