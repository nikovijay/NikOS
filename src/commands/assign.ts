// `nikos assign "<team>" --repo <path>`: give a team all or part of a group's story map. Run in the
// group repo. It adds to what the team already has, and --replace redefines its part. Each story belongs to at most one team. A done story stays with the team that
// delivered it unless --include-done moves it. Assignments are written to maps/<id>/assignments.yaml.
import { resolve } from "node:path";
import { isDone } from "../lib/project.js";
import { mapDirs, resolveStoryMap, type StoryMapRef } from "../lib/maps.js";
import { isTeamRepo, isRepoArg } from "../lib/team.js";
import { loadStates } from "../lib/state-files.js";
import { checkAssignments, loadMapData, mapStoryIds, readAssignments, storiesOf, writeAssignments, type Assignment, type MapData } from "../lib/assignments.js";

export interface AssignOptions {
  repo: string;
  activities?: string[];
  releases?: number[];
  stories?: string[];
  map?: string;
  includeDone?: boolean;
  /** Redefine the team's part instead of adding to it. */
  replace?: boolean;
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
  if (isTeamRepo(root)) throw new Error("this is a team repo: assignments are made in the group repo");
  if (!mapDirs(root).length) throw new Error("nikos assign needs a group repo with maps/: nikos group init, then nikos map new");
  const name = team.trim();
  if (!name) throw new Error("Give the team's name, e.g. nikos assign \"Checkout web\" --repo acme/checkout-web");
  if (!opts.repo || !isRepoArg(opts.repo)) throw new Error("nikos assign needs --repo <path>: the team's repo, as owner/repo, or . when this repo is its own team");
  const selected = [opts.activities, opts.releases, opts.stories].filter((x) => x !== undefined).length;
  if (selected > 1) throw new Error("give one of --activities, --releases or --stories, not several");

  const ref: StoryMapRef = resolveStoryMap(root, opts.map);
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
  const entry = before && !opts.replace ? combine(map, before, asked) : asked;
  const next = storiesOf(map, entry);
  const dropped = before ? storiesOf(map, before).filter((id) => !next.includes(id)) : [];

  const states = loadStates(ref.dir);
  const moved: AssignResult["moved"] = [];
  const updated = list0.some((a) => a.repo === opts.repo);
  const out: Assignment[] = [];
  for (const other of list0) {
    // The same repo's entry is replaced, not moved from.
    if (other.repo === opts.repo) continue;
    const overlap = storiesOf(map, other).filter((id) => next.includes(id));
    if (!overlap.length) {
      out.push(other);
      continue;
    }
    const done = overlap.filter((id) => isDone(states[id]?.status));
    if (done.length && !opts.includeDone) {
      throw new Error(`${done[0]} is done and held by ${other.team}: assign won't move a done story (use --include-done)`);
    }
    moved.push({ from: other.team, count: overlap.length });
    // What's left of the other team's part, as explicit stories; nothing left removes its entry.
    const rest = storiesOf(map, other).filter((id) => !next.includes(id));
    if (rest.length) out.push({ team: other.team, repo: other.repo, stories: rest });
  }
  out.push(entry);
  // The new entry must hold no story twice; checkAssignments would say so.
  const check = checkAssignments(map, out, label);
  if (check.errors.length) throw new Error(check.errors[0]);
  writeAssignments(ref.dir, out);

  const held = new Set(out.flatMap((a) => storiesOf(map, a)));
  const unassigned = mapStoryIds(map).filter((id) => !held.has(id));
  return { team: name, map: mapKey, stories: next.length, moved, updated, dropped, unassigned };
}

/** A team's part with more added: the same selector merges, a whole map stays whole, and a mix becomes stories. */
function combine(map: MapData, before: Assignment, asked: Assignment): Assignment {
  const out: Assignment = { team: asked.team, repo: asked.repo };
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

export function runAssign(args: string[]): number {
  const [team, ...rest] = args;
  const flag = (n: string) => {
    const i = rest.indexOf(`--${n}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const dirArg = flag("dir") ?? process.cwd();
  if (!team || team.startsWith("--")) {
    console.error('Usage: nikos assign "<team>" --repo <path|.> [--activities a,b | --releases 1,2 | --stories ID,ID] [--map <id>] [--include-done] [--replace]');
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
    });
    for (const m of r.moved) console.log(`moved ${m.count} ${m.count === 1 ? "story" : "stories"} from ${m.from}`);
    console.log(`${r.updated ? "✓ updated" : "✓"} ${r.team} now has ${r.stories} ${r.stories === 1 ? "story" : "stories"} in ${r.map}. Unassigned: ${r.unassigned.length}`);
    if (r.dropped.length) console.log(`  ${r.team} no longer has: ${r.dropped.join(", ")}`);
    if (r.unassigned.length) console.log(`  unassigned: ${r.unassigned.join(", ")}`);
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
