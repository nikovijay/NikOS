// Story maps. A group repo keeps one per bet, under maps/<id>/. Every other repo keeps its one
// story map in intent/, as it always has, and keeps working unchanged. A team repo reads the
// group maps copied into .nikos/assigned/ by nikos sync: each copy is a map folder, so the same
// commands work on it, with the team's own status in status/.
import { basename, dirname, join, sep } from "node:path";
import { parse } from "yaml";
import { store } from "./store.js";
import { featureStoryIds, findIntentDir, read, walk } from "./project.js";
import { isTeamRepo, openTeam, relPath, storyMapClash, TEAM_FILE, TEAM_REPO_STORIES } from "./team.js";
import type { StoryHome } from "./state-files.js";

export interface StoryMapRef {
  /** The repo root: the folder with planning/ and intent/ or maps/ in it. A team's repo root, for a copy or its own map. */
  root: string;
  /** The folder holding storymap.yaml: intent/, maps/<id>, or a team's copy or own map of one. */
  dir: string;
  /** Set only for maps/<id>, a team's copy of one and a team's own map. */
  id?: string;
  /** Set when the status lives in the team repo: a team's copy of a group's map, or its own map. */
  team?: boolean;
  /** Set for a map the team owns (maps/<key>/ in its own repo): it's in place, and its status is the team's own. */
  own?: boolean;
  /** For a team's copy: the copy of the group repo it sits in, which has the planning/ folder. */
  copyRoot?: string;
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

/**
 * The key that prefixes a repo's story ids: planning/plan.yaml's key for a group or plan, else the
 * team's key in nikos.team.yaml (WEB, for WEB-INB-1). A team's copy of a group reads the group's.
 */
export function keyOf(root: string): string | undefined {
  const plan = groupKeyOf(root);
  if (plan) return plan;
  const path = join(root, TEAM_FILE);
  if (!store().exists(path)) return undefined;
  try {
    const key = (parse(store().read(path)) as { key?: unknown } | null)?.key;
    return typeof key === "string" ? key : undefined;
  } catch {
    return undefined;
  }
}

/** A map folder: maps/<id> in a group repo. intent/ is never one, even in a repo folder named maps/. */
function isMapFolder(dir: string): boolean {
  return basename(dir) !== "intent" && basename(dirname(dir)) === "maps";
}

/** The repo root for a story map folder: intent/ or maps/<id>. */
export function repoRootOf(dir: string): string {
  return isMapFolder(dir) ? dirname(dirname(dir)) : dirname(dir);
}

/** The team repo a copy under .nikos/assigned/ belongs to, or undefined for any other folder. */
const COPY_MARK = `${sep}.nikos${sep}assigned${sep}`;
function teamOfCopy(dir: string): string | undefined {
  const at = dir.lastIndexOf(COPY_MARK);
  return at >= 0 ? dir.slice(0, at) : undefined;
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
 * The story map a command works on. A map folder passed directly is its own map. A team repo
 * works on its assigned copies. A repo with maps/ has one map per bet: --map picks one, and a
 * single map needs no flag. Otherwise it's the repo's intent/ map, which can't take --map.
 */
export function resolveStoryMap(start: string, map?: string): StoryMapRef {
  if (store().exists(join(start, "storymap.yaml")) && isMapFolder(start)) {
    const team = teamOfCopy(start);
    if (team !== undefined) return { root: team, dir: start, id: basename(start), team: true, copyRoot: repoRootOf(start) };
    const root = repoRootOf(start);
    if (isTeamRepo(root)) return { root, dir: start, id: basename(start), team: true, own: true };
    return { root, dir: start, id: basename(start) };
  }
  if (isTeamRepo(start)) return teamRef(start, map);
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
    return { root: repoRootOf(dir), dir };
  }
  const ids = maps.map((d) => basename(d));
  if (map) {
    // Folders are the lowercased map key, so --map HR finds maps/hr.
    const id = ids.find((i) => i === map.toLowerCase());
    if (!id) throw new Error(`no story map "${map}" in maps/ (have: ${ids.join(", ")})`);
    return { root, dir: join(root, "maps", id), id };
  }
  if (ids.length === 1) return { root, dir: maps[0], id: ids[0] };
  throw new Error(`several story maps in maps/ (${ids.join(", ")}): pass --map <id>`);
}

/** A team repo is only a team: refused when it also has intent/ (its own maps are maps/<key>/). */
function assertTeamOnly(root: string): void {
  const clash = storyMapClash(root);
  if (clash) throw new Error(clash);
}

/** The maps a team owns: each maps/<key>/ in its own repo, in place. Empty for any other repo. */
export function ownMapsOf(root: string): StoryMapRef[] {
  if (!isTeamRepo(root)) return [];
  return mapDirs(root).map((dir) => ({ root, dir, id: basename(dir), team: true, own: true }));
}

/** Whether a map (--map's value, or a label like WEB-INB) names this map: its folder, its key, or its full label. */
function mapMatches(ref: StoryMapRef, map: string): boolean {
  return ref.id === map.toLowerCase() || keyOfMap(ref.dir) === map.toUpperCase() || labelOf(ref) === map;
}

/**
 * The map a team repo works on: one of its own maps, or one of its copies. --map picks by folder,
 * key or label; a team with one map of its own and no copies needs no flag.
 */
function teamRef(root: string, map?: string): StoryMapRef {
  const own = ownMapsOf(root);
  if (!own.length) return assignedRef(root, map);
  assertTeamOnly(root);
  const copies = assignedMaps(root);
  if (map) {
    const hit = own.find((r) => mapMatches(r, map));
    if (hit) return hit;
    if (!copies.length) throw new Error(`no story map "${map}" (have: ${own.map(labelOf).join(", ")})`);
    return assignedRef(root, map);
  }
  if (own.length === 1 && !copies.length) return own[0];
  throw new Error(`several story maps (${[...own, ...copies].map(labelOf).join(", ")}): pass --map <id>`);
}

/** Whether a folder's repo is one the team takes work from now. Unreadable team files count as no filter. */
function groupsOf(root: string): string[] | undefined {
  try {
    return openTeam(root).groups.map((g) => g.repo);
  } catch {
    return undefined;
  }
}

/**
 * Each copy of a group's map a team holds, from .nikos/assigned/<group>/maps/<id>/. A copy of a
 * group the team no longer takes work from isn't one: its stories stop resolving at once.
 */
export function assignedMaps(root: string): StoryMapRef[] {
  const assigned = join(root, ".nikos", "assigned");
  if (!store().isDir(assigned)) return [];
  const groups = groupsOf(root);
  return walk(assigned, "storymap.yaml")
    .filter((p) => !p.includes(`${sep}.fetch${sep}`) && basename(dirname(dirname(p))) === "maps")
    .map((p) => dirname(p))
    .sort()
    .map((dir) => ({ root, dir, id: basename(dir), team: true, copyRoot: repoRootOf(dir) }))
    .filter((ref) => !groups || groups.includes(relPath(assigned, ref.copyRoot!)));
}

/** GROUP-MAP for a copy, e.g. PAY-CHK, or TEAM-MAP for a team's own map: the id its stories carry, in full. */
export function labelOf(ref: StoryMapRef): string {
  return `${keyOf(ref.copyRoot ?? ref.root) ?? "?"}-${keyOfMap(ref.dir) ?? ref.id}`;
}

/** The copy a team works on: --map as GROUP-MAP, or a bare map key when only one copy has it. */
function assignedRef(root: string, map?: string): StoryMapRef {
  assertTeamOnly(root);
  const refs = assignedMaps(root);
  if (!refs.length) throw new Error(noAssignedMessage(root));
  const labels = refs.map(labelOf);
  if (!map) {
    if (refs.length === 1) return refs[0];
    throw new Error(`several assigned maps (${labels.join(", ")}): pass --map GROUP-MAP`);
  }
  const exact = refs.find((r) => labelOf(r) === map);
  if (exact) return exact;
  const bare = refs.filter((r) => r.id === map.toLowerCase() || keyOfMap(r.dir) === map.toUpperCase());
  if (bare.length === 1) return bare[0];
  if (bare.length > 1) throw new Error(`several assigned maps (${bare.map(labelOf).join(", ")}): pass --map GROUP-MAP`);
  throw new Error(`no assigned map "${map}" (have: ${labels.join(", ")})`);
}

/** Whether this team has synced: a lock exists. Before that, sync is the fix; after, the group's map is. */
const hasSynced = (root: string) => store().exists(join(root, ".nikos", "assigned", "lock.yaml"));

const noAssignedMessage = (root: string) =>
  hasSynced(root)
    ? "no stories are assigned to this team yet: the group's map needs nikos assign for this team (or check maps/<id>/assignments.yaml in the group repo)"
    : "no assigned stories yet: run nikos sync";

/** The team that a reassigned story's status file names, when this team's status still has the mark. */
function reassignedTo(root: string, id: string): string | undefined {
  const p = join(root, "status", `${id}.yaml`);
  if (!store().exists(p)) return undefined;
  return (parse(read(p)) as { reassigned_to?: string } | null)?.reassigned_to;
}

/** The story ids a copy's features hold: the ones this team has. */
export const heldIds = (ref: StoryMapRef): Set<string> =>
  new Set(walk(join(ref.dir, "features"), ".feature").flatMap((f) => featureStoryIds(read(f))));

/**
 * The story map a story-scoped command works on. In a team repo a story id picks the copy it's
 * in, so PAY-CHK-1 and ACME-CHK-1 never need --map. Other repos resolve as resolveStoryMap does.
 */
export function storyMapFor(start: string, opts: { story?: string; map?: string } = {}): StoryMapRef {
  if (opts.story && isTeamRepo(start)) {
    assertTeamOnly(start);
    const id = opts.story;
    const under = (r: StoryMapRef) => {
      const prefix = `${labelOf(r)}-`;
      return id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length));
    };
    const own = ownMapsOf(start).find(under);
    if (own) {
      if (!heldIds(own).has(id)) throw new Error(`${id} is not in maps/${own.id}/features`);
      return own;
    }
    const hit = assignedMaps(start).find(under);
    const moved = (why: string) => {
      const to = reassignedTo(start, id);
      return new Error(to ? `${id} was reassigned to ${to}: this team no longer works on it` : `${id} is not assigned to this team${why}`);
    };
    if (!hit && ownMapsOf(start).length && !assignedMaps(start).length) throw new Error(`${id} is not in any of this team's maps`);
    if (!hit) throw moved(hasSynced(start) ? ": the group's map doesn't assign it here" : ": run nikos sync");
    // A copy holds the group's map: a story the team no longer has can sit beside the ones it keeps.
    if (!heldIds(hit).has(id)) throw moved(": it's not in this team's copy");
    return hit;
  }
  return resolveStoryMap(start, opts.map);
}

/**
 * The story map a command that writes stories works on. A team repo's copies are read-only, and
 * its stories are authored in the group repo, so a team repo is refused here.
 */
export function authoringMap(dir: string, map?: string): StoryMapRef {
  if (isTeamRepo(dir)) {
    // A team writes its own maps; a copy of a group's (or another team's) map is authored where it was made.
    const own = ownMapsOf(dir);
    if (!own.length || (map && !own.some((r) => mapMatches(r, map)))) throw new Error(TEAM_REPO_STORIES);
    return teamRef(dir, map);
  }
  return resolveStoryMap(dir, map);
}

/** Where a story's state and approvals live for a map: the intent or map folder, or the team repo. */
export const homeOf = (ref: StoryMapRef): StoryHome => (ref.team ? { team: ref.root } : ref.dir);

/** Every story map in a repo: each maps/<id>, plus the intent/ map if there is one. A team's are its own maps and its assigned copies. */
export function storyMapsOf(root: string): StoryMapRef[] {
  if (isTeamRepo(root)) return [...ownMapsOf(root), ...assignedMaps(root)];
  const maps: StoryMapRef[] = mapDirs(root).map((dir) => ({ root, dir, id: basename(dir) }));
  const intent = findIntentDir(root);
  if (store().exists(join(intent, "storymap.yaml"))) maps.push({ root, dir: intent });
  return maps;
}

export const NO_GROUP_KEY = "planning/plan.yaml has no key: add key: <KEY> to it, then retry";
export const NO_TEAM_KEY = "nikos.team.yaml: a team that owns a map needs a key (nikos team init --key WEB), or an owner: in its storymap.yaml";
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
 * The prefix on a story's id: the map's key for intent/, or <OWNER>-<MAP> for a map in a group
 * repo, e.g. WEB-CHK, so the id is unique across the company. The map's owner comes first; a map
 * with no owner takes the group key of its repo (planning/plan.yaml, then nikos.team.yaml), e.g. PAY-CHK.
 * A team's copy reads the key of the repo it was copied from.
 */
export function storyPrefix(ref: StoryMapRef, key: string): string {
  if (!ref.id) return key;
  const owner = mapOwnerOf(ref.dir);
  if (owner) return `${owner}-${key}`;
  const group = keyOf(ref.copyRoot ?? ref.root);
  if (!group) throw new Error(NO_OWNER);
  return `${group}-${key}`;
}

/** The value of --map in CLI args, e.g. chk for --map chk. */
export const mapFlag = (args: string[]): string | undefined => {
  const i = args.indexOf("--map");
  return i >= 0 ? args[i + 1] : undefined;
};

