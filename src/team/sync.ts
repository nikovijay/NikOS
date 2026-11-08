// `nikos sync` in a team repo: fetch each group repo read-only, and copy the stories assigned to
// this team into .nikos/assigned/<group repo>/ (gitignored, rebuilt each sync). The group is never
// written to. The lock records the commit each copy was read at. A story this team had and that
// another team now holds is marked reassigned in its status/ file, kept as history.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { parse, parseDocument, stringify } from "yaml";
import { fetchCopy } from "../lib/fetch-copy.js";
import { loadMapData, readAssignments, holderOf, storiesOf, type Assignment, type MapData } from "../lib/assignments.js";
import { mapDirs } from "../lib/maps.js";
import { read, walk } from "../lib/project.js";
import { store } from "../lib/store.js";
import { storyFiles } from "../lib/state-files.js";
import { TEAM_FILE, clashingGroups, copyDirOf, ignoreAssigned, isTeamRepo, openTeam, storyMapClash, type TeamGroup } from "../lib/team.js";
import { git, repoEntry, type UpstreamEntry } from "../planning/upstream.js";

/** A group's key: the GROUP in its story ids, e.g. PAY. */
const GROUP_KEY = /^[A-Z][A-Z0-9]{0,9}$/;
const LOCK = "lock.yaml";
const today = () => new Date().toISOString().slice(0, 10);

export interface AssignedLock {
  repo: string;
  ref: string;
  commit: string;
  synced: string;
  stories: number;
}

/** The folder holding every group's copy, and the lock. Gitignored with the rest of .nikos/. */
export const assignedDirOf = (root: string) => join(root, ".nikos", "assigned");

/** The commit each group copy was read at, from .nikos/assigned/lock.yaml. */
export function readAssignedLock(root: string): AssignedLock[] {
  const p = join(assignedDirOf(root), LOCK);
  return existsSync(p) ? (parse(readFileSync(p, "utf8")) ?? []) : [];
}

/** Remove one group's lock entry, e.g. when a join is undone. */
export function dropFromLock(root: string, repo: string): void {
  const lock = readAssignedLock(root).filter((l) => l.repo !== repo);
  store().write(join(assignedDirOf(root), LOCK), `# Written by nikos sync: the group commit each copy was read at.\n${stringify(lock)}`);
}

/** The commit a group's branch is at now, or undefined when it can't be reached. */
export function lsRemoteCommit(entry: UpstreamEntry): string | undefined {
  const r = git(["ls-remote", entry.url, entry.ref]);
  return r.status === 0 ? r.stdout.split(/\s+/)[0] || undefined : undefined;
}

/**
 * One group's sync state in this team: its lock entry, whether its copy is on disk, and, with
 * remote, the commit it has moved on to (when it has). Everything that reports sync state reads it here.
 */
export function groupStatus(root: string, g: TeamGroup, opts: { remote?: boolean } = {}): { entry?: AssignedLock; synced: boolean; moved?: string } {
  const entry = readAssignedLock(root).find((l) => l.repo === g.repo);
  const synced = !!entry && store().isDir(copyDirOf(root, g.repo));
  if (!synced || !opts.remote) return { entry, synced };
  let now: string | undefined;
  try {
    now = lsRemoteCommit(repoEntry(g, TEAM_FILE));
  } catch {
    now = undefined; // a bad entry is reported by nikos team show and validate
  }
  return { entry, synced, moved: now && now !== entry!.commit ? now : undefined };
}

/** A group repo as fetched: its plan, its maps and their assignments. */
interface Group {
  entry: UpstreamEntry;
  commit: string;
  dir: string;
  key: string;
  maps: { dir: string; id: string; key: string; data: MapData; assignments: Assignment[] }[];
  /** The story ids this team's copy holds. */
  mine: Set<string>;
}

export interface GroupSync {
  repo: string;
  ref: string;
  commit?: string;
  stories: number;
  /** Set when the group couldn't be read: the copy from the last sync is kept. */
  unresolved?: string;
  /** The group was fetched but isn't a usable group plan (not level group, or no key). */
  invalid?: boolean;
}

export interface TeamSync {
  team: string;
  groups: GroupSync[];
  /** Stories another team now holds, marked in status/. */
  marked: { id: string; to: string }[];
  /** Stories this team has again: their reassigned mark is removed. */
  cleared: string[];
}

/** Read a fetched group: it must be a group plan with a key. Throws with the reason. */
function readGroup(dir: string, entry: UpstreamEntry, commit: string): Group {
  const planPath = join(dir, "planning", "plan.yaml");
  const plan = existsSync(planPath) ? parse(readFileSync(planPath, "utf8")) : undefined;
  if (plan?.level !== "group") throw new Error("is not a group plan (planning/plan.yaml's level isn't group)");
  if (typeof plan.key !== "string" || !GROUP_KEY.test(plan.key)) throw new Error("has no key in planning/plan.yaml");
  const maps = mapDirs(dir).map((d) => {
    const data = loadMapData(d);
    return { dir: d, id: basename(d), key: String(data.storymap?.key ?? ""), data, assignments: readAssignments(d) };
  });
  return { entry, commit, dir, key: plan.key, maps, mine: new Set() };
}

/**
 * Sync this team repo: fetch each group (or only: the one named), rebuild its copy, drop copies of
 * groups the team no longer takes work from, and mark stories other teams now hold.
 */
export function teamSync(root: string, opts: { only?: string } = {}): TeamSync {
  if (!isTeamRepo(root)) {
    // A solo repo with intent/ is neither a team nor a planning repo: point it at the team setup.
    const planning = store().isDir(join(root, "planning")) ? " planning repos use nikos planning sync" : "";
    throw new Error(`nikos sync is for a team repo that takes work from a group: nikos team init, then nikos team join <group repo>${planning ? `;${planning}` : ""}`);
  }
  const team = openTeam(root);
  const clash = storyMapClash(root);
  if (clash) throw new Error(clash);
  const nested = clashingGroups(team.groups.map((g) => g.repo));
  if (nested) throw new Error(`${nested[0]} and ${nested[1]} can't both be groups: one path sits inside the other`);
  if (opts.only && !team.groups.some((g) => g.repo === opts.only)) throw new Error(`${opts.only} isn't a group of this team`);
  ignoreAssigned(root);

  const assigned = assignedDirOf(root);
  const scratch = join(assigned, ".fetch");
  const previous = readAssignedLock(root);
  const out: TeamSync = { team: team.name, groups: [], marked: [], cleared: [] };
  const lock = previous.filter((l) => team.groups.some((g) => g.repo === l.repo));
  const fetched: Group[] = [];
  try {
    for (const g of team.groups) {
      if (opts.only && g.repo !== opts.only) continue;
      const entry = repoEntry(g, TEAM_FILE);
      const kept = previous.find((l) => l.repo === g.repo);
      const got = fetchCopy(entry.url, entry.ref, join(scratch, ...entry.repo.split("/")));
      if ("error" in got) {
        out.groups.push({ repo: g.repo, ref: entry.ref, stories: kept?.stories ?? 0, unresolved: got.error });
        continue;
      }
      try {
        fetched.push(readGroup(join(scratch, ...entry.repo.split("/")), entry, got.commit));
      } catch (err) {
        out.groups.push({ repo: g.repo, ref: entry.ref, stories: kept?.stories ?? 0, unresolved: (err as Error).message, invalid: true });
      }
    }

    for (const group of fetched) {
      const copy = copyDirOf(root, group.entry.repo);
      rmSync(copy, { recursive: true, force: true });
      for (const rel of ["planning/plan.yaml", ...walk(join(group.dir, "planning", "bets"), ".md").map((p) => relative(group.dir, p))]) {
        store().write(join(copy, rel), read(join(group.dir, rel)));
      }
      for (const map of group.maps) {
        const ids = new Set(map.assignments.filter((a) => a.repo === team.repo).flatMap((a) => storiesOf(map.data, a)));
        if (!ids.size) continue;
        const dest = join(copy, "maps", map.id);
        const storymap = map.data.storymap;
        // Every release and activity stays; each release keeps only this team's stories.
        const releases = (storymap.releases ?? []).map((r: any) => ({ ...r, stories: (r.stories ?? []).filter((id: string) => ids.has(id)) }));
        store().write(join(dest, "storymap.yaml"), stringify({ ...storymap, releases }));
        for (const f of map.data.features) if (ids.has(f.id)) store().write(join(dest, "features", relative(join(map.dir, "features"), f.path)), f.text);
        for (const a of storyFiles(join(map.dir, "approvals"))) if (ids.has(a.id)) store().write(join(dest, "approvals", `${a.id}.yaml`), read(a.path));
        for (const id of ids) group.mine.add(id);
      }
      const stories = group.mine.size;
      out.groups.push({ repo: group.entry.repo, ref: group.entry.ref, commit: group.commit, stories });
      const entry: AssignedLock = { repo: group.entry.repo, ref: group.entry.ref, commit: group.commit, synced: today(), stories };
      const at = lock.findIndex((l) => l.repo === entry.repo);
      if (at >= 0) lock[at] = entry;
      else lock.push(entry);
    }

    // A copy of a group the team no longer takes work from goes; its lock entry is dropped with it.
    // An unreachable group keeps its copy and lock entry from the last good sync.
    for (const l of previous) if (!team.groups.some((g) => g.repo === l.repo)) rmSync(copyDirOf(root, l.repo), { recursive: true, force: true });

    reassign(root, team.repo, fetched, out);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  store().write(join(assigned, LOCK), `# Written by nikos sync: the group commit each copy was read at.\n${stringify(lock)}`);
  return out;
}

/** Mark the story statuses that another team now holds, and clear the mark on stories that came back. */
function reassign(root: string, repo: string, fetched: Group[], out: TeamSync): void {
  for (const f of storyFiles(join(root, "status"))) {
    let hit: { group: Group; map: Group["maps"][number] } | undefined;
    for (const group of fetched) {
      for (const map of group.maps) {
        const prefix = `${group.key}-${map.key}-`;
        if (f.id.startsWith(prefix) && /^\d+$/.test(f.id.slice(prefix.length))) hit = { group, map };
      }
    }
    if (!hit) continue; // not from a group synced this run
    const doc = parseDocument(read(f.path));
    if (hit.group.mine.has(f.id)) {
      if (doc.has("reassigned_to")) {
        doc.delete("reassigned_to");
        doc.delete("reassigned_on");
        store().write(f.path, doc.toString({ flowCollectionPadding: false }));
        out.cleared.push(f.id);
      }
      continue;
    }
    const holder = holderOf(hit.map.assignments, hit.map.data, f.id);
    if (!holder || holder.repo === repo) continue; // nobody holds it yet: validate warns
    if (doc.get("reassigned_to") === holder.team) continue; // already marked for this team: the date stays when it happened
    doc.set("reassigned_to", holder.team);
    doc.set("reassigned_on", today());
    store().write(f.path, doc.toString({ flowCollectionPadding: false }));
    out.marked.push({ id: f.id, to: holder.team });
  }
}

/** `nikos sync` in a team repo: fetch the assigned stories, and say what changed. */
export function runTeamSync(args: string[]): number {
  const i = args.indexOf("--dir");
  const dir = i >= 0 ? args[i + 1] : process.cwd();
  try {
    const r = teamSync(dir);
    if (!r.groups.length) console.log("No groups yet: nikos team join <group repo> takes work from one.");
    for (const g of r.groups) {
      if (g.unresolved) console.log(`? ${g.repo} is unresolved: ${g.unresolved}. Kept the copy from the last sync.`);
      else console.log(`✓ ${g.repo} @ ${g.commit?.slice(0, 7)}: ${g.stories} ${g.stories === 1 ? "story" : "stories"} for ${r.team}`);
    }
    for (const m of r.marked) console.log(`! ${m.id} reassigned to ${m.to}: status/${m.id}.yaml marked, commit it`);
    for (const id of r.cleared) console.log(`✓ ${id} is back with this team: its reassigned mark is cleared, commit it`);
    if (r.marked.length || r.cleared.length) console.log("  nikos sync may change committed status/ files: commit them with your next change.");
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
