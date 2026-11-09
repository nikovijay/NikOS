// `nikos planning rollout`: how the plans below this one are doing. planning/downstream.yaml
// lists the departments and teams that plan against this repo; rollout fetches a read-only copy
// of each into .nikos/downstream/<repo path>/ (gitignored), and of the ones they list in turn,
// and reports for each: has it joined, when did it last sync this plan, how is its delivery
// going, and which of its key results and bets point up here. Nothing is written to their repos.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { store } from "../lib/store.js";
import { dirname, join } from "node:path";
import { parse, parseDocument } from "yaml";
import { isDone } from "../lib/project.js";
import { CROSS_REF, REPO_PATH } from "../lib/bets.js";
import { storyMapsOf } from "../lib/maps.js";
import { loadStates } from "../lib/state-files.js";
import { storyMapOfRef } from "../commands/map.js";
import { next } from "../commands/next.js";
import { decisionEntries } from "../commands/decisions.js";
import { delivery, describeDelivery, doneHere, mapCounts, mapDeliveryIn, type Delivery } from "./delivery.js";
import { readDeliverySummary, summaryAge } from "../lib/delivery-summary.js";
import { copyKeys, duplicateKeys } from "../lib/keys.js";
import { progress, isStale } from "./krs.js";
import { betIds, krIds, loadBet, loadKr, today } from "./model.js";
import { fetchCopy } from "../lib/fetch-copy.js";
import { ignoreCache, readLock, repoEntry, upstreamEntries, type UpstreamEntry } from "./upstream.js";
import { alignsList } from "./levels.js";
import { stopDate, stoppedTarget } from "./stops.js";
import { ownRepo } from "../lib/git.js";
import { isTeamRepo } from "../lib/team.js";

export interface DownstreamPlan {
  name: string;
  /** Its repo path, once it has one. */
  repo?: string;
  /** For a plan further down: the downstream that listed it. */
  via?: string;
  /** Set when the plan (a team or group) is homed in another plan: the one its settings come from. */
  home?: string;
  state: "no repo yet" | "unreachable" | "not joined" | "joined";
  reason?: string;
  /** When this repo's copy of it was fetched. */
  fetched?: string;
  /**
   * Its last sync of the plan it joined: when, and whether it read that plan's current commit.
   * That plan is this repo, or for a plan further down, `via` as rollout fetched it.
   */
  synced?: { on: string; commit: string; current?: boolean };
  delivery?: { stories: number; done: number; approved: number; inProgress: number; releases: number; noSummary?: number; notCurrent?: number; asOf?: string };
  /** Its maps that deliver a bet in another plan (a team's map for a company bet, say), each with its own counts. */
  maps?: MapFor[];
  /** The story its team builds next, as nikos next would say. */
  next?: { id: string; title: string };
  /** Stories with blockers in their state, and what's blocking each. */
  blockers: Blocker[];
  /** Its latest decisions, newest first. */
  decisions: Decision[];
  /** stale: no check-in within its window. checkedIn: it has had at least one. */
  krs: { id: string; title: string; aligns_to?: string[]; progress: number; stale: boolean; checkedIn: boolean }[];
  bets: DownstreamBet[];
}

/** A map in a plan below that delivers another plan's bet: bet is <repo>#<id>. */
export interface MapFor {
  map: string;
  bet: string;
  stories: number;
  done: number;
  approved: number;
  inProgress: number;
  noSummary?: number;
  /** Done by the team, but its proof isn't for the current feature. */
  notCurrent?: number;
  asOf?: string;
}

/** A map's line: its counts, and the age of the summary they come from. */
export const describeMap = (m: MapFor) =>
  `${m.done} of ${m.stories} stories done${m.approved ? ` (${m.approved} approved)` : ""}, ${m.inProgress} in progress${m.notCurrent ? `, ${m.notCurrent} not current with its feature` : ""}${m.asOf ? `, ${summaryAge({ read_at: m.asOf })}` : ""}${
    m.noSummary ? `; ${m.noSummary} with no summary yet` : ""
  }`;

export interface Blocker {
  story: string;
  title: string;
  blockers: string[];
}

/** A decisions.md entry by its heading: "2027-01-12 — Card payments only at launch (PAY-2)". */
export interface Decision {
  title: string;
}

/** How many of a plan's decisions rollout shows. The rest stay in its decisions.md. */
export const LATEST_DECISIONS = 3;

/** A repo's latest decisions, from intent/decisions.md, or planning/decisions.md in a plan-only repo. */
export function latestDecisions(dir: string): Decision[] {
  try {
    return decisionEntries(dir).slice(-LATEST_DECISIONS).reverse().map((e) => ({ title: e.title }));
  } catch {
    return [];
  }
}

/** One key result or bet in the alignment tree, with what aligns to it below. Alignment only: no progress. */
export interface AlignmentNode {
  kind: "kr" | "bet" | "map";
  id: string;
  title: string;
  /** The plan it belongs to: a downstream name, or this repo. */
  plan: string;
  repo?: string;
  /** For an unaligned key result or bet: what it points at, which isn't in this rollout. */
  aligns_to?: string[];
  children: AlignmentNode[];
}

export interface Rollout {
  /** This repo's path, as the plans below name it in their upstream.yaml. */
  repo?: string;
  /** This repo's own latest decisions. */
  decisions: Decision[];
  plans: DownstreamPlan[];
  /** Errors the rollout found in the copies below, such as two plans with one key (amendment D5). */
  problems: string[];
  /**
   * The key results here, with the key results below that align to them and the bets on each, built
   * from aligns_to and bet krs. unaligned: the ones below that point at nothing in this rollout.
   */
  tree: { roots: AlignmentNode[]; unaligned: AlignmentNode[] };
}

const MAX_DEPTH = 6;
const cache = (root: string) => join(root, ".nikos", "downstream");
const copyOf = (root: string, repo: string) => join(cache(root), ...repo.split("/"));
const indexOf = (root: string) => join(cache(root), "index.json");

export { ownRepo } from "../lib/git.js";

interface Listed {
  name: string;
  entry?: UpstreamEntry;
  home?: string;
}

/**
 * The plans a repo (or a copy of one) lists in planning/downstream.yaml. home is the plan a listed
 * team or group is homed in, when that isn't this one (rule 4): it's how the plan knows where to fetch it.
 */
export function downstreamEntries(dir: string): Listed[] {
  const p = join(dir, "planning", "downstream.yaml");
  if (!existsSync(p)) return [];
  const list = parse(readFileSync(p, "utf8")) ?? [];
  if (!Array.isArray(list)) throw new Error("planning/downstream.yaml should be a list of { name, repo }");
  return list.map((e: any) => {
    const name = typeof e === "string" ? e : String(e?.name ?? e?.repo ?? "");
    if (!name) throw new Error("planning/downstream.yaml: each entry needs a name or a repo");
    if (e?.home !== undefined && (typeof e.home !== "string" || !REPO_PATH.test(e.home))) throw new Error(`planning/downstream.yaml: '${e.home}' is not a repo path for home`);
    return { name, ...(e?.repo ? { entry: repoEntry(e, "planning/downstream.yaml") } : {}), ...(e?.home ? { home: e.home } : {}) };
  });
}

/** What a copy of a downstream plan says about itself. */
function read(root: string, dir: string, repo: string, self?: string): Omit<DownstreamPlan, "name" | "via" | "fetched"> {
  const ups = (() => {
    try {
      return upstreamEntries(dir).map((u) => u.repo);
    } catch {
      return [];
    }
  })();
  // Joined means it names this repo, or (when this repo's path isn't known) any plan at all.
  const joined = self ? ups.includes(self) : ups.length > 0;
  const lock = readLock(dir).find((l) => (self ? l.repo === self : !l.via));
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout?.trim();
  let deliv: DownstreamPlan["delivery"];
  let nextUp: DownstreamPlan["next"];
  let mapsFor: MapFor[] = [];
  const blockers: Blocker[] = [];
  if (storyMapsOf(dir).length) {
    try {
      // Every map the copy holds: titles from each, counts summed (storyMapOf is empty for several maps). The owner's summary says the teams' status.
      const refs = storyMapsOf(dir);
      const maps = refs.map((ref) => storyMapOfRef(ref));
      const all = mapDeliveryIn(dir);
      deliv = {
        stories: all.stories.length + all.noSummary.length,
        done: all.stories.filter(doneHere).length,
        ...(all.stories.some((s) => s.proof) ? { notCurrent: all.stories.filter((s) => s.proof).length } : {}),
        approved: all.stories.filter((s) => s.approval === "approved").length,
        inProgress: all.stories.filter((s) => s.status === "in_progress").length,
        releases: all.releases,
        ...(all.noSummary.length ? { noSummary: all.noSummary.length } : {}),
        ...(all.asOf ? { asOf: all.asOf } : {}),
      };
      // A map for another plan's bet is shown under that bet: its own bets already carry their delivery.
      mapsFor = all.maps.flatMap((m) =>
        m.bets.filter((b) => CROSS_REF.test(b) && !b.startsWith(`${repo}#`)).map((bet) => ({ map: m.map, bet, ...mapCounts(m) })),
      );
      const titles = new Map(maps.flatMap((m) => [...m.releases.flatMap((r) => r.stories), ...m.unreleased]).map((s) => [s.id, s.title]));
      // The next story of the first map with a queue: next can't pick among several maps without one. A team's own map is
      // skipped: its status is the team's live file, which a rollout never reads (rule 9). Its summary says the delivery.
      for (const ref of refs) {
        if (isTeamRepo(ref.root)) continue;
        try {
          // A map with a summary: each story's status is the summary's, not the group's state (a team holds it). A proof that
          // isn't current is work to redo, so it isn't next.
          const summary = readDeliverySummary(ref.dir);
          const states = summary && Object.fromEntries(summary.stories.map((s) => [s.id, { status: s.proof && isDone(s.status) ? "needs_rework" : s.status }]));
          const id = next(dir, ref.id, states ? { states } : {}).story;
          if (!id) continue;
          nextUp = { id, title: titles.get(id) ?? id };
          break;
        } catch {
          // no state.yaml or queue in this map: delivery and blockers still show
        }
      }
      // Blockers are read from a group's own map state only: a team's blockers live in its own live state, which a rollout never reads.
      for (const ref of storyMapsOf(dir).filter((r) => !isTeamRepo(r.root))) {
        for (const [story, st] of Object.entries(loadStates(ref.dir))) {
          if (st?.blockers?.length && st.status !== "cancelled" && !isDone(st.status)) blockers.push({ story, title: titles.get(story) ?? story, blockers: st.blockers.map(String) });
        }
      }
    } catch {
      // A story map that doesn't read is the team's to fix; the rest of the rollout still shows.
    }
  }
  const krs = krIds(dir).flatMap((id) => {
    try {
      const k = loadKr(dir, id).data;
      const up = alignsList(k.aligns_to);
      return [{ id, title: k.title, ...(up.length ? { aligns_to: up } : {}), progress: progress(k), stale: isStale(k), checkedIn: (k.checkins?.length ?? 0) > 0 }];
    } catch {
      return [];
    }
  });
  const bets = betIds(dir).flatMap((id) => {
    try {
      const m = loadBet(dir, id).meta;
      const up = alignsList(m.aligns_to);
      // A copy's bet counts the owner's delivery summary; a story with none yet says so, and the owner's nikos map status fixes it.
      const d = delivery(dir, id);
      const missing = d.stories.filter((s) => s.freshness === "no-summary").length;
      const note = missing ? `; ${missing} with no summary yet: run nikos map status in ${repo}` : "";
      // The age of the summary the count reads, as the plan line says it.
      const age = d.summaryAsOf ? `, ${summaryAge({ read_at: d.summaryAsOf })}` : "";
      const stop = stopDate(m);
      return [
        {
          id,
          ref: `${repo}#${id}`,
          outcome: m.outcome,
          delivery: describeDelivery(d) + age + note,
          krs: [m.krs?.primary, ...(m.krs?.also ?? [])].filter(Boolean),
          ...(up.length ? { aligns_to: up } : {}),
          ...(stop ? { stoppedOn: stop } : {}),
        },
      ];
    } catch {
      return [];
    }
  });
  return {
    repo,
    state: joined ? "joined" : "not joined",
    ...(joined ? {} : { reason: `its planning/upstream.yaml doesn't list ${self ?? "a plan"} yet` }),
    ...(lock ? { synced: { on: lock.synced, commit: lock.commit, ...(head && self ? { current: lock.commit === head } : {}) } } : {}),
    ...(deliv ? { delivery: deliv } : {}),
    ...(nextUp ? { next: nextUp } : {}),
    ...(mapsFor.length ? { maps: mapsFor } : {}),
    blockers,
    decisions: latestDecisions(dir),
    krs,
    bets,
  };
}

/** One bet of a plan below, as the rollout shows it. ref is repo#id, the way other plans name it. */
export interface DownstreamBet {
  id: string;
  ref: string;
  outcome: string;
  delivery: string;
  krs: string[];
  aligns_to?: string[];
  /** The date of its latest stop review, when it is stopped. */
  stoppedOn?: string;
  /** A bet it aligns to that was stopped: the owner decides what to do about it, nothing cascades. */
  stoppedParent?: { target: string; date: string };
}

/**
 * Flag each bet that aligns to a stopped bet (rule 10). Stopping a bet never changes the bets aimed
 * at it: the rollout and the views say so, and the owner reviews them. own: this repo's stopped
 * bets, keyed repo#id, since they aren't among the plans below.
 */
export function flagStoppedParents(plans: DownstreamPlan[], own: Map<string, string> = new Map()): void {
  const stopped = new Map(own);
  for (const p of plans) for (const b of p.bets) if (b.stoppedOn) stopped.set(b.ref, b.stoppedOn);
  for (const p of plans) {
    for (const b of p.bets) {
      const hit = stoppedTarget([...(b.aligns_to ?? []), ...b.krs], stopped);
      if (hit) b.stoppedParent = hit;
    }
  }
}

/**
 * The plans below this one, at every level down. Fetches each read-only unless offline, when it
 * reads the copies already on disk. Unreachable ones are reported, never fatal.
 */
export function rollout(root: string, opts: { offline?: boolean; as?: string } = {}): Rollout {
  const self = opts.as ?? ownRepo(root);
  const index: Record<string, { commit: string; fetched: string }> = existsSync(indexOf(root)) ? JSON.parse(readFileSync(indexOf(root), "utf8")) : {};
  const plans: DownstreamPlan[] = [];
  const queue: { listed: Listed; depth: number; via?: string; parent: string }[] = downstreamEntries(root).map((listed) => ({ listed, depth: 1, parent: self ?? "" }));
  const seen = new Set<string>();
  while (queue.length) {
    const { listed, depth, via, parent } = queue.shift()!;
    const base = { name: listed.name, ...(via ? { via } : {}), ...(listed.home ? { home: listed.home } : {}), blockers: [], decisions: [], krs: [], bets: [] };
    if (!listed.entry) {
      plans.push({ ...base, state: "no repo yet" });
      continue;
    }
    const e = listed.entry;
    if (seen.has(e.repo)) continue;
    seen.add(e.repo);
    const dir = copyOf(root, e.repo);
    let fetchedError: string | undefined;
    if (!opts.offline) {
      // Fetch into a scratch folder and swap it in only when the fetch works, so a failed fetch keeps the last good copy.
      const scratch = join(cache(root), ".fetch-rollout", `${e.repo.replace(/[^A-Za-z0-9._-]/g, "-")}-${randomBytes(4).toString("hex")}`);
      try {
        const got = fetchCopy(e.url, e.ref, scratch);
        if ("error" in got) {
          fetchedError = got.error;
          if (!existsSync(dir)) {
            plans.push({ ...base, repo: e.repo, state: "unreachable", reason: got.error });
            continue;
          }
        } else {
          rmSync(dir, { recursive: true, force: true });
          mkdirSync(dirname(dir), { recursive: true });
          renameSync(scratch, dir);
          index[e.repo] = { commit: got.commit, fetched: today() };
        }
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    } else if (!existsSync(dir)) {
      plans.push({ ...base, repo: e.repo, state: "unreachable", reason: "not fetched yet: run nikos planning rollout" });
      continue;
    }
    // A plan further down joins the one that listed it, not this repo.
    const plan = { ...base, ...read(root, dir, e.repo, depth === 1 ? self : parent), ...(index[e.repo] ? { fetched: index[e.repo].fetched } : {}) };
    if (fetchedError !== undefined) {
      // The last good copy is shown, and the note says when it was read.
      const last = index[e.repo]?.fetched;
      Object.assign(plan, { state: "unreachable", reason: `${fetchedError}${last ? `; showing the copy fetched ${last}` : ""}` });
    }
    if (depth > 1 && plan.synced) {
      const above = index[parent]?.commit;
      if (above) plan.synced.current = plan.synced.commit === above;
      else delete plan.synced.current;
    }
    plans.push(plan);
    if (depth >= MAX_DEPTH) continue;
    try {
      for (const below of downstreamEntries(dir)) queue.push({ listed: below, depth: depth + 1, via: e.repo, parent: e.repo });
    } catch (err) {
      plans.push({ name: `${e.repo}'s downstream.yaml`, state: "unreachable", reason: (err as Error).message, blockers: [], decisions: [], krs: [], bets: [] });
    }
  }
  if (!opts.offline) {
    ignoreCache(root);
    mkdirSync(cache(root), { recursive: true });
    writeFileSync(indexOf(root), JSON.stringify(index, null, 2));
  }
  // This repo's own stopped bets name themselves as repo#id, the way the plans below refer to them. Without an origin they can't be named.
  const ownStops = new Map<string, string>();
  if (self) {
    for (const id of betIds(root)) {
      try {
        const d = stopDate(loadBet(root, id).meta);
        if (d) ownStops.set(`${self}#${id}`, d);
      } catch {
        // a bet that doesn't read isn't a stopped parent
      }
    }
  }
  flagStoppedParents(plans, ownStops);
  // A bet below with no stories of its own (a department's bet, say) says what delivers it further down.
  for (const p of plans) {
    for (const b of p.bets) {
      if (!b.delivery.startsWith("Not started")) continue;
      const below = deliveryBelow(root, p.repo, b.id);
      if (below.length) b.delivery = belowText(below).replace(" (from the last nikos planning rollout)", "");
    }
  }
  // Two copies below with one key would name their story ids the same: an error, not a warning (amendment D5).
  const problems = duplicateKeys(copyKeys(cache(root))).map((d) => `key ${d.key} is used by ${d.repos.join(" and ")}: give one of them another key`);
  return { ...(self ? { repo: self } : {}), decisions: latestDecisions(root), plans, problems, tree: alignment(root, self, plans) };
}

/**
 * What delivers a bet, in the copies the last nikos planning rollout fetched: the bets aligned to it, and to
 * those, down the plans, that have stories, and the maps another repo aims at any of them (a team's map for
 * a company bet). Nothing is fetched here.
 */
export function deliveryBelow(root: string, self: string | undefined, bet: string): string[] {
  if (!self || !existsSync(indexOf(root))) return [];
  const index: Record<string, unknown> = JSON.parse(readFileSync(indexOf(root), "utf8"));
  const copies = Object.keys(index).flatMap((repo) => (existsSync(copyOf(root, repo)) ? [{ repo, dir: copyOf(root, repo) }] : []));
  const bets = copies.flatMap((c) =>
    betIds(c.dir).flatMap((id) => {
      try {
        return [{ ...c, id, ref: `${c.repo}#${id}`, up: alignsList(loadBet(c.dir, id).meta.aligns_to) }];
      } catch {
        return [];
      }
    }),
  );
  const targets = new Set([`${self}#${bet}`]);
  for (let grew = true, depth = 0; grew && depth < MAX_DEPTH; depth++) {
    grew = false;
    for (const b of bets) {
      if (targets.has(b.ref) || !b.up.some((u) => targets.has(u))) continue;
      targets.add(b.ref);
      grew = true;
    }
  }
  const out: string[] = [];
  for (const b of bets) {
    if (!targets.has(b.ref)) continue;
    try {
      const d = delivery(b.dir, b.id);
      if (d.stories.length) out.push(`bet ${b.id} in ${b.repo}, ${describeDelivery(d)}${d.summaryAsOf ? `, ${summaryAge({ read_at: d.summaryAsOf })}` : ""}`);
    } catch {
      // a copy whose map doesn't read shows nothing here; its own line in the rollout says so
    }
  }
  for (const c of copies) {
    try {
      for (const m of mapDeliveryIn(c.dir).maps) {
        const hit = m.bets.find((x) => targets.has(x) && !x.startsWith(`${c.repo}#`));
        if (hit) out.push(`map ${m.map} in ${c.repo}, ${describeMap({ map: m.map, bet: hit, ...mapCounts(m) })}`);
      }
    } catch {
      // as above
    }
  }
  return out;
}

const belowText = (below: string[]) => `in the plans below: ${below.join("; ")} (from the last nikos planning rollout)`;

/**
 * A bet's delivery as words: its own maps' counts, or for a bet with no stories here (a company bet that a
 * group's bet or a team's map delivers), what delivers it below, as the last rollout read it.
 */
export function betDeliveryText(root: string, id: string, d: Delivery): string {
  const below = d.stories.length ? [] : deliveryBelow(root, ownRepo(root), id);
  return below.length ? belowText(below) : describeDelivery(d);
}

type Source = { plan: string; repo?: string; krs: { id: string; title: string; aligns_to?: string[] }[]; bets: { id: string; krs: string[]; aligns_to?: string[] }[]; maps?: MapFor[] };

/** This repo's key results and bets, read the same way as a downstream copy's. */
function own(root: string, self?: string): Source {
  const krs = krIds(root).flatMap((id) => {
    try {
      return [{ id, title: loadKr(root, id).data.title }];
    } catch {
      return [];
    }
  });
  const bets = betIds(root).flatMap((id) => {
    try {
      const m = loadBet(root, id).meta;
      return [{ id, krs: [m.krs?.primary, ...(m.krs?.also ?? [])].filter(Boolean) }];
    } catch {
      return [];
    }
  });
  return { plan: self ?? "this plan", ...(self ? { repo: self } : {}), krs, bets };
}

/**
 * The tree from aligns_to links: each key result's children are the key results that align to
 * it, then the bets that name it; each bet's children are the bets that align to it. A key result
 * or bet that aligns to several things appears under each. It records links only and never
 * works out progress from children.
 */
export function alignment(root: string, self: string | undefined, plans: DownstreamPlan[]): Rollout["tree"] {
  const sources: Source[] = [own(root, self), ...plans.filter((p) => p.repo).map((p) => ({ plan: p.name, repo: p.repo, krs: p.krs, bets: p.bets, maps: p.maps }))];
  // Everything is known as repo#id. One from a repo whose path isn't known can't be pointed at.
  const key = (repo: string | undefined, id: string) => (repo ? `${repo}#${id}` : undefined);
  const krAt = new Map<string, { s: Source; k: Source["krs"][number] }>();
  const betAt = new Set<string>();
  for (const s of sources) for (const k of s.krs) if (key(s.repo, k.id)) krAt.set(key(s.repo, k.id)!, { s, k });
  for (const s of sources) for (const b of s.bets) if (key(s.repo, b.id)) betAt.add(key(s.repo, b.id)!);
  const alignsTo = new Map<string, { s: Source; k: Source["krs"][number] }[]>();
  const betsOn = new Map<string, { s: Source; b: Source["bets"][number] }[]>();
  const betsUnder = new Map<string, { s: Source; b: Source["bets"][number] }[]>();
  const placed = new Set<string>();
  const mapsUnder = new Map<string, { s: Source; m: MapFor }[]>();
  for (const s of sources.slice(1)) for (const m of s.maps ?? []) if (betAt.has(m.bet)) mapsUnder.set(m.bet, [...(mapsUnder.get(m.bet) ?? []), { s, m }]);
  const mapNode = (s: Source, m: MapFor): AlignmentNode => ({ kind: "map", id: m.map, title: describeMap(m), plan: s.plan, ...(s.repo ? { repo: s.repo } : {}), children: [] });
  for (const s of sources.slice(1)) {
    for (const k of s.krs) for (const up of k.aligns_to ?? []) if (krAt.has(up)) alignsTo.set(up, [...(alignsTo.get(up) ?? []), { s, k }]);
    for (const b of s.bets) for (const up of b.aligns_to ?? []) if (betAt.has(up)) betsUnder.set(up, [...(betsUnder.get(up) ?? []), { s, b }]);
  }
  for (const s of sources) {
    for (const b of s.bets) {
      // A bet names a key result in its own plan by id, or one in another repo as repo#id.
      for (const ref of new Set(b.krs.map((r) => (r.includes("#") ? r : key(s.repo, r) ?? `#${r}`)))) betsOn.set(ref, [...(betsOn.get(ref) ?? []), { s, b }]);
    }
  }
  const krNode = (s: Source, k: Source["krs"][number], path: Set<string>): AlignmentNode => {
    const at = key(s.repo, k.id) ?? `#${k.id}`;
    placed.add(`kr ${at}`);
    const next = new Set(path).add(at);
    return {
      kind: "kr",
      id: k.id,
      title: k.title,
      plan: s.plan,
      ...(s.repo ? { repo: s.repo } : {}),
      children: [
        ...(alignsTo.get(at) ?? []).filter((c) => !next.has(key(c.s.repo, c.k.id)!)).map((c) => krNode(c.s, c.k, next)),
        // A bet that aligns to another bet is shown under that bet, not again under the key result.
        ...(betsOn.get(at) ?? []).filter(({ b }) => !(b.aligns_to ?? []).some((r) => betAt.has(r))).map(({ s: bs, b }) => betNode(bs, b, next)),
      ],
    };
  };
  const betNode = (s: Source, b: Source["bets"][number], path: Set<string>): AlignmentNode => {
    const at = key(s.repo, b.id) ?? `${s.plan}/${b.id}`;
    placed.add(`bet ${s.repo ?? s.plan}/${b.id}`);
    const next = new Set(path).add(at);
    return {
      kind: "bet",
      id: b.id,
      title: b.id,
      plan: s.plan,
      ...(s.repo ? { repo: s.repo } : {}),
      children: [
        ...(betsUnder.get(at) ?? []).filter((c) => !next.has(key(c.s.repo, c.b.id)!)).map((c) => betNode(c.s, c.b, next)),
        ...(mapsUnder.get(at) ?? []).map(({ s: ms, m }) => mapNode(ms, m)),
      ],
    };
  };
  const roots = sources[0].krs.map((k) => krNode(sources[0], k, new Set()));
  // Key results and bets below that point at nothing here (or at nothing at all) start their own branch.
  const unaligned: AlignmentNode[] = [];
  const outside = (refs: string[] | undefined, known: (r: string) => boolean) => (refs ?? []).filter((r) => !known(r));
  for (const s of sources.slice(1)) {
    for (const k of s.krs) {
      if (placed.has(`kr ${key(s.repo, k.id)}`) || (k.aligns_to ?? []).some((r) => krAt.has(r))) continue;
      const away = outside(k.aligns_to, (r) => krAt.has(r));
      unaligned.push({ ...krNode(s, k, new Set()), ...(away.length ? { aligns_to: away } : {}) });
    }
  }
  // Key results that only align to each other in a loop are still shown, from the first one listed.
  for (const s of sources.slice(1)) for (const k of s.krs) if (!placed.has(`kr ${key(s.repo, k.id)}`)) unaligned.push(krNode(s, k, new Set()));
  for (const s of sources) {
    for (const b of s.bets) {
      if (placed.has(`bet ${s.repo ?? s.plan}/${b.id}`) || (b.aligns_to ?? []).some((r) => betAt.has(r))) continue;
      const away = outside(b.aligns_to, (r) => betAt.has(r));
      unaligned.push({ ...betNode(s, b, new Set()), ...(away.length ? { aligns_to: away } : {}) });
    }
  }
  // A map for a bet that isn't in this rollout still shows, with the bet it names.
  for (const s of sources.slice(1)) for (const m of s.maps ?? []) if (!betAt.has(m.bet)) unaligned.push({ ...mapNode(s, m), aligns_to: [m.bet] });
  return { roots, unaligned };
}

/** The alignment tree as indented lines, with box-drawing branches. */
export function formatTree(tree: Rollout["tree"]): string[] {
  const label = (n: AlignmentNode) =>
    n.kind === "kr"
      ? `KR ${n.id}: ${n.title} (${n.plan})${n.aligns_to ? ` → ${n.aligns_to.join(", ")}, not in this rollout` : ""}`
      : n.kind === "map"
        ? `map ${n.id} (${n.plan}): ${n.title}${n.aligns_to ? ` → ${n.aligns_to.join(", ")}, not in this rollout` : ""}`
        : `bet ${n.id} (${n.plan})${n.aligns_to ? ` → ${n.aligns_to.join(", ")}, not in this rollout` : ""}`;
  const out: string[] = [];
  const walk = (n: AlignmentNode, lead: string, last: boolean, top: boolean) => {
    out.push(top ? `  ${label(n)}` : `  ${lead}${last ? "└─ " : "├─ "}${label(n)}`);
    const inner = top ? "" : lead + (last ? "   " : "│  ");
    n.children.forEach((c, i) => walk(c, inner, i === n.children.length - 1, false));
  };
  if (tree.roots.length) {
    out.push("Alignment, from the key results here down. It shows links only: progress stays with each key result and never adds up from the ones below.");
    for (const n of tree.roots) walk(n, "", true, true);
  }
  if (tree.unaligned.length) {
    out.push(`${out.length ? "\n" : ""}Not aligned to a key result in this rollout:`);
    for (const n of tree.unaligned) walk(n, "", true, true);
  }
  return out;
}

/** The rollout as lines, one block per plan. */
export function formatRollout(r: Rollout): string {
  if (!r.plans.length) return "No plans below this one: list departments and teams in planning/downstream.yaml as `- name: Payments` and `repo: acme/payments-plan`.";
  const out: string[] = [];
  const joined = r.plans.filter((p) => p.state === "joined").length;
  out.push(`${joined} of ${r.plans.length} plans below ${r.repo ?? "this one"} have joined.`);
  for (const p of r.problems) out.push(`✗ ${p}`);
  const tree = formatTree(r.tree);
  if (tree.length) out.push("", ...tree);
  if (r.decisions.length) out.push("", `Latest decisions here:`, ...r.decisions.map((d) => `  ${d.title}`));
  for (const p of r.plans) {
    const mark = p.state === "joined" ? "✓" : p.state === "not joined" ? "!" : "?";
    out.push(`\n${mark} ${p.name}${p.repo && p.repo !== p.name ? ` (${p.repo})` : ""}${p.home ? `, homed in ${p.home}` : ""}${p.via ? `, below ${p.via}` : ""}: ${p.state}${p.reason ? `, ${p.reason}` : ""}`);
    if (p.synced) out.push(`    synced on ${p.synced.on} at ${p.synced.commit.slice(0, 7)}${p.synced.current === false ? `, behind ${p.via ?? "this plan"}: ask them to run nikos planning sync` : ""}`);
    if (p.delivery) {
      const d = p.delivery;
      const age = d.asOf ? `, ${summaryAge({ read_at: d.asOf })}` : "";
      const missing = d.noSummary ? `; ${d.noSummary} ${d.noSummary === 1 ? "story has" : "stories have"} no summary yet: run nikos map status in ${p.repo}` : "";
      out.push(`    delivery: ${d.done} of ${d.stories} stories done${d.approved ? ` (${d.approved} approved)` : ""}, ${d.inProgress} in progress${d.notCurrent ? `, ${d.notCurrent} not current with its feature` : ""}${age}${missing}`);
    }
    for (const m of p.maps ?? []) out.push(`    map ${m.map} → ${m.bet}: ${describeMap(m)}`);
    if (p.next) out.push(`    next: ${p.next.id} ${p.next.title}`);
    for (const b of p.blockers) out.push(`    blocked: ${b.story} ${b.title}: ${b.blockers.join("; ")}`);
    for (const d of p.decisions) out.push(`    decision: ${d.title}`);
    for (const k of p.krs) out.push(`    KR ${k.id}: ${k.title}, ${Math.round(k.progress * 100)}%${!k.checkedIn ? ", no check-ins yet" : k.stale ? ", stale" : ""}${k.aligns_to ? ` → ${k.aligns_to.join(", ")}` : ""}`);
    for (const b of p.bets) {
      // A bet aimed at a stopped bet says so: the owner reviews it, nothing is changed here.
      const aligns = b.stoppedParent ? `; aligns to ${b.stoppedParent.target}, which was stopped on ${b.stoppedParent.date}` : b.aligns_to ? `; aligns to ${b.aligns_to.join(", ")}` : "";
      out.push(`    bet ${b.id}: ${b.delivery}, ${b.outcome}${b.krs.length ? ` → ${b.krs.join(", ")}` : ""}${aligns}`);
    }
  }
  return out.join("\n");
}

/** List a department or team in planning/downstream.yaml, or give an entry already there its repo. */
export function addDownstream(root: string, input: { name: string; repo?: string; host?: string; url?: string; home?: string }): { name: string; repo?: string; added: boolean } {
  const name = input.name?.trim();
  if (!name) throw new Error("Give the department's or team's name");
  if ((input.host || input.url || input.home) && !input.repo) throw new Error("Give the repo path too (--repo), so rollout knows what to call it");
  if (input.home !== undefined && !REPO_PATH.test(input.home)) throw new Error(`'${input.home}' is not a repo path for --home (owner/repo, or group/subgroup/project on GitLab)`);
  const entry = { name, ...(input.repo ? { repo: input.repo } : {}), ...(input.home ? { home: input.home } : {}), ...(input.host ? { host: input.host } : {}), ...(input.url ? { url: input.url } : {}) };
  if (input.repo) repoEntry(entry, "planning/downstream.yaml"); // a bad repo path or host fails before anything is written
  // Through the store, so a dry run (runOps) keeps the change in memory and the change set lists it.
  const p = join(root, "planning", "downstream.yaml");
  const doc = parseDocument(store().exists(p) ? store().read(p) : "# The departments and teams that plan against this one: name, and their repo once they have one.\n[]\n");
  if (!doc.contents || !("items" in (doc.contents as any))) doc.contents = doc.createNode([]) as any;
  (doc.contents as any).flow = false;
  const items = (doc.contents as any).items as any[];
  const at = items.findIndex((it) => {
    const v = it?.toJSON?.() ?? it;
    return (typeof v === "string" ? v : v?.name) === name || (input.repo && v?.repo === input.repo);
  });
  if (at >= 0) items[at] = doc.createNode(entry);
  else items.push(doc.createNode(entry));
  store().write(p, doc.toString({ lineWidth: 0 }));
  return { name, ...(input.repo ? { repo: input.repo } : {}), added: at < 0 };
}
