// Keys across the chain (amendment D5). A group's or department's key names its story ids, so two repos in
// one chain can't share one. The rollout reports the ones among the copies below it. A key is read from a
// copy's planning/plan.yaml. Stage C of the plan cleanup removes this with the rollout.
import { dirname, join, relative, sep } from "node:path";
import { parse } from "yaml";
import { store } from "./store.js";
import { walk } from "./project.js";

/** A key for a group, plan or map (D6): capital letters and digits, starting with a letter, up to 10. */
export const KEY = /^[A-Z][A-Z0-9]{0,9}$/;

export interface CopyKey {
  /** The repo path the copy is of, from the folder it sits in. */
  repo: string;
  key: string;
}

/** The key in a copy's planning/plan.yaml, or undefined. Only the rollout still reads these (stage C removes it). */
function planKeyOf(dir: string): string | undefined {
  try {
    const key = (parse(store().read(join(dir, "planning", "plan.yaml"))) as { key?: unknown } | null)?.key;
    return typeof key === "string" ? key : undefined;
  } catch {
    return undefined;
  }
}

/** Each copy under a .nikos/ folder that names a key, with its repo path. Scratch folders (.fetch) are skipped. */
export function copyKeys(cacheDir: string): CopyKey[] {
  const roots = walk(cacheDir, join("planning", "plan.yaml")).map((p) => dirname(dirname(p)));
  const out: CopyKey[] = [];
  for (const dir of new Set(roots)) {
    if (dir.includes(`${sep}.fetch`)) continue;
    const key = planKeyOf(dir);
    if (key) out.push({ repo: relative(cacheDir, dir).split(sep).join("/"), key });
  }
  return out;
}

/** The keys several copies share: each key with the repos that use it. Empty when every key is its own. */
export function duplicateKeys(copies: CopyKey[]): { key: string; repos: string[] }[] {
  const by = new Map<string, string[]>();
  for (const c of copies) by.set(c.key, [...(by.get(c.key) ?? []), c.repo]);
  return [...by].filter(([, repos]) => repos.length > 1).map(([key, repos]) => ({ key, repos }));
}
