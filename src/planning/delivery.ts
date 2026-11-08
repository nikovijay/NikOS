// Delivery status of a bet, worked out from the story maps that spec it. A story's status is the
// status its holder reports: in a group repo that's each assigned team's copy (see team/status.ts),
// and in a repo with its own map it's the repo's state. Never stored, never the outcome.
import { join } from "node:path";
import { parse } from "yaml";
import { store } from "../lib/store.js";
import { loadStates } from "../lib/state-files.js";
import { storiesFor } from "../lib/bets.js";
import { ownRepo } from "../lib/git.js";
import { isDone } from "../lib/project.js";
import { storyMapsOf } from "../lib/maps.js";
import { loadMapData, readAssignments, storiesOf } from "../lib/assignments.js";
import { openTeam } from "../lib/team.js";
import { readDeliverySummary } from "../lib/delivery-summary.js";
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
  /** The oldest delivery summary read for a copy's maps (copies read the owner's summary, not the teams). */
  summaryAsOf?: string;
}

export interface DeliveryOptions {
  /** The fetched index to read; read from the cache when not given. */
  index?: TeamIndex;
  /** Count the group's own state for every map, even one with assignments: for a copy whose team status isn't read here. */
  groupState?: boolean;
}

/** A map's delivery summary, when its owner has committed one. */
const summaryIn = (dir: string) => readDeliverySummary(dir);

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

  let asOfMin: string | undefined;
  // This repo's name, for matching a map's bet named as <repo>#<id> (canonicalBet); read once, when a map needs it.
  let selfRepo: string | undefined | null = null;
  const self = () => {
    if (selfRepo === null) selfRepo = ownRepo(root);
    return selfRepo;
  };
  for (const ref of storyMapsOf(root)) {
    const map = yamlAt(join(ref.dir, "storymap.yaml"));
    const ids = map ? storiesFor(map, bet, self()) : [];
    if (!ids.length) continue;
    maps.push(ref.id ?? "intent");

    if (ref.id && opts.groupState && (ref.own || summaryIn(ref.dir) || assignedIn(ref.dir).length)) {
      // A copy's map (a group's, or a team's own): the owner's summary says each story's status. A story it doesn't list has none yet.
      // Read first, so a rollout never reads a team's live status/ (rule 9): its own map's summary says it.
      const summary = summaryIn(ref.dir);
      if (summary?.read_at && (!asOfMin || summary.read_at < asOfMin)) asOfMin = summary.read_at;
      for (const id of ids) {
        const s = summary?.stories.find((x) => x.id === id);
        if (!s) {
          stories.push({ id, status: "todo", freshness: "no-summary" });
          continue;
        }
        if (s.status === "cancelled") continue;
        stories.push({ id, status: s.status, freshness: "summary" });
        if (isDone(s.status)) done++;
      }
    } else if (ref.team) {
      // A team's own map: its status is its own, judged against the map's feature.
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
    ...(asOfMin ? { summaryAsOf: asOfMin } : {}),
  };
}

/**
 * Every map a copy holds, summed: each story's status from its owner's delivery summary. A story with
 * no summary yet is counted in noSummary. A map with no teams (and so no summary) counts its own state.
 */
export interface MapDelivery {
  /** The map's folder name, e.g. inb. */
  map: string;
  /** The bets its map names, as <repo>#<id> when it names another repo's. */
  bets: string[];
  stories: { id: string; status: string; approval: string }[];
  noSummary: string[];
  asOf?: string;
}

export function mapDeliveryIn(dir: string): { stories: { id: string; status: string; approval: string }[]; noSummary: string[]; releases: number; asOf?: string; maps: MapDelivery[] } {
  const stories: { id: string; status: string; approval: string }[] = [];
  const noSummary: string[] = [];
  const maps: MapDelivery[] = [];
  let releases = 0;
  let asOf: string | undefined;
  for (const ref of storyMapsOf(dir)) {
    const map = yamlAt(join(ref.dir, "storymap.yaml")) ?? {};
    const ids: string[] = (map.releases ?? []).flatMap((r: { stories?: string[] }) => r.stories ?? []);
    releases += (map.releases ?? []).length;
    const one: MapDelivery = { map: ref.id ?? "intent", bets: [map.bet].flat().filter((b): b is string => typeof b === "string"), stories: [], noSummary: [] };
    const summary = summaryIn(ref.dir);
    if (summary) {
      if (!asOf || summary.read_at < asOf) asOf = summary.read_at;
      one.asOf = summary.read_at;
      const byId = new Map(summary.stories.map((s) => [s.id, s]));
      for (const id of ids) {
        const s = byId.get(id);
        if (!s) one.noSummary.push(id);
        else if (s.status !== "cancelled") one.stories.push({ id, status: s.status, approval: s.approval });
      }
    } else if (!ref.team && !assignedIn(ref.dir).length) {
      // A group's map with no assignments: its own state. A team's map with no summary yet is counted as no summary yet, not from the group's folder.
      const states = loadStates(ref.dir);
      for (const id of ids) {
        const status = states[id]?.status ?? "todo";
        if (status !== "cancelled") one.stories.push({ id, status, approval: "none" });
      }
    } else one.noSummary.push(...ids);
    stories.push(...one.stories);
    noSummary.push(...one.noSummary);
    maps.push(one);
  }
  return { stories, noSummary, releases, ...(asOf ? { asOf } : {}), maps };
}

/** A map's counts, as the rollout prints them. */
export const mapCounts = (m: MapDelivery) => ({
  stories: m.stories.length + m.noSummary.length,
  done: m.stories.filter((s) => isDone(s.status)).length,
  approved: m.stories.filter((s) => s.approval === "approved").length,
  inProgress: m.stories.filter((s) => s.status === "in_progress").length,
  ...(m.noSummary.length ? { noSummary: m.noSummary.length } : {}),
  ...(m.asOf ? { asOf: m.asOf } : {}),
});

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
