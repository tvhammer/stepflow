import { parse } from "yaml";
import type { Template, Step } from "./types.ts";

export function parseTemplate(text: string): Template {
  const t = parse(text) as Template;
  validate(t);
  return t;
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
    } else if (!("gate" in s) && !(s as any).prompt) err(`'${s.id}': needs prompt, gate or parallel`);
  }
  for (const s of t.steps as any[]) {
    for (const ref of [s.on?.goto, s.reviseTo, s.show]) {
      if (ref && !ids.has(ref)) err(`'${s.id}' references unknown step '${ref}'`);
    }
  }
}
