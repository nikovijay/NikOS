// Story maps. A group repo keeps one per bet, under maps/<id>/. Every other repo keeps its one
// story map in intent/, as it always has, and keeps working unchanged. A team repo reads the
// group maps copied into .nikos/assigned/ by nikos sync: each copy is a map folder, so the same
// commands work on it, with the team's own status in status/.
import { basename, dirname, join, sep } from "node:path";
import { parse } from "yaml";
import { store } from "./store.js";
import { featureStoryIds, findIntentDir, read, walk } from "./project.js";
import { isTeamRepo, openTeam, relPath, storyMapClash, TEAM_REPO_STORIES } from "./team.js";
import type { StoryHome } from "./state-files.js";

export interface StoryMapRef {
  /** The repo root: the folder with planning/ and intent/ or maps/ in it. A team's repo root, for a copy. */
  root: string;
  /** The folder holding storymap.yaml: intent/, maps/<id>, or a team's copy of one. */
  dir: string;
  /** Set only for maps/<id> and a team's copy of one. */
  id?: string;
  /** Set for a team's copy of a group's map: the team's status lives in the team repo. */
  team?: boolean;
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
function keyOfMap(dir: string): string | undefined {
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
    return { root: repoRootOf(start), dir: start, id: basename(start) };
  }
  if (isTeamRepo(start)) return assignedRef(start, map);
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
    if (!ids.includes(map)) throw new Error(`no story map "${map}" in maps/ (have: ${ids.join(", ")})`);
    return { root, dir: join(root, "maps", map), id: map };
  }
  if (ids.length === 1) return { root, dir: maps[0], id: ids[0] };
  throw new Error(`several story maps in maps/ (${ids.join(", ")}): pass --map <id>`);
}

/** A team repo is only a team: refused when it also has its own story map. */
function assertTeamOnly(root: string): void {
  const clash = storyMapClash(root);
  if (clash) throw new Error(clash);
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

/** GROUP-MAP for a copy, e.g. PAY-CHK: the id its stories carry, in full. */
function labelOf(ref: StoryMapRef): string {
  return `${(ref.copyRoot && groupKeyOf(ref.copyRoot)) ?? "?"}-${keyOfMap(ref.dir) ?? ref.id}`;
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
    const hit = assignedMaps(start).find((r) => {
      const prefix = `${labelOf(r)}-`;
      return id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length));
    });
    const moved = (why: string) => {
      const to = reassignedTo(start, id);
      return new Error(to ? `${id} was reassigned to ${to}: this team no longer works on it` : `${id} is not assigned to this team${why}`);
    };
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
  if (isTeamRepo(dir)) throw new Error(TEAM_REPO_STORIES);
  return resolveStoryMap(dir, map);
}

/** Where a story's state and approvals live for a map: the intent or map folder, or the team repo. */
export const homeOf = (ref: StoryMapRef): StoryHome => (ref.team ? { team: ref.root } : ref.dir);

/** Every story map in a repo: each maps/<id>, plus the intent/ map if there is one. A team's are its assigned copies. */
export function storyMapsOf(root: string): StoryMapRef[] {
  if (isTeamRepo(root)) return assignedMaps(root);
  const maps: StoryMapRef[] = mapDirs(root).map((dir) => ({ root, dir, id: basename(dir) }));
  const intent = findIntentDir(root);
  if (store().exists(join(intent, "storymap.yaml"))) maps.push({ root, dir: intent });
  return maps;
}

export const NO_GROUP_KEY = "planning/plan.yaml has no key: add key: <KEY> to it, then retry";

/**
 * The prefix on a story's id: the map's key for intent/, or <GROUP>-<MAP> for a map in a group
 * repo, e.g. PAY-CHK, so the id is unique across the company. A team's copy reads the group key
 * from the copy of the group repo.
 */
export function storyPrefix(ref: StoryMapRef, key: string): string {
  if (!ref.id) return key;
  const group = groupKeyOf(ref.copyRoot ?? ref.root);
  if (!group) throw new Error(NO_GROUP_KEY);
  return `${group}-${key}`;
}

/** The value of --map in CLI args, e.g. chk for --map chk. */
export const mapFlag = (args: string[]): string | undefined => {
  const i = args.indexOf("--map");
  return i >= 0 ? args[i + 1] : undefined;
};

