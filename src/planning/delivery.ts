// Delivery status of a bet, worked out from the story maps that spec it. A story's status is the
// status its holder reports: in a group repo that's each assigned team's copy (see team/status.ts),
// and in a repo with its own map it's the repo's state. Never stored, never the outcome.
import { join } from "node:path";
import { parse } from "yaml";
import { store } from "../lib/store.js";
import { loadStates } from "../lib/state-files.js";
import { storiesFor } from "../lib/bets.js";
import { isDone } from "../lib/project.js";
import { storyMapsOf } from "../lib/maps.js";
import { loadMapData, readAssignments, storiesOf } from "../lib/assignments.js";
import { openTeam } from "../lib/team.js";
import { resolveSettings } from "../lib/settings.js";
import { featureHashIn, loadGroupMap, mapViews, ownView, readTeamIndex, type StoryView, type TeamIndex } from "../team/status.js";

export interface Delivery {
  status: "Shipped" | "Building" | "Not started";
  done: number;
  total: number;
  /** Each story with its status; a team's story also says how far its team status can be trusted (its freshness). */
  stories: { id: string; status: string; freshness?: string }[];
  releases: number[];
  /** The maps that contributed stories: each map's id, or intent for the repo's own map. */
  maps: string[];
  /** Done in the team's status, but approval is required here and no delivery approval holds for it yet. */
  awaiting: number;
  /** Stories whose team status doesn't match the current feature: changed, behind or unverified. */
  notCurrent: string[];
  /** Teams whose copy isn't on disk, by repo path. */
  notFetched: string[];
  /** The oldest good fetch among the teams whose status was read, when any was. */
  asOf?: string;
}

export interface DeliveryOptions {
  /** The fetched index to read; read from the cache when not given. */
  index?: TeamIndex;
  /** Count the group's own state for every map, even one with assignments: for a copy whose team status isn't read here. */
  groupState?: boolean;
}

const yamlAt = (p: string) => (store().exists(p) ? parse(store().read(p)) : undefined);

/** A map's assignments, or none when the file doesn't read: validate reports that, and delivery keeps its old count. */
const assignedIn = (dir: string) => {
  try {
    return readAssignments(dir);
  } catch {
    return [];
  }
};

/** approval.policy here, read when a map needs it: a repo whose settings don't read gets the default, optional. */
const policyIn = (root: string): string | undefined => {
  try {
    return resolveSettings(root)["approval.policy"].value as string;
  } catch {
    return undefined;
  }
};

/** The team repo paths holding a story of a bet in a group's maps. This group's own holds are not listed. */
export function teamsHolding(root: string, bet: string): string[] {
  const out = new Set<string>();
  for (const ref of storyMapsOf(root)) {
    if (!ref.id || ref.team) continue;
    const map = yamlAt(join(ref.dir, "storymap.yaml"));
    const ids = new Set(map ? storiesFor(map, bet) : []);
    if (!ids.size) continue;
    const data = loadMapData(ref.dir);
    for (const a of assignedIn(ref.dir)) if (a.repo !== "." && storiesOf(data, a).some((id) => ids.has(id))) out.add(a.repo);
  }
  return [...out];
}

/** A bet's delivery across every story map in the repo that specs it. */
export function delivery(root: string, bet: string, opts: DeliveryOptions = {}): Delivery {
  const stories: Delivery["stories"] = [];
  const releases = new Set<number>();
  const maps: string[] = [];
  const notFetched = new Set<string>();
  const notCurrent: string[] = [];
  const dates: string[] = [];
  let done = 0;
  let awaiting = 0;
  let index = opts.index;
  let policy: string | undefined;
  let policyRead = false;
  const policyHere = () => {
    if (!policyRead) policy = policyIn(root);
    policyRead = true;
    return policy;
  };

  const add = (v: StoryView) => {
    if (v.status === "cancelled") return; // a cancelled story no longer counts towards the bet
    stories.push({ id: v.id, status: v.status, freshness: v.freshness });
    if (v.done) done++;
    if (v.awaiting) awaiting++;
    if (v.notCurrent) notCurrent.push(v.id);
    if (v.repo && v.repo !== "." && v.copy === "none") notFetched.add(v.repo);
    if (v.fetched) dates.push(v.fetched);
  };

  for (const ref of storyMapsOf(root)) {
    const map = yamlAt(join(ref.dir, "storymap.yaml"));
    const ids = map ? storiesFor(map, bet) : [];
    if (!ids.length) continue;
    maps.push(ref.id ?? "intent");

    if (ref.team) {
      // A team's own copy: its status is its own, judged against the copy's feature.
      const team = openTeam(ref.root).name;
      const data = loadMapData(ref.dir);
      for (const id of ids) add(ownView(ref.root, team, id, featureHashIn(data, id), policyHere()));
    } else if (ref.id && !opts.groupState && assignedIn(ref.dir).length) {
      // A group's map with assignments: each story is its holder's status, read from the team's copy.
      index ??= readTeamIndex(root);
      const gm = loadGroupMap(ref.dir);
      for (const v of mapViews(root, gm, index, ids, policyHere())) add(v);
    } else {
      // The repo's own state: a repo with no assignments, or its intent/ map.
      const states = loadStates(ref.dir);
      for (const id of ids) {
        const status = states[id]?.status ?? "todo";
        if (status === "cancelled") continue;
        stories.push({ id, status });
        if (isDone(status)) done++;
      }
    }
    for (const r of map?.releases ?? []) if ((r?.stories ?? []).some((s: string) => ids.includes(s))) releases.add(r.number as number);
  }

  const total = stories.length;
  return {
    status: !total ? "Not started" : done === total ? "Shipped" : "Building",
    done,
    total,
    stories,
    releases: [...releases],
    maps,
    awaiting,
    notCurrent,
    notFetched: [...notFetched],
    ...(dates.length ? { asOf: [...dates].sort()[0] } : {}),
  };
}

export const describeDelivery = (d: Delivery) =>
  (d.status === "Building"
    ? `Building, ${d.done} of ${d.total} done`
    : d.status === "Shipped"
      ? `Shipped, ${d.total} of ${d.total} done`
      : "Not started") +
  (d.awaiting ? `, ${d.awaiting} awaiting approval` : "") +
  (d.notCurrent.length ? `, ${d.notCurrent.length} not current with its feature` : "") +
  (d.notFetched.length ? ` (${d.notFetched.length} not fetched)` : "") +
  (d.asOf ? ` (team status as of ${d.asOf})` : "");
