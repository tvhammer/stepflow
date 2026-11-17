import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseTemplate, runWorkflow, newState } from "../src/index.ts";
import type { Hooks, GateDecision } from "../src/index.ts";

const tpl = (n: string) => parseTemplate(readFileSync(new URL(`../examples/${n}.yaml`, import.meta.url), "utf8"));
const dev = () => newState(tpl("dev-flow"), "x", { APP_NAME: "demo" });

function fake(decisions: GateDecision[], o: { verdicts?: string[]; tests?: number[] } = {}) {
  const calls: string[] = [];
  const prompts: Record<string, string[]> = {};
  const hooks: Hooks = {
    async runStep({ step, prompt }) {
      calls.push(step.id);
      (prompts[step.id] ??= []).push(prompt);
      if (step.id === "review") return { verdict: o.verdicts?.shift() ?? "pass", notes: "n" };
      return `out(${step.id})`;
    },
    async runShell({ step }) {
      calls.push(step.id);
      const exitCode = o.tests?.shift() ?? 0;
      return { exitCode, output: exitCode ? "FAILED x" : "ok" };
    },
    async askHuman() { return decisions.shift() ?? { action: "approve" }; },
  };
  return { hooks, calls, prompts };
}

test("params are required, defaulted and rendered", async () => {
  assert.throws(() => newState(tpl("dev-flow"), "x"), /APP_NAME/);
  assert.throws(() => newState(tpl("dev-flow"), "x", { APP_NAME: "a", NOPE: "b" }), /Unknown parameter/);
  const { hooks, prompts } = fake([]);
  const s = await runWorkflow(tpl("dev-flow"), dev(), hooks);
  assert.match(prompts.design[0], /"demo"/);
  assert.equal(s.params.TEST_CMD, "npm test");
});

test("failed tests and failed review loop back to implement, with feedback and bounded", async () => {
  const { hooks, calls, prompts } = fake([], { tests: [1, 0, 0, 0, 0], verdicts: ["fail", "fail", "fail"] });
  const s = await runWorkflow(tpl("dev-flow"), dev(), hooks);
  assert.equal(s.status, "done");
  assert.deepEqual(calls, ["design", "implement", "test", "implement", "test", "review", "implement", "test", "review", "implement", "test", "review"]);
  assert.match(prompts.implement[1], /FAILED x/);
  assert.equal(s.history.implement.length, 4);
});

test("revise re-runs design with feedback; abort stops", async () => {
  const { hooks, calls, prompts } = fake([{ action: "revise", feedback: "simpler" }, { action: "abort" }]);
  const s = await runWorkflow(tpl("dev-flow"), dev(), hooks);
  assert.equal(s.status, "aborted");
  assert.deepEqual(calls, ["design", "design"]);
  assert.equal(prompts.design[1].includes("simpler"), true);
});

test("pause at gate, then resume with a decision", async () => {
  const a = fake([{ action: "pause" }]);
  let s = await runWorkflow(tpl("dev-flow"), dev(), a.hooks);
  assert.equal(s.status, "paused");
  assert.equal(s.cursor, 1);
  s = JSON.parse(JSON.stringify(s)); // survives serialization
  s.decision = { action: "approve" };
  const b = fake([]);
  s = await runWorkflow(tpl("dev-flow"), s, b.hooks);
  assert.equal(s.status, "done");
  assert.deepEqual(b.calls, ["implement", "test", "review"]);
});

test("parallel step stores each output", async () => {
  const { hooks } = fake([]);
  const t = tpl("text-processing");
  const s = await runWorkflow(t, newState(t, "hi"), hooks);
  assert.ok(s.outputs.translation && s.outputs.keypoints && s.outputs.final);
});

test("structured output is parsed from model text", async () => {
  const hooks: Hooks = {
    async runStep({ step }) { return step.id === "review" ? 'ok\n```json\n{"verdict":"pass"}\n```' : "x"; },
    async runShell() { return { exitCode: 0, output: "" }; },
    async askHuman() { return { action: "approve" }; },
  };
  const s = await runWorkflow(tpl("dev-flow"), dev(), hooks);
  assert.equal((s.outputs.review as any).verdict, "pass");
});

const multi = () => parseTemplate(`
name: m
steps:
  - { id: plan, prompt: "plan {{g.feedback}}" }
  - { id: impl, prompt: "impl {{g.feedback}}" }
  - { id: g, gate: human, show: impl, reviseTo: impl, reviseOptions: [plan], max: 1 }
`);

test("gate can revise to an alternate target (reviseOptions)", async () => {
  const { hooks, calls } = fake([{ action: "revise", feedback: "f", to: "plan" }]);
  const s = await runWorkflow(multi(), newState(multi(), "x"), hooks);
  assert.deepEqual(calls, ["plan", "impl", "plan", "impl"]);
  assert.equal(s.status, "done");
});

test("revise to a target outside reviseTo/reviseOptions is rejected", async () => {
  const { hooks } = fake([{ action: "revise", feedback: "f", to: "g" }]);
  await assert.rejects(runWorkflow(multi(), newState(multi(), "x"), hooks), /cannot revise/);
});

test("send-back limit at a gate pauses (escalates) instead of aborting", async () => {
  const { hooks, calls } = fake([{ action: "revise", feedback: "a" }, { action: "revise", feedback: "b" }]);
  const s = await runWorkflow(multi(), newState(multi(), "x"), hooks);
  assert.equal(s.status, "paused");
  assert.deepEqual(calls, ["plan", "impl", "impl"]);
  s.decision = { action: "approve" };
  assert.equal((await runWorkflow(multi(), s, hooks)).status, "done");
});
