import { join } from "node:path";
import { parseDocument, YAMLSeq } from "yaml";
import { featureStoryIds, read, walk } from "../lib/project.js";
import { checkHash } from "../planning/model.js";
import { holderOf, loadMapData, readAssignments } from "../lib/assignments.js";
import { authoringMap, storyPrefix, type StoryMapRef } from "../lib/maps.js";
import { store } from "../lib/store.js";
import { createStoryState, loadStates, perStory, statePath, storyStatePath } from "../lib/state-files.js";
import { slugify } from "./init.js";
import { validate, type ValidationResult } from "./validate.js";

const PRIORITIES = ["must", "should", "could"] as const;

export interface StoryInput {
  title: string;
  activity: string;
  /** The map, in a group repo with several: maps/<map>. */
  map?: string;
  /** A step of that activity. */
  step?: string;
  /** Release number; defaults to the last release. */
  release?: number;
  priority?: (typeof PRIORITIES)[number];
}

export interface StoryResult {
  id: string;
  release: number;
  feature: string;
  validation: ValidationResult;
}

const yamlOpts = { lineWidth: 0, flowCollectionPadding: false };

/**
 * The number of the last story in a map, so the next id is one more. A map counts its releases,
 * its state and its feature tags, so a removed story's number isn't reused. intent/ counts its
 * releases only, as it always has.
 */
function lastNumber(ref: StoryMapRef, prefix: string, releases: any[]): number {
  if (!ref.id) {
    const key = prefix;
    return Math.max(0, ...releases.flatMap((r) => r?.stories ?? []).map((s: string) => Number(s.slice(key.length + 1)) || 0));
  }
  const ids = new Set<string>(releases.flatMap((r) => r?.stories ?? []));
  for (const s of Object.keys(loadStates(ref.dir))) ids.add(s);
  for (const f of walk(join(ref.dir, "features"), ".feature")) for (const s of featureStoryIds(read(f))) ids.add(s);
  return Math.max(0, ...[...ids].filter((s) => s.startsWith(`${prefix}-`)).map((s) => Number(s.slice(prefix.length + 1)) || 0));
}

/** Add a story to storymap.yaml and state.yaml, and write its starter feature file. */
export function newStory(input: StoryInput, dir: string): StoryResult {
  const title = input.title?.trim();
  if (!title) throw new Error("A story needs a title");
  if (/[\r\n]/.test(title)) throw new Error("A title is one line (no line breaks)");
  const priority = input.priority ?? "must";
  if (!PRIORITIES.includes(priority)) throw new Error(`'${priority}' is not a priority (must, should, could)`);

  const ref = authoringMap(dir, input.map);
  const intentDir = ref.dir;
  const mapPath = join(intentDir, "storymap.yaml");
  // Documents keep comments and the order of everything we don't touch.
  const map = parseDocument(read(mapPath));
  const plain = map.toJS();

  const activities: string[] = (plain.activities ?? []).map((a: any) => a?.id);
  if (!activities.includes(input.activity)) {
    throw new Error(`'${input.activity}' is not an activity in storymap.yaml. Activities: ${activities.join(", ") || "none"}`);
  }
  if (input.step !== undefined) {
    const steps: string[] = ((plain.activities ?? []).find((a: any) => a?.id === input.activity)?.steps ?? []).map((st: any) => st?.id);
    if (!steps.includes(input.step)) {
      throw new Error(`'${input.step}' is not a step of activity '${input.activity}'. Steps: ${steps.join(", ") || "none (add one with nikos step add)"}`);
    }
  }
  const releases: any[] = plain.releases ?? [];
  if (!releases.length) throw new Error("storymap.yaml has no releases to add the story to");
  const index = input.release === undefined ? releases.length - 1 : releases.findIndex((r) => r?.number === input.release);
  if (index < 0) throw new Error(`There is no release ${input.release}. Releases: ${releases.map((r) => r?.number).join(", ")}`);
  const release = releases[index].number as number;

  const prefix = storyPrefix(ref, plain.key as string);
  const id = `${prefix}-${lastNumber(ref, prefix, releases) + 1}`;

  const feature = join(intentDir, "features", input.activity, `${slugify(title)}.feature`);
  if (store().exists(feature)) throw new Error(`${feature} already exists; give the story a different title`);

  const stories = map.getIn(["releases", index, "stories"], true);
  if (stories instanceof YAMLSeq) stories.add(id);
  else map.setIn(["releases", index, "stories"], map.createNode([id], { flow: true }));

  const text = `@${id} @release-${release} @${priority} @activity-${input.activity}${input.step ? ` @step-${input.step}` : ""}
Feature: ${title}

  As a <who it's for>
  I want <what they can do>
  So that <why it matters to them>

  @AC1 @${priority}
  Scenario: AC1 — <the first acceptance criterion>
    Given <the starting situation>
    When <the one action>
    Then <what they see>
`;

  store().write(feature, text, { create: true });
  store().write(mapPath, map.toString(yamlOpts));
  createStoryState(intentDir, id, { status: "todo" });
  return { id, release, feature, validation: validate(intentDir) };
}

export function runStory(args: string[]): number {
  const [sub, title, ...rest] = args;
  const opt = (n: string) => {
    const i = rest.indexOf(`--${n}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  if (sub !== "add" || !title || title.startsWith("--") || !opt("activity")) {
    console.error('Usage: nikos story add "<title>" --activity <id> [--step <id>] [--release <n>] [--priority must|should|could] [--map <id>]');
    return 1;
  }
  try {
    const release = opt("release");
    const r = newStory(
      { title, activity: opt("activity")!, step: opt("step"), release: release === undefined ? undefined : Number(release), priority: opt("priority") as StoryInput["priority"], map: opt("map") },
      opt("dir") ?? process.cwd(),
    );
    console.log(`Added ${r.id} to release ${r.release}\nCreated ${r.feature}`);
    console.log(`\nNext: write the user story and its scenarios in the feature file, then run nikos clear ${r.id}.`);
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}

/** The label a map is known by in messages: maps/<id>, or intent for a repo's own map. */
export const mapLabel = (ref: StoryMapRef) => (ref.id ? `maps/${ref.id}` : "intent");

/** The feature file of a story in a map, or undefined when no feature in it has that id. */
export function featureOf(ref: StoryMapRef, id: string): string | undefined {
  return walk(join(ref.dir, "features"), ".feature").find((f) => featureStoryIds(read(f))[0] === id);
}

/** Change a story's title: the Feature line only. Its tags, and the rest of the feature, stay as they are. */
export function renameStory(dir: string, input: { map?: string; id: string; title: string }, expect?: string): { file: string; validation: ValidationResult } {
  const title = input.title?.trim();
  if (!title) throw new Error("A story needs a title");
  if (/[\r\n]/.test(title)) throw new Error("A title is one line (no line breaks)");
  const ref = authoringMap(dir, input.map);
  const file = featureOf(ref, input.id);
  if (!file) throw new Error(`${input.id} is not a story in ${mapLabel(ref)}`);
  const text = read(file);
  checkHash(input.id, text, expect);
  store().write(file, text.replace(/^(\s*Feature:)[^\n]*/m, (_all, head: string) => `${head} ${title}`));
  return { file, validation: validate(ref.dir) };
}

/** Drop a story's state entry from its map: its own file, or its line in state.yaml. */
function dropState(dir: string, id: string): void {
  if (perStory(dir) && store().exists(storyStatePath(dir, id))) store().remove(storyStatePath(dir, id));
  const path = statePath(dir);
  if (!store().exists(path)) return;
  const doc = parseDocument(read(path));
  if (!doc.hasIn(["stories", id])) return;
  doc.deleteIn(["stories", id]);
  store().write(path, doc.toString(yamlOpts));
}

/**
 * Remove a story that has never been started: its feature, its place in its release, and its state.
 * Refused when a team holds it (unassign first), or when any work is recorded against it.
 */
export function removeStory(dir: string, input: { map?: string; id: string }, expect?: string): { removed: string; validation: ValidationResult } {
  const ref = authoringMap(dir, input.map);
  const file = featureOf(ref, input.id);
  if (!file) throw new Error(`${input.id} is not a story in ${mapLabel(ref)}`);
  checkHash(input.id, read(file), expect);
  const holder = holderOf(readAssignments(ref.dir), loadMapData(ref.dir), input.id);
  if (holder) throw new Error(`${input.id} is assigned to ${holder.team}: unassign it first`);
  const status = loadStates(ref.dir)[input.id]?.status ?? "todo";
  if (status !== "todo") throw new Error(`${input.id} has work done: remove it from the CLI`);
  const mapPath = join(ref.dir, "storymap.yaml");
  const map = parseDocument(read(mapPath));
  const releases = map.get("releases", true);
  if (releases instanceof YAMLSeq) {
    for (const r of releases.items as any[]) {
      const stories = r?.get?.("stories", true);
      if (stories instanceof YAMLSeq) stories.items = stories.items.filter((s: any) => String(s?.value ?? s) !== input.id);
    }
  }
  store().write(mapPath, map.toString(yamlOpts));
  store().remove(file);
  dropState(ref.dir, input.id);
  return { removed: input.id, validation: validate(ref.dir) };
}
