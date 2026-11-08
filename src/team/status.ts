// The group's view of its teams' work. A group fetches each assigned team's repo read-only
// (status/, approvals/ and nikos.team.yaml only) into .nikos/teams/<repo>/, and judges every
// story against the group's current feature: a team's status counts only when the team proved it
// against that feature. Nothing is written to a team's repo, and nothing here changes the group's
// own files except the index of what was read (.nikos/teams/index.json, gitignored).
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parse } from "yaml";
import { store } from "../lib/store.js";
import { fetchCopy } from "../lib/fetch-copy.js";
import { ASSIGNMENTS, holderOf, loadMapData, mapStoryIds, readAssignments, storiesOf, type Assignment, type MapData } from "../lib/assignments.js";
import { mapDirs } from "../lib/maps.js";
import { isDone, specHash } from "../lib/project.js";
import { loadApprovalEntries, loadStates, type StoryState } from "../lib/state-files.js";
import { loadApprovals, teamApprovalLapse, type Approval, type DeliveryApproval } from "../lib/approvals.js";
import { ignoreCache, repoEntry, type UpstreamEntry } from "../planning/upstream.js";

export type Freshness = "current" | "changed" | "behind" | "unverified" | "moved" | "unassigned" | "not-fetched" | "no-status" | "in-place";
export const FRESHNESS: Freshness[] = ["current", "changed", "behind", "unverified", "moved", "unassigned", "not-fetched", "no-status", "in-place"];

/** What a group fetched from one team's repo, and what it read there. */
export interface TeamCopy {
  team: string;
  repo: string;
  url: string;
  ref: string;
  /** Whether the last fetch worked. A failed fetch keeps the copy from the last good one. */
  ok: boolean;
  /** The commit of the last good fetch, and its date. */
  commit?: string;
  fetched?: string;
  attempted?: string;
  error?: string;
  /** The stories assigned to this team at its last good fetch. */
  held: string[];
  /** A team no longer assigned any story, read for the stories it gave up. */
  retired?: boolean;
}

export interface TeamIndex {
  teams: Record<string, TeamCopy>;
  /** The team repo that held each story last: a move stays visible until the new holder has its own status. */
  holders: Record<string, string>;
}

/** The paths of a team repo a group reads. Everything else in a team's repo is code, and isn't kept. */
const TEAM_PATHS = ["status", "approvals", "nikos.team.yaml"];

const today = () => new Date().toISOString().slice(0, 10);
const EMPTY = (): TeamIndex => ({ teams: {}, holders: {} });

const teamsDir = (root: string) => join(root, ".nikos", "teams");
const indexPath = (root: string) => join(teamsDir(root), "index.json");
export const teamCopyDir = (root: string, repo: string) => join(teamsDir(root), ...repo.split("/"));

/** The index of what was read, or an empty one when there's none (or it doesn't read). */
export function readTeamIndex(root: string): TeamIndex {
  const p = indexPath(root);
  if (!store().exists(p)) return EMPTY();
  try {
    const data = JSON.parse(store().read(p));
    return {
      teams: data?.teams && typeof data.teams === "object" ? data.teams : {},
      holders: data?.holders && typeof data.holders === "object" ? data.holders : {},
    };
  } catch {
    return EMPTY();
  }
}

/** Write the index. The cache is gitignored first, so it's never committed. */
export function writeTeamIndex(root: string, index: TeamIndex): void {
  ignoreCache(root);
  store().write(indexPath(root), `${JSON.stringify(index, null, 2)}\n`);
}

/** A group map as the group reads it: its storymap and features, and the assignments that split it. */
export interface GroupMap {
  dir: string;
  id: string;
  key: string;
  data: MapData;
  list: Assignment[];
}

export function loadGroupMap(dir: string): GroupMap {
  const data = loadMapData(dir);
  return { dir, id: basename(dir), key: String(data.storymap?.key ?? basename(dir)), data, list: readAssignments(dir) };
}

/** Every map in a group repo, with its assignments. */
export const groupMaps = (root: string): GroupMap[] => mapDirs(root).map(loadGroupMap);

/** A story's feature fingerprint in a map: what a team has to prove against. */
export function featureHashIn(data: MapData, id: string): string {
  return specHash(data.features.find((f) => f.id === id)?.text ?? "");
}

/** The content of a file in the team's copy, when it's there and reads. */
function readYaml<T>(path: string): T | undefined {
  if (!store().exists(path)) return undefined;
  try {
    const v = parse(store().read(path));
    return v && typeof v === "object" ? (v as T) : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a team's copy is on disk from a good fetch. */
function hasGoodCopy(root: string, index: TeamIndex, repo: string): boolean {
  return !!index.teams[repo]?.commit && store().isDir(teamCopyDir(root, repo));
}

/**
 * One story's status and delivery approval as the team's copy has them. Undefined when no good
 * copy is on disk. repo "." (the group itself) isn't a copy: its state is in the map folder.
 */
export function readTeamStory(root: string, repo: string, id: string, index: TeamIndex = readTeamIndex(root)) {
  if (repo === "." || !hasGoodCopy(root, index, repo)) return undefined;
  const dir = teamCopyDir(root, repo);
  return {
    copy: index.teams[repo],
    status: readYaml<StoryState>(join(dir, "status", `${id}.yaml`)),
    approval: readYaml<DeliveryApproval>(join(dir, "approvals", `${id}.yaml`)),
  };
}

/**
 * Fetch each assigned team's repo (and the ones a story has moved away from) into the cache, and
 * rebuild the index. A failed fetch keeps the last good copy. offline reads the cache only: the
 * assignments are still read from the group, so holders and held stories are current.
 */
export function fetchTeams(root: string, opts: { offline?: boolean } = {}): TeamIndex {
  if (!opts.offline) ignoreCache(root); // before the first copy is written: .nikos/ is never committed
  const prev = readTeamIndex(root);
  const maps = groupMaps(root);
  const current: Record<string, string> = {};
  const teams = new Map<string, { team: string; entry: UpstreamEntry; held: string[]; retired?: boolean }>();
  for (const m of maps) {
    for (const a of m.list) {
      const ids = storiesOf(m.data, a);
      for (const id of ids) current[id] = a.repo;
      if (a.repo === ".") continue;
      const t = teams.get(a.repo) ?? { team: a.team, entry: repoEntry(a, ASSIGNMENTS), held: [] };
      t.held.push(...ids);
      teams.set(a.repo, t);
    }
  }
  // A team that gave a story away is still read, for the status mark it leaves in its own repo.
  for (const [id, old] of Object.entries(prev.holders)) {
    const now = current[id];
    if (now && now !== old && old !== "." && !teams.has(old) && prev.teams[old]) {
      const p = prev.teams[old];
      teams.set(old, { team: p.team, entry: { repo: old, ref: p.ref, url: p.url }, held: [], retired: true });
    }
  }

  const kept = (before?: TeamCopy): Partial<TeamCopy> => ({
    ok: before?.ok ?? false,
    commit: before?.commit,
    fetched: before?.fetched,
    attempted: before?.attempted,
    error: before?.error,
  });
  const out: Record<string, TeamCopy> = {};
  const scratch = join(teamsDir(root), ".fetch");
  try {
    for (const [repo, t] of teams) {
      const before = prev.teams[repo];
      const base = { team: t.team, repo, url: t.entry.url, ref: t.entry.ref, held: t.held, ...(t.retired ? { retired: true } : {}) };
      if (opts.offline) {
        out[repo] = { ...base, ...kept(before) } as TeamCopy;
        continue;
      }
      const fetchedAt = join(scratch, ...repo.split("/"));
      const got = fetchCopy(t.entry.url, t.entry.ref, fetchedAt, TEAM_PATHS);
      if ("error" in got) {
        out[repo] = { ...base, ...kept(before), ok: false, attempted: today(), error: got.error } as TeamCopy;
        continue;
      }
      // Only what the team's status is read from is kept: a full clone's code is dropped here.
      for (const f of readdirSync(fetchedAt)) if (!TEAM_PATHS.includes(f)) rmSync(join(fetchedAt, f), { recursive: true, force: true });
      const dir = teamCopyDir(root, repo);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dirname(dir), { recursive: true });
      renameSync(fetchedAt, dir);
      out[repo] = { ...base, ok: true, commit: got.commit, fetched: today(), attempted: today() } as TeamCopy;
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  // Who holds each story, as the group last saw it. The old holder is kept until the new one has
  // its own status for the story, so a move shows as a move, and the old team's last status shows.
  const holders: Record<string, string> = {};
  for (const id of new Set([...Object.keys(current), ...Object.keys(prev.holders)])) {
    const now = current[id];
    const old = prev.holders[id];
    // Released: nobody holds it, so there's no move to show for it later.
    if (!now) continue;
    if (!old || now === old) {
      holders[id] = now;
      continue;
    }
    const settled = now === "." || (!!out[now]?.commit && store().exists(join(teamCopyDir(root, now), "status", `${id}.yaml`)));
    holders[id] = settled ? now : old;
  }
  for (const repo of Object.keys(prev.teams)) if (!out[repo]) rmSync(teamCopyDir(root, repo), { recursive: true, force: true });
  const index = { teams: out, holders };
  writeTeamIndex(root, index);
  return index;
}

/** What the group can say about one story, from the holder's facts. */
export interface Facts {
  H: string;
  /** The holding team's name. Undefined: nobody holds the story. */
  holder?: string;
  repo?: string;
  /** The group itself holds it (--repo .): its state is in the map folder. */
  inPlace?: boolean;
  copy?: TeamCopy;
  copyGood?: boolean;
  status?: StoryState;
  approval?: DeliveryApproval;
  /** The team that held the story before this one, if it moved. */
  prev?: { repo: string; team?: string; known?: boolean; copyGood?: boolean; status?: StoryState };
  /** approval.policy here. Undefined reads as the default, optional: a done story counts without an approval unless required-for-release. */
  policy?: string;
}

export interface Verdict {
  freshness: Freshness;
  reason: string;
  /** Done, and the delivery approval holds (or approvals are off). */
  approved?: boolean;
  approvedBy?: string;
  lapse?: string;
  /** Done, with no approval needed here (approval.policy is optional): counts as done, shown as optional. */
  optional?: boolean;
}

/**
 * How far a team's status can be trusted for the story's current feature. The checks run in
 * order, and the first that applies decides: unassigned, in place, not fetched, moved, no status,
 * no spec hash, changed or behind the feature, otherwise current (with the delivery approval).
 */
export function classify(f: Facts): Verdict {
  if (!f.holder) return { freshness: "unassigned", reason: "nobody holds it: nikos assign gives it to a team" };
  if (f.inPlace) return { freshness: "in-place", reason: "held by this group (--repo .)" };
  const team = f.holder;
  if (!f.copyGood) {
    const err = f.copy?.ok === false && f.copy.error ? ` (fetch failed: ${f.copy.error.split("\n")[0]})` : "";
    return { freshness: "not-fetched", reason: `${team} hasn't been fetched: run nikos map status${err}` };
  }
  const p = f.prev;
  if (p && p.repo !== f.repo) {
    const name = p.team ?? p.repo;
    if (p.repo === ".") return { freshness: "moved", reason: `moved to ${team}; previously held by this group` };
    if (!p.copyGood) return { freshness: "moved", reason: `moved to ${team}; previous team ${name} not fetched` };
    if (p.status) {
      const last = p.status.status;
      // The group reads committed files only: a mark the old team hasn't committed doesn't show yet.
      if (p.status.reassigned_to === team) return { freshness: "moved", reason: `moved to ${team}; ${name} recorded the move (last ${last})` };
      return { freshness: "moved", reason: `moved to ${team}; ${name} hasn't committed the move (last ${last})` };
    }
    return { freshness: "moved", reason: `moved to ${team}; ${name} has no status for it` };
  }
  if (!f.status) return { freshness: "no-status", reason: `no status from ${team} yet: it shows once ${team} runs nikos sync and starts the story` };
  if (!f.status.spec_hash) return { freshness: "unverified", reason: `${team} set this before spec hashes: run nikos sync in ${team}, then nikos state set <id> needs_rework, then in_progress` };
  if (f.status.spec_hash !== f.H) {
    // A team can't set its own in_progress again, so the way back runs through needs_rework.
    if (isDone(f.status.status)) return { freshness: "changed", reason: `proved against an older feature: ${team} runs nikos sync, then nikos state set <id> needs_rework, then in_progress, then done` };
    return { freshness: "behind", reason: `${team}'s copy is behind the feature: run nikos sync in ${team}, then nikos state set <id> needs_rework, then in_progress` };
  }
  if (!isDone(f.status.status)) return { freshness: "current", reason: "" };
  if (f.policy === "off") return { freshness: "current", reason: "done (approvals are off here)", approved: true };
  const optional = f.policy !== "required-for-release";
  if (!f.approval) return optional ? { freshness: "current", reason: "done (approval optional here)", optional: true } : { freshness: "current", reason: "done, not approved" };
  const lapse = teamApprovalLapse(f.approval, f.status, f.H);
  if (lapse) return { freshness: "current", reason: `done, approval lapsed: ${lapse}`, lapse, ...(optional ? { optional: true } : {}) };
  return { freshness: "current", reason: `done, approved by ${f.approval.by} ${f.approval.on}`, approved: true, approvedBy: f.approval.by };
}

/** One story as the group shows it: the team's status, how far to trust it, and both approvals. */
export interface StoryView {
  id: string;
  /** The holder's repo path, "." for this group, or undefined when nobody holds it. */
  repo?: string;
  team?: string;
  /** The status shown: the copy's, or todo. */
  status: string;
  ticket?: string;
  freshness: Freshness;
  reason: string;
  copy: "fetched" | "last-copy" | "none";
  /** The date of the copy's good fetch, when there is one. */
  fetched?: string;
  /** The delivery approval, as the team's table shows it. */
  delivery: string;
  /** The group's intent approval, as the map shows it. */
  intent: string;
  /** For a moved story: the team that held it before, and its last status. */
  from?: { team: string; repo: string; status?: string };
  /** Done and counted: done and current with its delivery approval (or none needed here), or done in place. */
  done: boolean;
  /** Done and current, but approval is required here and its delivery approval is missing or lapsed. */
  awaiting: boolean;
  /** The team's status doesn't match the current feature: changed, behind or unverified. */
  notCurrent: boolean;
}

const NOTCURRENT: Freshness[] = ["changed", "behind", "unverified"];

/** Build a story's view from its facts, and whether its delivery approval holds. */
function viewOf(id: string, f: Facts, copy: StoryView["copy"], intent: string, fetched?: string): StoryView {
  const v = classify(f);
  const shown = f.status?.status ?? (v.freshness === "not-fetched" ? "unknown" : "todo");
  const inPlace = v.freshness === "in-place";
  const current = v.freshness === "current";
  // A story whose team isn't fetched counts the group's own state, as it did before teams were read.
  const done = isDone(shown) && (inPlace || v.freshness === "not-fetched" || (current && (!!v.approved || !!v.optional)));
  const awaiting = isDone(shown) && !inPlace && current && !v.approved && !v.optional;
  let delivery = "-";
  if (inPlace) delivery = "n/a (in place)";
  else if (isDone(shown)) {
    delivery = v.approved
      ? v.approvedBy
        ? `approved by ${v.approvedBy}`
        : "not required (approvals off)"
      : v.freshness === "not-fetched"
        ? "unknown (not fetched)"
        : v.lapse
          ? "approval lapsed"
          : v.optional
            ? "not required (approval optional)"
            : !current && f.approval
              ? "approved for an older feature"
              : "not approved";
  }
  const from = v.freshness === "moved" && f.prev ? { team: f.prev.repo === "." ? "this group" : (f.prev.team ?? f.prev.repo), repo: f.prev.repo, ...(f.prev.status ? { status: f.prev.status.status } : {}) } : undefined;
  return {
    id,
    ...(f.repo !== undefined ? { repo: f.repo } : {}),
    ...(f.holder ? { team: f.holder } : {}),
    status: shown,
    ...(f.status?.ticket ? { ticket: f.status.ticket } : {}),
    freshness: v.freshness,
    reason: v.reason,
    copy,
    ...(fetched ? { fetched } : {}),
    delivery,
    intent,
    ...(from ? { from } : {}),
    done,
    awaiting,
    notCurrent: NOTCURRENT.includes(v.freshness),
  };
}

/** The group's intent approval for a story, checked against the current feature. */
function intentOf(map: GroupMap, id: string, H: string): string {
  const a: Approval | undefined = loadApprovals(map.dir)[id];
  if (!a) return "-";
  return a.spec_hash === H ? `approved by ${a.by}` : "approved for an older spec";
}

/**
 * One story of a group map, judged against its holder. holder is the assignment that gives it to
 * a team (or to this group, with repo "."), or undefined when nobody holds it.
 */
export function storyView(opts: { root: string; map: GroupMap; id: string; holder?: Assignment; index: TeamIndex; H: string; policy?: string }): StoryView {
  const { root, map, id, holder, index, H, policy } = opts;
  const intent = intentOf(map, id, H);
  if (!holder) return viewOf(id, { H, policy }, "none", intent);
  if (holder.repo === ".") {
    const status = loadStates(map.dir)[id];
    return viewOf(id, { H, holder: holder.team, repo: ".", inPlace: true, status, policy }, "fetched", intent);
  }
  const copy = index.teams[holder.repo];
  const good = hasGoodCopy(root, index, holder.repo);
  const read = good ? readTeamStory(root, holder.repo, id, index) : undefined;
  // With no good copy, the group's own state.yaml is the only status there is: shown, and not current.
  const status = good ? read?.status : loadStates(map.dir)[id];
  const old = index.holders[id];
  let prev: Facts["prev"];
  if (old !== undefined && old !== holder.repo) {
    if (old === ".") prev = { repo: ".", known: true, copyGood: true };
    else {
      const pc = index.teams[old];
      const pr = pc && hasGoodCopy(root, index, old) ? readTeamStory(root, old, id, index) : undefined;
      prev = { repo: old, team: pc?.team ?? old, known: !!pc, copyGood: !!pr, status: pr?.status };
    }
  }
  const fetched = good ? copy?.fetched : undefined;
  return viewOf(
    id,
    { H, holder: holder.team, repo: holder.repo, copy, copyGood: good, status, approval: read?.approval, prev, policy },
    !good ? "none" : copy?.ok ? "fetched" : "last-copy",
    intent,
    fetched,
  );
}

/** Every story of a group map (or only the listed ids), as the group sees its teams' work. */
export function mapViews(root: string, map: GroupMap, index: TeamIndex, ids?: string[], policy?: string): StoryView[] {
  return (ids ?? mapStoryIds(map.data)).map((id) =>
    storyView({ root, map, id, holder: holderOf(map.list, map.data, id), index, H: featureHashIn(map.data, id), policy }),
  );
}

/**
 * A team's own view of its copy of a group's story: the team's status and approval are its own,
 * judged against the copy's feature. Used by the team's delivery, so its dashboard counts its work.
 */
export function ownView(root: string, team: string, id: string, H: string, policy?: string): StoryView {
  const status = loadStates({ team: root })[id];
  const approval = loadApprovalEntries<DeliveryApproval>({ team: root })[id];
  return viewOf(id, { H, holder: team, copyGood: true, status, approval, policy }, "fetched", "-");
}

/** The commit a team's index entry was read at, shortened, for messages. */
export const short = (commit?: string) => (commit ?? "").slice(0, 7);
