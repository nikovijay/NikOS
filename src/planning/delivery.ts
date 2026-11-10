// Delivery status of a bet, worked out from the story maps that spec it. A story's status is the
// status its map's delivery summary says (maps/<key>/delivery.yaml, written by nikos map status,
// state set and approve, and checked by nikos validate). A repo's own map counts its state.
// Never stored, never the outcome.
import { join } from "node:path";
import { parse } from "yaml";
import { store } from "../lib/store.js";
import { loadStates } from "../lib/state-files.js";
import { storiesFor } from "../lib/bets.js";
import { ownRepo } from "../lib/git.js";
import { isDone } from "../lib/project.js";
import { storyMapsOf } from "../lib/maps.js";
import { readDeliverySummary } from "../lib/delivery-summary.js";
import { NewerContractError } from "../lib/schema.js";
import { resolveSettings } from "../lib/settings.js";

export interface Delivery {
  status: "Shipped" | "Building" | "Not started";
  done: number;
  total: number;
  /** Each story with its status; a map's story also says how far its proof can be trusted (its freshness). */
  stories: { id: string; status: string; freshness?: string }[];
  releases: number[];
  /** The maps that contributed stories: each map's id. */
  maps: string[];
  /** Done, but approval is required here and no delivery approval holds for it yet. */
  awaiting: number;
  /** Stories whose proof doesn't match the current feature: changed, behind or unverified. */
  notCurrent: string[];
  /** The oldest delivery summary read for the bet's maps, when there is one. */
  summaryAsOf?: string;
}

/**
 * A map's delivery summary, when its owner has committed one. A summary from a newer nikOS counts as none
 * here, so one repo can't break the page; validate names the refusal.
 */
const summaryIn = (dir: string) => {
  try {
    return readDeliverySummary(dir, "planning");
  } catch (err) {
    if (err instanceof NewerContractError) return undefined;
    throw err;
  }
};

const yamlAt = (p: string) => (store().exists(p) ? parse(store().read(p)) : undefined);

/** approval.policy here, read when a map needs it: a repo whose settings don't read gets the default, optional. */
const policyIn = (root: string): string | undefined => {
  try {
    return resolveSettings(root)["approval.policy"].value as string;
  } catch {
    return undefined;
  }
};

/** A bet's delivery across every story map in the repo that specs it. */
export function delivery(root: string, bet: string): Delivery {
  const stories: Delivery["stories"] = [];
  const releases = new Set<number>();
  const maps: string[] = [];
  const notCurrent: string[] = [];
  let done = 0;
  let awaiting = 0;
  let policy: string | undefined;
  let policyRead = false;
  const policyHere = () => {
    if (!policyRead) policy = policyIn(root);
    policyRead = true;
    return policy;
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
    maps.push(ref.id);

    if (ref.id) {
      // A map in maps/: the summary its owner committed says each story's status. A story it doesn't list has none yet.
      const summary = summaryIn(ref.dir);
      if (summary?.read_at && (!asOfMin || summary.read_at < asOfMin)) asOfMin = summary.read_at;
      for (const id of ids) {
        const s = summary?.stories.find((x) => x.id === id);
        if (!s) {
          stories.push({ id, status: "todo", freshness: "no-summary" });
          continue;
        }
        if (s.status === "cancelled") continue;
        stories.push({ id, status: s.status, freshness: s.proof ?? "summary" });
        // A proof that isn't for the current feature isn't done here, as the map status says.
        if (s.proof) notCurrent.push(id);
        else if (isDone(s.status)) {
          done++;
          if (s.approval !== "approved" && policyHere() === "required-for-release") awaiting++;
        }
      }
    } else {
      // A map with no summary yet: its own state.
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
    ...(asOfMin ? { summaryAsOf: asOfMin } : {}),
  };
}

/**
 * Every map in a repo, summed: each story's status from its delivery summary. A story with no
 * summary yet is counted in noSummary.
 */
export interface MapDelivery {
  /** The map's folder name, e.g. inb. */
  map: string;
  /** The bets its map names, as <repo>#<id> when it names another repo's. */
  bets: string[];
  stories: { id: string; status: string; approval: string; proof?: string }[];
  noSummary: string[];
  asOf?: string;
}

export function mapDeliveryIn(dir: string): { stories: MapDelivery["stories"]; noSummary: string[]; releases: number; asOf?: string; maps: MapDelivery[] } {
  const stories: MapDelivery["stories"] = [];
  const noSummary: string[] = [];
  const maps: MapDelivery[] = [];
  let releases = 0;
  let asOf: string | undefined;
  for (const ref of storyMapsOf(dir)) {
    const map = yamlAt(join(ref.dir, "storymap.yaml")) ?? {};
    const ids: string[] = (map.releases ?? []).flatMap((r: { stories?: string[] }) => r.stories ?? []);
    releases += (map.releases ?? []).length;
    const one: MapDelivery = { map: ref.id, bets: [map.bet].flat().filter((b): b is string => typeof b === "string"), stories: [], noSummary: [] };
    if (!ref.id) {
      // A map with no summary yet: its own state.
      const states = loadStates(ref.dir);
      for (const id of ids) {
        const status = states[id]?.status ?? "todo";
        if (status !== "cancelled") one.stories.push({ id, status, approval: "none" });
      }
    } else {
      const summary = summaryIn(ref.dir);
      if (summary) {
        if (!asOf || summary.read_at < asOf) asOf = summary.read_at;
        one.asOf = summary.read_at;
        const byId = new Map(summary.stories.map((s) => [s.id, s]));
        for (const id of ids) {
          const s = byId.get(id);
          if (!s) one.noSummary.push(id);
          else if (s.status !== "cancelled") one.stories.push({ id, status: s.status, approval: s.approval, ...(s.proof ? { proof: s.proof } : {}) });
        }
      } else one.noSummary.push(...ids);
    }
    stories.push(...one.stories);
    noSummary.push(...one.noSummary);
    maps.push(one);
  }
  return { stories, noSummary, releases, ...(asOf ? { asOf } : {}), maps };
}

/** Done, as the plans above count it: a done story whose proof isn't for the current feature isn't. */
export const doneHere = (s: { status: string; proof?: string }) => isDone(s.status) && !s.proof;

/** A map's counts, as the rollout prints them. */
export const mapCounts = (m: MapDelivery) => ({
  stories: m.stories.length + m.noSummary.length,
  done: m.stories.filter(doneHere).length,
  ...(m.stories.some((s) => s.proof) ? { notCurrent: m.stories.filter((s) => s.proof).length } : {}),
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
  (d.notCurrent.length ? `, ${d.notCurrent.length} not current with its feature` : "");
