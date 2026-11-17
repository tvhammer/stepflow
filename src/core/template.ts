import { parse } from "yaml";
import type { Template, Step } from "./types.ts";

export function parseTemplate(text: string): Template {
  const t = parse(text) as Template;
  validate(t);
  return t;
}

/** Merge given params with defaults; throws on missing required or unknown params. */
export function resolveParams(t: Template, given: Record<string, string>): Record<string, string> {
  const defs = t.params ?? {};
  const out: Record<string, string> = {};
  for (const k of Object.keys(given)) if (!(k in defs)) throw new Error(`Unknown parameter '${k}'. Known: ${Object.keys(defs).join(", ") || "(none)"}`);
  for (const [k, d] of Object.entries(defs)) {
    const v = given[k] ?? d.default;
    if (v === undefined) { if (d.required !== false) throw new Error(`Missing required parameter '${k}'${d.description ? ` (${d.description})` : ""}`); continue; }
    out[k] = v;
  }
  return out;
}

export function validate(t: Template): void {
  const err = (m: string) => { throw new Error(`Invalid template: ${m}`); };
  if (!t || typeof t !== "object") err("not an object");
  if (!t.name) err("missing name");
  if (!Array.isArray(t.steps) || !t.steps.length) err("steps must be a non-empty list");
  const ids = new Set<string>();
  const add = (id: unknown) => {
    if (typeof id !== "string" || !id) err("every step needs an id");
    if (ids.has(id as string)) err(`duplicate id '${id}'`);
    ids.add(id as string);
  };
  for (const s of t.steps as Step[]) {
    add(s.id);
    if ("parallel" in s) {
      if (!Array.isArray(s.parallel) || !s.parallel.length) err(`'${s.id}': parallel needs steps`);
      for (const p of s.parallel) { add(p.id); if (!p.prompt) err(`'${p.id}': missing prompt`); }
    } else if (!("gate" in s) && !("run" in s) && !(s as any).prompt) err(`'${s.id}': needs prompt, run, gate or parallel`);
  }
  for (const s of t.steps as any[]) {
    for (const ref of [s.on?.goto, s.reviseTo, s.show, ...(s.reviseOptions ?? [])]) {
      if (ref && !ids.has(ref)) err(`'${s.id}' references unknown step '${ref}'`);
    }
  }
}
