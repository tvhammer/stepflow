// Dry-run CLI: runs a template with an echo "model" and a terminal gate.
// Replace runStep with a real pi SDK call to make it live.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { parseTemplate, runWorkflow, newState } from "../../index.ts";

const [file, ...rest] = process.argv.slice(2);
if (!file) { console.error("usage: npm run run -- templates/dev-flow.yaml \"input\""); process.exit(1); }
const t = parseTemplate(readFileSync(file, "utf8"));
const rl = createInterface({ input: process.stdin, output: process.stdout });

const state = await runWorkflow(t, newState(t, rest.join(" ")), {
  async runStep({ step, model, prompt }) {
    console.log(`\n[${step.id}] model=${model ?? "default"}\n${prompt}`);
    return step.output ? { verdict: "pass" } : `(dry-run output of ${step.id})`;
  },
  async askHuman({ step, shown }) {
    console.log(`\n[${step.id}] review:\n${JSON.stringify(shown, null, 2)}`);
    const a = (await rl.question("approve / revise / abort? [a/r/x] ")).trim();
    if (a === "r") return { action: "revise", feedback: await rl.question("feedback: ") };
    return a === "x" ? { action: "abort" } : { action: "approve" };
  },
});
console.log(`\nStatus: ${state.status}`);
rl.close();
