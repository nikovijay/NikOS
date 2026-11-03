import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const STORY_ID = /^[A-Z][A-Z0-9]{0,9}-[0-9]+$/;

/** Resolve the intent/ folder from a repo root or the folder itself. */
export function findIntentDir(start: string): string {
  if (existsSync(join(start, "storymap.yaml"))) return start;
  return join(start, "intent");
}

export function walk(dir: string, ext?: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return walk(p, ext);
    return !ext || p.endsWith(ext) ? [p] : [];
  });
}

export function read(path: string): string {
  return readFileSync(path, "utf8");
}

export function rel(dir: string, path: string): string {
  return relative(dir, path) || path;
}

/** Story id tags on the lines above `Feature:`. */
export function featureStoryIds(text: string): string[] {
  const ids: string[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith("Feature:")) break;
    if (!t.startsWith("@")) continue;
    for (const tag of t.split(/\s+/)) {
      const name = tag.replace(/^@/, "");
      if (STORY_ID.test(name)) ids.push(name);
    }
  }
  return ids;
}
