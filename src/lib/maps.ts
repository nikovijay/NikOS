// Story maps. Every map lives in the repo's maps/<key>/ folder: one per bet, or one for a repo that
// has a single product. The map's owner (its storymap.yaml) can prefix its story ids. Each map's
// delivery.yaml says how its stories are doing.
import { basename, dirname, join } from "node:path";
import { parse } from "yaml";
import { store } from "./store.js";
import { featureStoryIds, read, walk } from "./project.js";

export interface StoryMapRef {
  /** The repo root: the folder with maps/ (and planning/, if any) in it. */
  root: string;
  /** The map's folder, maps/<key>. */
  dir: string;
  /** The map's folder name: the lowercased key, e.g. chk. */
  id: string;
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

/** A map folder: maps/<id>. */
function isMapFolder(dir: string): boolean {
  return basename(dirname(dir)) === "maps";
}

/** The repo root for a map folder, maps/<id>. */
export function repoRootOf(dir: string): string {
  return dirname(dirname(dir));
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

/** The story ids a map holds: its releases' stories and the @ID tags on its features. */
export function storyIdsOf(dir: string): string[] {
  const ids = new Set<string>();
  try {
    const releases = (parse(read(join(dir, "storymap.yaml"))) as { releases?: { stories?: unknown }[] } | null)?.releases ?? [];
    for (const r of releases) for (const s of Array.isArray(r.stories) ? r.stories : []) if (typeof s === "string") ids.add(s);
  } catch {
    // A storymap that doesn't read holds no ids here; validate reports it.
  }
  for (const f of walk(join(dir, "features"), ".feature")) for (const id of featureStoryIds(read(f))) ids.add(id);
  return [...ids];
}

/**
 * The story map a command works on, from a repo root (or a map folder). Order: a map folder is its
 * own map; a repo with intent/ is refused; with no maps/, there's nothing to work on. --map picks
 * a map by its folder name. A story id picks the one map that holds it. Otherwise a single map is used.
 */
export function resolveStoryMap(start: string, opts: { map?: string; story?: string } = {}): StoryMapRef {
  if (isMapFolder(start) && store().exists(join(start, "storymap.yaml"))) {
    return { root: repoRootOf(start), dir: start, id: basename(start) };
  }
  if (store().isDir(join(start, "intent"))) throw new Error("this repo has intent/: run nikos migrate maps");
  const maps = mapDirs(start);
  if (!maps.length) throw new Error("no story map here: run nikos init, or nikos map new --key K");
  const ids = maps.map((d) => basename(d));
  const ref = (dir: string): StoryMapRef => ({ root: start, dir, id: basename(dir) });
  if (opts.map) {
    // Folders are the lowercased map key, so --map HR finds maps/hr.
    const id = ids.find((i) => i === opts.map!.toLowerCase());
    if (!id) throw new Error(`no story map "${opts.map}" in maps/ (have: ${ids.join(", ")})`);
    const chosen = ref(join(start, "maps", id));
    if (opts.story && !storyIdsOf(chosen.dir).includes(opts.story)) throw new Error(`${opts.story} is not in maps/${id}`);
    return chosen;
  }
  if (opts.story) {
    const holds = maps.filter((d) => storyIdsOf(d).includes(opts.story!));
    if (holds.length === 1) return ref(holds[0]);
    if (!holds.length) throw new Error(`no story map has ${opts.story}`);
    throw new Error(`${opts.story} is in several story maps (${holds.map((d) => basename(d)).join(", ")}): pass --map`);
  }
  if (ids.length === 1) return ref(maps[0]);
  throw new Error(`several story maps (${ids.join(", ")}): pass --map <id>`);
}

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

/** The prefix on a map's story ids: the map's owner, else nothing. So a story id is WEB-CHK-1 or CHK-1. */
export function prefixOf(ref: StoryMapRef): string | undefined {
  return mapOwnerOf(ref.dir);
}

/** The prefix on a story's id, given the map's key: e.g. WEB-CHK or CHK. */
export function storyPrefix(ref: StoryMapRef, key: string): string {
  const prefix = prefixOf(ref);
  return prefix ? `${prefix}-${key}` : key;
}

/** The map's label as its stories carry it, e.g. WEB-CHK or CHK. */
export function labelOf(ref: StoryMapRef): string {
  return storyPrefix(ref, keyOfMap(ref.dir) ?? ref.id);
}

/** The value of --map in CLI args, e.g. chk for --map chk. */
export const mapFlag = (args: string[]): string | undefined => {
  const i = args.indexOf("--map");
  return i >= 0 ? args[i + 1] : undefined;
};

/** Every story map in a repo, each maps/<id>. */
export function storyMapsOf(root: string): StoryMapRef[] {
  return mapDirs(root).map((dir) => ({ root, dir, id: basename(dir) }));
}
