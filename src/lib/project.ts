import { createHash } from "node:crypto";
import { store } from "./store.js";
import { join, relative } from "node:path";

export const STORY_ID = /^[A-Z][A-Z0-9]{0,9}-[0-9]+$/;

/** Statuses that count as built. approved is how the map shows done plus a sign-off that holds. */
export const DONE = new Set(["done", "approved"]);
export const isDone = (status: string | undefined) => DONE.has(status ?? "");

/**
 * A short fingerprint of what a story promises: the feature from `Feature:` on. The tags above
 * it are left out, so moving a story between releases or adding a @depends tag isn't a change.
 */
export function specHash(text: string): string {
  const at = text.search(/^\s*Feature:/m);
  const spec = (at < 0 ? text : text.slice(at)).replace(/\r\n/g, "\n").split("\n").map((l) => l.trimEnd()).join("\n").trim();
  return createHash("sha256").update(spec).digest("hex").slice(0, 12);
}

/** Resolve the intent/ folder from a repo root or the folder itself. */
export function findIntentDir(start: string): string {
  if (store().exists(join(start, "storymap.yaml"))) return start;
  return join(start, "intent");
}

export function walk(dir: string, ext?: string): string[] {
  if (!store().exists(dir)) return [];
  return store().list(dir).flatMap((f) => {
    const p = join(dir, f);
    if (store().isDir(p)) return walk(p, ext);
    return !ext || p.endsWith(ext) ? [p] : [];
  });
}

export function read(path: string): string {
  return store().read(path);
}

export function rel(dir: string, path: string): string {
  return relative(dir, path) || path;
}

/** The value of a `@<name>-<value>` tag above `Feature:`, e.g. featureTag(text, "step"). */
export function featureTag(text: string, name: string): string | undefined {
  const head = text.split(/^\s*Feature:/m)[0];
  return new RegExp(`(?:^|\\s)@${name}-([A-Za-z0-9-]+)`).exec(head)?.[1];
}

/** Every value of a repeatable `@<name>-<value>` tag above `Feature:`, e.g. featureTags(text, "depends"). */
export function featureTags(text: string, name: string): string[] {
  const head = text.split(/^\s*Feature:/m)[0];
  return [...head.matchAll(new RegExp(`(?:^|\\s)@${name}-([A-Za-z0-9-]+)`, "g"))].map((m) => m[1]);
}

/**
 * Set (or with value undefined, remove) a `@<name>-<value>` tag above `Feature:`. An existing tag
 * is replaced where it stands; a new one goes after the tag `after` (e.g. the story id), or last.
 */
export function setFeatureTag(text: string, name: string, value: string | undefined, after?: string): string {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => /^\s*Feature:/.test(l));
  const tagLines = lines.slice(0, at < 0 ? 0 : at).flatMap((l, k) => (l.trim().startsWith("@") ? [k] : []));
  if (!tagLines.length) throw new Error("The feature has no tag line above Feature:");
  const isOurs = (t: string) => t.startsWith(`@${name}-`);
  const tagsOf = (k: number) => lines[k].trim().split(/\s+/).filter(Boolean);
  const write = (k: number, tags: string[]) => (lines[k] = lines[k].match(/^\s*/)![0] + tags.join(" "));
  const next = value === undefined ? [] : [`@${name}-${value}`];
  let placed = false;
  for (const k of tagLines) {
    const tags = tagsOf(k);
    const i = tags.findIndex(isOurs);
    if (i < 0) continue;
    write(k, [...tags.slice(0, i), ...(placed ? [] : next), ...tags.slice(i + 1).filter((t) => !isOurs(t))]);
    placed = true;
  }
  if (!placed && next.length) {
    const k = tagLines.find((n) => after && tagsOf(n).includes(`@${after}`)) ?? tagLines[tagLines.length - 1];
    const tags = tagsOf(k);
    const j = after ? tags.indexOf(`@${after}`) : -1;
    tags.splice(j >= 0 ? j + 1 : tags.length, 0, ...next);
    write(k, tags);
  }
  return lines.join("\n");
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
