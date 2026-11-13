import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseTemplate } from "./template.ts";
import type { RunState, Template } from "./types.ts";

export interface SavedRun { id: string; state: RunState; }

export function runsDir(cwd: string) { return join(cwd, ".stepflow", "runs"); }

export function saveRun(cwd: string, id: string, state: RunState) {
  mkdirSync(runsDir(cwd), { recursive: true });
  writeFileSync(join(runsDir(cwd), `${id}.json`), JSON.stringify(state, null, 2));
}

export function listRuns(cwd: string): SavedRun[] {
  const d = runsDir(cwd);
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => f.endsWith(".json")).sort().map((f) => ({
    id: f.slice(0, -5), state: JSON.parse(readFileSync(join(d, f), "utf8")) as RunState,
  }));
}

/** Templates from the given directories; earlier directories win on name clashes. */
export function loadTemplates(dirs: string[]): Template[] {
  const seen = new Map<string, Template>();
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter((f) => /\.ya?ml$/.test(f))) {
      const t = parseTemplate(readFileSync(join(d, f), "utf8"));
      if (!seen.has(t.name)) seen.set(t.name, t);
    }
  }
  return [...seen.values()];
}
