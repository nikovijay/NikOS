import { urlProblem } from "../lib/fetch-copy.js";
// `nikos assign "<team>" --repo <path>`: give a team all or part of a group's story map. Run in the
// group repo. It adds to what the team already has, and --replace redefines its part. Each story belongs to at most one team. A done story stays with the team that
// delivered it unless --include-done moves it. Assignments are written to maps/<id>/assignments.yaml.
import { join, resolve } from "node:path";
import { isDone } from "../lib/project.js";
import { homeOf, mapDirs, ownMapsOf, resolveStoryMap, type StoryMapRef } from "../lib/maps.js";
import { isTeamRepo, isRepoArg } from "../lib/team.js";
import { loadStates } from "../lib/state-files.js";
import { store } from "../lib/store.js";
import { checkAssignments, loadMapData, mapStoryIds, readAssignments, storiesOf, writeAssignments, type Assignment, type MapData } from "../lib/assignments.js";
import { readTeamIndex, readTeamStory, writeTeamIndex, type TeamIndex } from "../team/status.js";

export interface AssignOptions {
  repo: string;
  activities?: string[];
  releases?: number[];
  stories?: string[];
  map?: string;
  includeDone?: boolean;
  /** Redefine the team's part instead of adding to it. */
  replace?: boolean;
  /** The team repo's url and branch, stored only when given. */
  url?: string;
  ref?: string;
}

export interface AssignResult {
  team: string;
  /** The map's key, and the number of stories this team now holds. */
  map: string;
  stories: number;
  /** Stories taken from other teams, by team name. */
  moved: { from: string; count: number }[];
  /** Whether this team already had an entry, which was added to or replaced. */
  updated: boolean;
  /** Stories the team gave up with --replace. */
  dropped: string[];
  /** Stories no team holds now. */
  unassigned: string[];
  /** Things to know that don't stop the assignment, e.g. a holder's status read from the group's own state. */
  warnings: string[];
  /** Notes on what happened to done stories moved with --include-done. */
  notes: string[];
}

/** A list flag as values: "pay,confirm" becomes ["pay", "confirm"]. */
const list = (s: string | undefined) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined);

/** Each selector's value checked against the map, with the choices listed when it's wrong. */
function checkSelectors(map: MapData, opts: AssignOptions, label: string): void {
  const have = (xs: string[]) => (xs.length ? xs.join(", ") : "none");
  for (const act of opts.activities ?? []) {
    if (!map.activities.includes(act)) throw new Error(`no activity "${act}" in ${label} (have: ${have(map.activities)})`);
  }
  const releases = [...map.releases.keys()].sort((a, b) => a - b).map(String);
  for (const n of opts.releases ?? []) {
    if (!map.releases.has(n)) throw new Error(`no release ${n} in ${label} (have: ${have(releases)})`);
  }
  const ids = mapStoryIds(map);
  for (const id of opts.stories ?? []) {
    if (!ids.includes(id)) throw new Error(`no story ${id} in ${label} (have: ${have(ids)})`);
  }
}

/** Assign a team its part of a group's map, moving stories held by other teams where the rules allow. */
export function assign(dir: string, team: string, opts: AssignOptions): AssignResult {
  const root = resolve(dir);
  if (isTeamRepo(root) && !ownMapsOf(root).length) throw new Error("this is a team repo: assignments are made in the group repo, or in a team repo for a map it owns");
  if (!mapDirs(root).length && !ownMapsOf(root).length) throw new Error("nikos assign needs a group repo with maps/: nikos group init, then nikos map new");
  const name = team.trim();
  if (!name) throw new Error("Give the team's name, e.g. nikos assign \"Checkout web\" --repo acme/checkout-web");
  if (!opts.repo || !isRepoArg(opts.repo)) throw new Error("nikos assign needs --repo <path>: the team's repo, as owner/repo, or . when this repo is its own team");
  const selected = [opts.activities, opts.releases, opts.stories].filter((x) => x !== undefined).length;
  if (selected > 1) throw new Error("give one of --activities, --releases or --stories, not several");
  if (opts.url) {
    const bad = urlProblem(opts.url);
    if (bad) throw new Error(bad);
  }

  const ref: StoryMapRef = resolveStoryMap(root, opts.map);
  if (isTeamRepo(root) && !ref.own) throw new Error("this is a team's copy of a map: its assignments are made where the map is owned");
  const map = loadMapData(ref.dir);
  const label = `maps/${ref.id}`;
  checkSelectors(map, opts, `${label}/storymap.yaml`);
  const mapKey = String(map.storymap?.key ?? ref.id);

  const list0 = readAssignments(ref.dir);
  const before = list0.find((a) => a.repo === opts.repo);
  const asked: Assignment = { team: name, repo: opts.repo };
  if (opts.activities) asked.activities = opts.activities;
  if (opts.releases) asked.releases = opts.releases;
  if (opts.stories) asked.stories = opts.stories;
  if (opts.url) asked.url = opts.url;
  if (opts.ref) asked.ref = opts.ref;
  // --replace redefines the stories, but keeps the team's stored url and ref unless this call gives new ones.
  const entry = before && !opts.replace ? combine(map, before, asked) : { ...asked, ...urlOf({ ...before, ...asked }) };
  const next = storiesOf(map, entry);
  const dropped = before ? storiesOf(map, before).filter((id) => !next.includes(id)) : [];

  const states = loadStates(homeOf(ref));
  const index = readTeamIndex(root);
  const warnings: string[] = [];
  const notes: string[] = [];
  const moved: AssignResult["moved"] = [];
  const updated = list0.some((a) => a.repo === opts.repo);
  const out: Assignment[] = [];
  const movedIds: { id: string; from: string }[] = [];
  for (const other of list0) {
    // The same repo's entry is replaced, not moved from.
    if (other.repo === opts.repo) continue;
    const overlap = storiesOf(map, other).filter((id) => next.includes(id));
    if (!overlap.length) {
      out.push(other);
      continue;
    }
    const doneIds: string[] = [];
    for (const id of overlap) {
      const h = doneOf(root, index, states, other, id);
      if (h.fallback) warnings.push(`${id} is held by ${other.team}, which isn't fetched: checked the group's own state.yaml (run nikos map status first)`);
      if (!h.done) continue;
      if (!opts.includeDone) throw new Error(h.refusal);
      doneIds.push(id);
    }
    if (doneIds.length) notes.push(`${doneIds.length === 1 ? "1 done story" : `${doneIds.length} done stories`} moved from ${other.team}: new team starts at todo; delivery approval stays with ${other.team}`);
    moved.push({ from: other.team, count: overlap.length });
    movedIds.push(...overlap.map((id) => ({ id, from: other.repo })));
    // What's left of the other team's part, as explicit stories; nothing left removes its entry.
    const rest = storiesOf(map, other).filter((id) => !next.includes(id));
    if (rest.length) out.push({ team: other.team, repo: other.repo, stories: rest, ...urlOf(other) });
  }
  out.push(entry);
  // The new entry must hold no story twice; checkAssignments would say so.
  const check = checkAssignments(map, out, label);
  if (check.errors.length) throw new Error(check.errors[0]);
  writeAssignments(ref.dir, out);
  const held = new Set(out.flatMap((a) => storiesOf(map, a)));
  const unassigned = mapStoryIds(map).filter((id) => !held.has(id));
  // A move is recorded against the team that gave the story up, so the group can say it moved until
  // that team's copy shows it (no network). A story released to nobody drops its old holder, so it
  // isn't later shown as moved. The record is written whether or not the group has read its teams yet.
  const released = unassigned.filter((id) => index.holders[id] !== undefined);
  if (movedIds.length || released.length) {
    const holders = { ...index.holders };
    for (const id of released) delete holders[id];
    for (const m of movedIds) holders[m.id] = m.from;
    writeTeamIndex(root, { ...index, holders } as TeamIndex);
  }

  return { team: name, map: mapKey, stories: next.length, moved, updated, dropped, unassigned, warnings, notes };
}

/** The url and branch an entry carries, when it was given. */
const urlOf = (a: Assignment): Partial<Assignment> => ({ ...(a.url ? { url: a.url } : {}), ...(a.ref ? { ref: a.ref } : {}) });

/**
 * Whether a story is done in the team that holds it. The team's own status is read from its copy
 * when it's fetched; otherwise the group's own state.yaml is the fallback, and the caller warns.
 * refusal is the message when the story is done and must not move.
 */
export function doneOf(root: string, index: TeamIndex, states: Record<string, { status?: string }>, holder: Assignment, id: string): { done: boolean; fallback?: boolean; refusal: string } {
  if (holder.repo === ".") {
    const done = isDone(states[id]?.status);
    return { done, refusal: `${id} is done and held by ${holder.team}: assign won't move a done story (use --include-done)` };
  }
  const got = readTeamStory(root, holder.repo, id, index);
  if (got) {
    const done = isDone(got.status?.status);
    const c = got.copy;
    const src = `status read from ${holder.repo} status/, fetched ${c.fetched} at ${(c.commit ?? "").slice(0, 7)}`;
    return { done, refusal: `${id} is done and held by ${holder.team} (${src}): assign won't move a done story (use --include-done)` };
  }
  const done = isDone(states[id]?.status);
  return { done, fallback: true, refusal: `${id} is done and held by ${holder.team}: assign won't move a done story (use --include-done)` };
}

/** A team's part with more added: the same selector merges, a whole map stays whole, and a mix becomes stories. */
function combine(map: MapData, before: Assignment, asked: Assignment): Assignment {
  const out: Assignment = { team: asked.team, repo: asked.repo, ...urlOf({ ...before, ...asked }) };
  const sel = (a: Assignment) => (a.releases ? "releases" : a.activities ? "activities" : a.stories ? "stories" : undefined);
  const was = sel(before);
  const now = sel(asked);
  if (!was || !now) return out; // either one is the whole map
  if (was === now) {
    (out as any)[was] = [...new Set([...((before as any)[was] as unknown[]), ...((asked as any)[now] as unknown[])])];
    if (was === "releases") out.releases!.sort((a, b) => a - b);
    return out;
  }
  const ids = new Set([...storiesOf(map, before), ...storiesOf(map, asked)]);
  out.stories = mapStoryIds(map).filter((id) => ids.has(id));
  return out;
}

export interface UnassignOptions {
  /** The team's repo path, or "." for this group. */
  team: string;
  map?: string;
  stories?: string[];
  activities?: string[];
  releases?: number[];
}

/**
 * Take stories back from a team: the whole of its part, or the stories, activities or releases
 * named. A done story is refused, the same as assign refuses to move one (no override here).
 * The stories left with the team stay as explicit story ids.
 */
export function unassign(dir: string, opts: UnassignOptions): { team: string; removed: string[]; left: number } {
  const root = resolve(dir);
  if (isTeamRepo(root) && !ownMapsOf(root).length) throw new Error("this is a team repo: assignments are made in the group repo, or in a team repo for a map it owns");
  if (!mapDirs(root).length && !ownMapsOf(root).length) throw new Error("nikos assign needs a group repo with maps/: nikos group init, then nikos map new");
  const selected = [opts.activities, opts.releases, opts.stories].filter((x) => x !== undefined).length;
  if (selected > 1) throw new Error("give one of --activities, --releases or --stories, not several");
  const ref: StoryMapRef = resolveStoryMap(root, opts.map);
  if (isTeamRepo(root) && !ref.own) throw new Error("this is a team's copy of a map: its assignments are made where the map is owned");
  const map = loadMapData(ref.dir);
  const list = readAssignments(ref.dir);
  const entry = list.find((a) => a.repo === opts.team);
  if (!entry) throw new Error(`${opts.team} has no part of maps/${ref.id ?? "intent"} to give up`);
  const held = storiesOf(map, entry);
  const ids = opts.stories ?? (opts.activities ? map.features.filter((f) => opts.activities!.includes(f.activity)).map((f) => f.id) : opts.releases ? opts.releases.flatMap((n) => map.releases.get(n) ?? []) : held);
  for (const id of ids) if (!held.includes(id)) throw new Error(`${id} is not assigned to ${entry.team}`);
  const index = readTeamIndex(root);
  const states = loadStates(homeOf(ref));
  for (const id of ids) {
    const h = doneOf(root, index, states, entry, id);
    if (h.done) throw new Error(h.refusal.replace(" (use --include-done)", ""));
  }
  const rest = held.filter((id) => !ids.includes(id));
  const out: Assignment[] = [];
  for (const a of list) {
    if (a !== entry) out.push(a);
    else if (rest.length) out.push({ team: entry.team, repo: entry.repo, stories: rest, ...(entry.url ? { url: entry.url } : {}), ...(entry.ref ? { ref: entry.ref } : {}) });
  }
  const check = checkAssignments(map, out, `maps/${ref.id ?? "intent"}`);
  if (check.errors.length) throw new Error(check.errors[0]);
  writeAssignments(ref.dir, out);
  // A story given up by everyone drops its old holder, so it isn't later shown as moved.
  if (ids.some((id) => index.holders[id] !== undefined)) {
    const holders = { ...index.holders };
    for (const id of ids) delete holders[id];
    writeTeamIndex(root, { ...index, holders });
  }
  return { team: entry.team, removed: ids, left: rest.length };
}

export function runAssign(args: string[]): number {
  const [team, ...rest] = args;
  const flag = (n: string) => {
    const i = rest.indexOf(`--${n}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const dirArg = flag("dir") ?? process.cwd();
  if (!team || team.startsWith("--")) {
    console.error('Usage: nikos assign "<team>" --repo <path|.> [--activities a,b | --releases 1,2 | --stories ID,ID] [--map <id>] [--include-done] [--replace] [--url <url>] [--ref <branch>]');
    return 1;
  }
  try {
    const releases = list(flag("releases"))?.map((n) => {
      if (!/^\d+$/.test(n)) throw new Error(`'${n}' is not a release number`);
      return Number(n);
    });
    const r = assign(dirArg, team, {
      repo: flag("repo") ?? "",
      activities: list(flag("activities")),
      releases,
      stories: list(flag("stories")),
      map: flag("map"),
      includeDone: rest.includes("--include-done"),
      replace: rest.includes("--replace"),
      url: flag("url"),
      ref: flag("ref"),
    });
    for (const w of r.warnings) console.log(`! ${w}`);
    for (const m of r.moved) console.log(`moved ${m.count} ${m.count === 1 ? "story" : "stories"} from ${m.from}`);
    for (const n of r.notes) console.log(`  ${n}`);
    console.log(`✓ ${r.team} now has ${r.stories} ${r.stories === 1 ? "story" : "stories"} in ${r.map}. Unassigned: ${r.unassigned.length}`);
    if (r.dropped.length) console.log(`  ${r.team} no longer has: ${r.dropped.join(", ")}`);
    if (r.unassigned.length) console.log(`  unassigned: ${r.unassigned.join(", ")}`);
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
