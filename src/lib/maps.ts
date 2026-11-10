// Story maps. A repo with maps/ keeps one per bet, under maps/<key>/, and a group's or department's
// plan names the key its story ids use. Every other repo keeps its one story map in intent/, as it
// always has. Each map's delivery.yaml says how its stories are doing.
import { basename, dirname, join } from "node:path";
import { parse } from "yaml";
import { store } from "./store.js";
import { findIntentDir, read } from "./project.js";
import type { StoryHome } from "./state-files.js";

export interface StoryMapRef {
  /** The repo root: the folder with planning/ and intent/ or maps/ in it. */
  root: string;
  /** The folder holding storymap.yaml: intent/, or maps/<id>. */
  dir: string;
  /** Set only for maps/<id>. */
  id?: string;
  /** A map in this code repo (maps/<id>): its state, approvals and git gates are the repo's own. intent/ is not. */
  inRepo: boolean;
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

/** The group or department key in planning/plan.yaml, e.g. PAY. */
export function groupKeyOf(root: string): string | undefined {
  const path = join(root, "planning", "plan.yaml");
  if (!store().exists(path)) return undefined;
  const key = (parse(store().read(path)) as { key?: unknown } | null)?.key;
  return typeof key === "string" ? key : undefined;
}

/** The key that prefixes a repo's story ids when its maps have no owner: planning/plan.yaml's key. */
export const keyOf = groupKeyOf;

/** A map folder: maps/<id> in a group repo. intent/ is never one, even in a repo folder named maps/. */
function isMapFolder(dir: string): boolean {
  return basename(dir) !== "intent" && basename(dirname(dir)) === "maps";
}

/** The repo root for a story map folder: intent/ or maps/<id>. */
export function repoRootOf(dir: string): string {
  return isMapFolder(dir) ? dirname(dirname(dir)) : dirname(dir);
}

/** A story map's key from its storymap.yaml, e.g. CHK. */
export function keyOfMap(dir: string): string | undefined {
  try {
    const key = (parse(read(join(dir, "storymap.yaml"))) as { key?: unknown } | null)?.key;
    return typeof key === "string" ? key : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The story map a command works on. A map folder passed directly is its own map. A repo with maps/
 * has one map per bet: --map picks one, and a single map needs no flag. Otherwise it's the repo's
 * intent/ map, which can't take --map.
 */
export function resolveStoryMap(start: string, map?: string): StoryMapRef {
  if (store().exists(join(start, "storymap.yaml")) && isMapFolder(start)) {
    const root = repoRootOf(start);
    return { root, dir: start, id: basename(start), inRepo: true };
  }
  const root = start;
  const maps = mapDirs(root);
  if (store().exists(join(root, "intent", "storymap.yaml")) && maps.length) {
    throw new Error("this repo has both intent/ and maps/: keep one");
  }
  if (!maps.length) {
    if (map) {
      const hint = store().isDir(join(root, "intent")) ? "this repo has intent/" : "no maps/ folder here: nikos map new in a group repo, or nikos init for a solo repo";
      throw new Error(`--map needs a group repo with maps/ (${hint})`);
    }
    const dir = findIntentDir(root);
    return { root: repoRootOf(dir), dir, inRepo: false };
  }
  const ids = maps.map((d) => basename(d));
  if (map) {
    // Folders are the lowercased map key, so --map HR finds maps/hr.
    const id = ids.find((i) => i === map.toLowerCase());
    if (!id) throw new Error(`no story map "${map}" in maps/ (have: ${ids.join(", ")})`);
    return { root, dir: join(root, "maps", id), id, inRepo: true };
  }
  if (ids.length === 1) return { root, dir: maps[0], id: ids[0], inRepo: true };
  throw new Error(`several story maps in maps/ (${ids.join(", ")}): pass --map <id>`);
}

/** The map's label as its stories carry it: OWNER-MAP, e.g. WEB-CHK (the owner names the map, else the repo's key). */
export function labelOf(ref: StoryMapRef): string {
  const owner = ref.id ? mapOwnerOf(ref.dir) : undefined;
  return `${owner ?? keyOf(ref.root) ?? "?"}-${keyOfMap(ref.dir) ?? ref.id}`;
}

/**
 * The story map a story-scoped command works on. A story id doesn't pick its map: --map does, and a
 * repo with one map needs no flag.
 */
export function storyMapFor(start: string, opts: { story?: string; map?: string } = {}): StoryMapRef {
  return resolveStoryMap(start, opts.map);
}

/**
 * The story map a command that writes stories works on: the same map resolveStoryMap picks, so a
 * repo's stories are authored in its own maps.
 */
export function authoringMap(dir: string, map?: string): StoryMapRef {
  return resolveStoryMap(dir, map);
}

/** Where a story's state and approvals live: the map's folder, or intent/. */
export const homeOf = (ref: StoryMapRef): StoryHome => ref.dir;

/** Every story map in a repo: each maps/<id>, plus the intent/ map if there is one. */
export function storyMapsOf(root: string): StoryMapRef[] {
  const maps: StoryMapRef[] = mapDirs(root).map((dir) => ({ root, dir, id: basename(dir), inRepo: true }));
  const intent = findIntentDir(root);
  if (store().exists(join(intent, "storymap.yaml"))) maps.push({ root, dir: intent, inRepo: false });
  return maps;
}

export const NO_GROUP_KEY = "planning/plan.yaml has no key: add key: <KEY> to it, then retry";
export const NO_OWNER = "this map has no owner: add owner: <KEY> to its storymap.yaml, or a key to planning/plan.yaml (the fallback)";
/** An owner: uppercase letters and digits, up to 10, e.g. WEB. */
export const OWNER = /^[A-Z][A-Z0-9]{0,9}$/;

/** A story map's owner from its storymap.yaml, e.g. WEB; undefined when it names none (or doesn't read). */
export function mapOwnerOf(dir: string): string | undefined {
  try {
    const owner = (parse(read(join(dir, "storymap.yaml"))) as { owner?: unknown } | null)?.owner;
    return typeof owner === "string" ? owner : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The prefix on a story's id: the map's key for intent/, or <OWNER>-<MAP> for a map in a repo,
 * e.g. WEB-CHK, so the id is unique across the company. The map's owner comes first; a map with no
 * owner takes the key in its repo's planning/plan.yaml, e.g. PAY-CHK.
 */
export function storyPrefix(ref: StoryMapRef, key: string): string {
  if (!ref.id) return key;
  const owner = mapOwnerOf(ref.dir);
  if (owner) return `${owner}-${key}`;
  const group = keyOf(ref.root);
  if (!group) throw new Error(NO_OWNER);
  return `${group}-${key}`;
}

/** The value of --map in CLI args, e.g. chk for --map chk. */
export const mapFlag = (args: string[]): string | undefined => {
  const i = args.indexOf("--map");
  return i >= 0 ? args[i + 1] : undefined;
};
