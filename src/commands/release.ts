import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMap, isSeq, parseDocument, YAMLMap, YAMLSeq, type Document } from "yaml";
import { featureStoryIds, findIntentDir, read, setFeatureTag, walk } from "../lib/project.js";
import { validate, type ValidationResult } from "./validate.js";

const yamlOpts = { lineWidth: 0, flowCollectionPadding: false };

interface Opened {
  intentDir: string;
  mapPath: string;
  map: Document;
  releases: YAMLSeq<YAMLMap>;
}

function open(dir: string): Opened {
  const intentDir = findIntentDir(dir);
  const mapPath = join(intentDir, "storymap.yaml");
  // A Document keeps comments and the order of everything we don't touch.
  const map = parseDocument(read(mapPath));
  const releases = map.get("releases", true);
  if (!isSeq(releases)) throw new Error("storymap.yaml has no releases list");
  return { intentDir, mapPath, map, releases: releases as YAMLSeq<YAMLMap> };
}

const numberOf = (r: YAMLMap) => Number(r.get("number"));
const storiesOf = (r: YAMLMap): string[] => {
  const s = r.get("stories", true);
  return isSeq(s) ? s.items.map((i: any) => String(i?.value ?? i)) : [];
};

function find(o: Opened, n: number): YAMLMap {
  const r = o.releases.items.find((i) => isMap(i) && numberOf(i) === n);
  if (!r) throw new Error(`There is no release ${n}. Releases: ${o.releases.items.map(numberOf).join(", ") || "none"}`);
  return r;
}

/** Rewrite the @release-<n> tag on each moved story's feature file. */
function retag(intentDir: string, moved: Map<string, number>) {
  if (!moved.size) return;
  for (const file of walk(join(intentDir, "features"), ".feature")) {
    const text = read(file);
    const id = featureStoryIds(text)[0];
    if (id && moved.has(id)) writeFileSync(file, setFeatureTag(text, "release", String(moved.get(id)), id));
  }
}

function save(o: Opened): ValidationResult {
  writeFileSync(o.mapPath, o.map.toString(yamlOpts));
  return validate(o.intentDir);
}

const cleanTitle = (title: string | undefined) => {
  const t = title?.trim();
  if (!t) throw new Error("A release needs a title");
  return t;
};

/** Add the next numbered release, with no stories yet. */
export function addRelease(input: { title: string; goal?: string }, dir: string) {
  const o = open(dir);
  const number = Math.max(0, ...o.releases.items.map(numberOf)) + 1;
  const goal = input.goal?.trim();
  o.releases.add(o.map.createNode({ number, title: cleanTitle(input.title), ...(goal ? { goal } : {}), stories: [] }));
  const added = o.releases.items[o.releases.items.length - 1];
  (added.get("stories", true) as unknown as YAMLSeq).flow = true;
  return { number, validation: save(o) };
}

/** Change a release's title and/or goal. An empty goal removes it. */
export function renameRelease(input: { number: number; title?: string; goal?: string }, dir: string) {
  if (input.title === undefined && input.goal === undefined) throw new Error("Give a new title, a --goal, or both");
  const o = open(dir);
  const r = find(o, input.number);
  if (input.title !== undefined) r.set("title", cleanTitle(input.title));
  if (input.goal !== undefined) {
    const goal = input.goal.trim();
    if (!goal) r.delete("goal");
    else if (r.has("goal")) r.set("goal", goal);
    else {
      // Keep goal next to the title rather than after the stories.
      const at = r.items.findIndex((p: any) => p.key?.value === "title") + 1;
      r.items.splice(at, 0, o.map.createPair("goal", goal) as any);
    }
  }
  return { number: input.number, validation: save(o) };
}

/** Move a story to another release (to the end of its build order), keeping its feature tag in step. */
export function moveStory(input: { id: string; to: number }, dir: string) {
  const o = open(dir);
  const target = find(o, input.to);
  const from = o.releases.items.find((r) => storiesOf(r).includes(input.id));
  if (!from) throw new Error(`${input.id} is not in any release in storymap.yaml`);
  const fromNumber = numberOf(from);
  if (fromNumber === input.to) throw new Error(`${input.id} is already in release ${input.to}`);
  const seq = from.get("stories", true) as unknown as YAMLSeq;
  seq.items.splice(storiesOf(from).indexOf(input.id), 1);
  const dest = target.get("stories", true);
  if (isSeq(dest)) dest.add(input.id);
  else target.set("stories", o.map.createNode([input.id], { flow: true }));
  retag(o.intentDir, new Map([[input.id, input.to]]));
  return { id: input.id, from: fromNumber, to: input.to, validation: save(o) };
}

/** Move a release to a new position and renumber them all from 1, retagging every story that moved. */
export function reorderRelease(input: { number: number; to: number }, dir: string) {
  const o = open(dir);
  const r = find(o, input.number);
  const count = o.releases.items.length;
  if (!Number.isInteger(input.to) || input.to < 1 || input.to > count) throw new Error(`Position must be from 1 to ${count}`);
  const items = o.releases.items;
  items.splice(items.indexOf(r), 1);
  items.splice(input.to - 1, 0, r);
  const moved = new Map<string, number>();
  items.forEach((item, i) => {
    if (numberOf(item) === i + 1) return;
    item.set("number", i + 1);
    for (const id of storiesOf(item)) moved.set(id, i + 1);
  });
  retag(o.intentDir, moved);
  return { order: items.map((i) => ({ number: numberOf(i), title: String(i.get("title")) })), validation: save(o) };
}

const USAGE = `Usage:
  nikos release add "<title>" [--goal "<goal>"]
  nikos release rename <n> ["<title>"] [--goal "<goal>"]   (--goal "" removes it)
  nikos release move <story-id> <n>
  nikos release reorder <n> <position>`;

function report(v: ValidationResult) {
  if (v.errors.length) console.log(`\n! intent/ now has ${v.errors.length} ${v.errors.length === 1 ? "problem" : "problems"}; run nikos validate to see them.`);
}

export function runRelease(args: string[]): number {
  const [sub, ...rest] = args;
  const opt = (n: string) => {
    const i = rest.indexOf(`--${n}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const positional = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1].startsWith("--")));
  const dir = opt("dir") ?? process.cwd();
  try {
    if (sub === "add" && positional[0]) {
      const r = addRelease({ title: positional[0], goal: opt("goal") }, dir);
      console.log(`Added release ${r.number}: ${positional[0].trim()}`);
      report(r.validation);
    } else if (sub === "rename" && positional[0]) {
      const r = renameRelease({ number: Number(positional[0]), title: positional[1], goal: opt("goal") }, dir);
      console.log(`Updated release ${r.number}`);
      report(r.validation);
    } else if (sub === "move" && positional[0] && positional[1]) {
      const r = moveStory({ id: positional[0], to: Number(positional[1]) }, dir);
      console.log(`Moved ${r.id} from release ${r.from} to release ${r.to}`);
      report(r.validation);
    } else if (sub === "reorder" && positional[0] && positional[1]) {
      const r = reorderRelease({ number: Number(positional[0]), to: Number(positional[1]) }, dir);
      console.log(`Releases are now:\n${r.order.map((x) => `  ${x.number}. ${x.title}`).join("\n")}`);
      report(r.validation);
    } else {
      console.error(USAGE);
      return 1;
    }
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
