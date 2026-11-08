// Story maps. A group repo keeps one per bet, under maps/<id>/. Every other repo keeps its one
// story map in intent/, as it always has, and keeps working unchanged.
import { basename, dirname, join } from "node:path";
import { parse } from "yaml";
import { store } from "./store.js";
import { findIntentDir } from "./project.js";

export interface StoryMapRef {
  /** The repo root: the folder with planning/ and intent/ or maps/ in it. */
  root: string;
  /** The folder holding storymap.yaml: intent/, or maps/<id>. */
  dir: string;
  /** Set only for maps/<id>. */
  id?: string;
}

/** The sorted maps/<id> folders that hold a storymap.yaml; [] if there's no maps/. */
export function mapDirs(root: string): string[] {
  const maps = join(root, "maps");
  if (!store().isDir(maps)) return [];
  return store()
    .list(maps)
    .map((f) => join(maps, f))
    .filter((p) => store().isDir(p) && store().exists(join(p, "storymap.yaml")))
    .sort();
}

/** The group key in planning/plan.yaml, e.g. PAY. */
export function groupKeyOf(root: string): string | undefined {
  const path = join(root, "planning", "plan.yaml");
  if (!store().exists(path)) return undefined;
  const key = (parse(store().read(path)) as { key?: unknown } | null)?.key;
  return typeof key === "string" ? key : undefined;
}

/** A map folder: maps/<id> in a group repo. intent/ is never one, even in a repo folder named maps/. */
function isMapFolder(dir: string): boolean {
  return basename(dir) !== "intent" && basename(dirname(dir)) === "maps";
}

/** The repo root for a story map folder: intent/ or maps/<id>. */
export function repoRootOf(dir: string): string {
  return isMapFolder(dir) ? dirname(dirname(dir)) : dirname(dir);
}

/**
 * The story map a command works on. A map folder passed directly is its own map. A repo with
 * maps/ has one map per bet: --map picks one, and a single map needs no flag. Otherwise it's
 * the repo's intent/ map, which can't take --map.
 */
export function resolveStoryMap(start: string, map?: string): StoryMapRef {
  if (store().exists(join(start, "storymap.yaml")) && isMapFolder(start)) {
    return { root: repoRootOf(start), dir: start, id: basename(start) };
  }
  const root = start;
  const maps = mapDirs(root);
  if (store().exists(join(root, "intent", "storymap.yaml")) && maps.length) {
    throw new Error("this repo has both intent/ and maps/: keep one");
  }
  if (!maps.length) {
    if (map) throw new Error("--map needs a group repo with maps/ (this repo has intent/)");
    const dir = findIntentDir(root);
    return { root: repoRootOf(dir), dir };
  }
  const ids = maps.map((d) => basename(d));
  if (map) {
    if (!ids.includes(map)) throw new Error(`no story map "${map}" in maps/ (have: ${ids.join(", ")})`);
    return { root, dir: join(root, "maps", map), id: map };
  }
  if (ids.length === 1) return { root, dir: maps[0], id: ids[0] };
  throw new Error(`several story maps in maps/ (${ids.join(", ")}): pass --map <id>`);
}

/** Every story map in a repo: each maps/<id>, plus the intent/ map if there is one. */
export function storyMapsOf(root: string): StoryMapRef[] {
  const maps: StoryMapRef[] = mapDirs(root).map((dir) => ({ root, dir, id: basename(dir) }));
  const intent = findIntentDir(root);
  if (store().exists(join(intent, "storymap.yaml"))) maps.push({ root, dir: intent });
  return maps;
}

export const NO_GROUP_KEY = "planning/plan.yaml has no key: add key: <KEY> to it, then retry";

/**
 * The prefix on a story's id: the map's key for intent/, or <GROUP>-<MAP> for a map in a group
 * repo, e.g. PAY-CHK, so the id is unique across the company.
 */
export function storyPrefix(ref: StoryMapRef, key: string): string {
  if (!ref.id) return key;
  const group = groupKeyOf(ref.root);
  if (!group) throw new Error(NO_GROUP_KEY);
  return `${group}-${key}`;
}

/** The value of --map in CLI args, e.g. chk for --map chk. */
export const mapFlag = (args: string[]): string | undefined => {
  const i = args.indexOf("--map");
  return i >= 0 ? args[i + 1] : undefined;
};
