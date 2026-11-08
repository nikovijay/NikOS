// Keys across the chain (amendment D5). A group's or team's key names its story ids, so two repos in
// one chain can't share one. Joining refuses a clash it can see, and the rollout reports the ones
// among the copies below it. A key is read from a copy's planning/plan.yaml, else its nikos.team.yaml.
import { dirname, join, relative, sep } from "node:path";
import { keyOf } from "./maps.js";
import { walk } from "./project.js";
import { TEAM_FILE } from "./team.js";

export interface CopyKey {
  /** The repo path the copy is of, from the folder it sits in. */
  repo: string;
  key: string;
}

/** Each copy under a .nikos/ folder that names a key, with its repo path. Scratch folders (.fetch) are skipped. */
export function copyKeys(cacheDir: string): CopyKey[] {
  const roots = [...walk(cacheDir, join("planning", "plan.yaml")).map((p) => dirname(dirname(p))), ...walk(cacheDir, TEAM_FILE).map((p) => dirname(p))];
  const out: CopyKey[] = [];
  for (const dir of new Set(roots)) {
    if (dir.includes(`${sep}.fetch`)) continue;
    const key = keyOf(dir);
    if (key) out.push({ repo: relative(cacheDir, dir).split(sep).join("/"), key });
  }
  return out;
}

/**
 * Why a repo's key can't be used in this chain, or undefined. self is the joining repo: its own key
 * (named as label: "team" or "plan") and each copy in cacheDirs, other than the repo's own copy, must differ.
 */
export function keyClash(self: string, label: "team" | "plan", repo: string, key: string, cacheDirs: string[]): string | undefined {
  if (keyOf(self) === key) return `${repo} uses key ${key}, which this ${label} uses: give one of them another key`;
  const other = cacheDirs.flatMap(copyKeys).find((c) => c.key === key && c.repo !== repo);
  if (other) return `${repo} uses key ${key}, which ${other.repo} already uses: give one of them another key`;
  return undefined;
}

/** The keys several copies share: each key with the repos that use it. Empty when every key is its own. */
export function duplicateKeys(copies: CopyKey[]): { key: string; repos: string[] }[] {
  const by = new Map<string, string[]>();
  for (const c of copies) by.set(c.key, [...(by.get(c.key) ?? []), c.repo]);
  return [...by].filter(([, repos]) => repos.length > 1).map(([key, repos]) => ({ key, repos }));
}
