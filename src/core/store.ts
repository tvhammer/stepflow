import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, delimiter, resolve } from "node:path";
import { parse } from "yaml";
import { validate } from "./template.ts";
import type { RunState, Template, Value } from "./types.ts";

export interface SavedRun { id: string; state: RunState; }

export const runsDir = (cwd: string) => join(cwd, ".stepflow", "runs");

export function saveRun(cwd: string, id: string, state: RunState) {
  mkdirSync(runsDir(cwd), { recursive: true });
  writeFileSync(join(runsDir(cwd), `${id}.json`), JSON.stringify(state, null, 2));
}

export function loadRun(cwd: string, id: string): RunState {
  const f = join(runsDir(cwd), `${id}.json`);
  if (!existsSync(f)) throw new Error(`No such run: ${id}`);
  return JSON.parse(readFileSync(f, "utf8")) as RunState;
}

export function listRuns(cwd: string): SavedRun[] {
  const d = runsDir(cwd);
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => f.endsWith(".json")).sort().map((f) => ({
    id: f.slice(0, -5), state: JSON.parse(readFileSync(join(d, f), "utf8")) as RunState,
  }));
}

/** Writes a readable copy of a step output, e.g. .stepflow/runs/<id>/design-1.md. Returns the path. */
export function writeArtifact(cwd: string, runId: string, stepId: string, iteration: number, v: Value): string {
  const dir = join(runsDir(cwd), runId);
  mkdirSync(dir, { recursive: true });
  const f = join(dir, `${stepId}-${iteration}.md`);
  const body = typeof v === "string" ? v : typeof (v as any).raw === "string" ? (v as any).raw : JSON.stringify(v, null, 2);
  writeFileSync(f, body);
  return f;
}

/** Find a template by id ("photo/cull") or by plain name. */
export function findTemplate(ts: Template[], key: string): Template | undefined {
  return ts.find((t) => t.id === key) ?? ts.find((t) => t.name === key);
}

function walk(dir: string, rel = ""): string[] {
  return readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith(".") || e.name === "node_modules") return [];
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? walk(dir, r) : /\.ya?ml$/.test(e.name) ? [r] : [];
  });
}

/**
 * Templates from the given directories, searched recursively. A template's id is its
 * relative path without extension ("photo/cull"); `name` defaults to the id.
 * Earlier directories win on id clashes.
 */
export function loadTemplates(dirs: string[]): Template[] {
  const seen = new Map<string, Template>();
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of walk(d)) {
      const id = f.replace(/\.ya?ml$/, "");
      if (seen.has(id)) continue;
      try {
        const raw = parse(readFileSync(join(d, f), "utf8"));
        if (raw && typeof raw === "object" && !raw.name) raw.name = id;
        validate(raw);
        seen.set(id, { ...raw, id });
      } catch (e) { console.error(`Skipping ${join(d, f)}: ${(e as Error).message}`); }
    }
  }
  return [...seen.values()];
}

/**
 * Template search path, highest priority first:
 * --templates dirs, $STEPFLOW_TEMPLATES (path-list), <cwd>/.stepflow/templates, <cwd>/workflows, then `builtin`.
 */
export function templateDirs(cwd: string, builtin: string, extra: string[] = []): string[] {
  const env = (process.env.STEPFLOW_TEMPLATES ?? "").split(delimiter).filter(Boolean);
  return [...extra, ...env, join(cwd, ".stepflow", "templates"), join(cwd, "workflows"), builtin].map((d) => resolve(cwd, d));
}
