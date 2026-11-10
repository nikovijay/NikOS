// Delivery on bets, for nikos plan: each planning bet's delivery, worked out from the story maps that
// name it. The maps are the copies nikos plan refresh keeps under .nikos/delivery/. A bet with no maps
// of its own shows the bets below it (through aligns_to), each one on its own, never added together.
// deliveriesFrom is pure: it works on what has been read. readCache and planDeliveries only read files.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { BET_ID, CROSS_REF, REPO_PATH, betsFor } from "../lib/bets.js";
import { readDeliverySummaryResult, summaryAge, type DeliverySummary, type SummaryStory } from "../lib/delivery-summary.js";
import { ownRepo } from "../lib/git.js";
import { contractProblems, NewerContractError } from "../lib/schema.js";
import { store } from "../lib/store.js";
import { doneHere } from "../planning/delivery.js";
import { alignsList } from "../planning/levels.js";
import { betIds, loadBet } from "../planning/model.js";
import { listAreas } from "./repo.js";
import { cacheRoot, readCacheIndex } from "./refresh.js";

export type Status = "Shipped" | "Building" | "Not started";

/** A map in the copy: its storymap and its delivery summary, when each one reads. */
export interface CachedMap {
  key: string;
  storymap?: any;
  summary?: DeliverySummary;
  /** Why the storymap or the summary can't be used: a missing or bad file, or one from a newer nikOS. */
  problems: string[];
}

/** A repo's copy: the maps it holds, and when it was last read. A failed read keeps the last good copy. */
export interface CachedRepo {
  repo: string;
  host: string;
  state: "ok" | "unreachable";
  read_at?: string;
  reason?: string;
  maps: CachedMap[];
}

export interface MapRef {
  host: string;
  repo: string;
  key: string;
}

/** One bet's delivery, counted from the stories of the maps that name it. */
export interface Figures {
  status: Status;
  total: number;
  done: number;
  approved: number;
  inProgress: number;
  /** Stories whose proof isn't for the current feature: they don't count as done. */
  notCurrent: number;
  /** Stories that no summary lists yet: counted as to do. */
  noSummary: number;
  maps: MapRef[];
}

/** A repo's copy and how old it is, as the plan will say it. */
export interface RepoRead {
  repo: string;
  host: string;
  state: "ok" | "unreachable";
  read_at?: string;
  reason?: string;
  age: string;
}

export interface BetDelivery {
  bet: string;
  /** own: the bet's own maps. via: the bets below it that have maps. none: neither. */
  source: "own" | "via" | "none";
  /** The bet's own figures, when source is own. */
  delivery?: Figures;
  /** When source is via: each bet below with maps, with its own figures. Never added up across bets. */
  via: { bet: string; delivery: Figures }[];
  /** The repos whose copies the figures come from. */
  reads: RepoRead[];
}

export interface DeliveryWarning {
  repo?: string;
  map?: string;
  message: string;
}

/** One story a bet's maps name: its status from the map's summary, and the map it comes from. */
export interface StoryRow {
  id: string;
  map: MapRef;
  /** The status the map's summary says. Null when no summary lists the story yet. */
  status: string | null;
  approval: "none" | "approved";
  /** Set when the proof isn't for the current feature: the story doesn't count as done. */
  proof?: string;
}

export interface PlanDeliveries {
  /** False when nothing has been read yet: there is no .nikos/delivery/index.json. */
  cached: boolean;
  bets: Map<string, BetDelivery>;
  /** Each bet's stories, from every map that names it. Not in plan status --json: the dashboard reads it. */
  stories: Map<string, StoryRow[]>;
  repos: RepoRead[];
  warnings: DeliveryWarning[];
}

export interface PlanBet {
  id: string;
  /** The bets it aligns to, as written. */
  aligns: string[];
}

export interface PlanInput {
  /** This planning repo's own owner/repo, from its origin. Undefined when it has no origin. */
  self?: string;
  cached: boolean;
  bets: PlanBet[];
  repos: CachedRepo[];
  now: Date;
}

/** What a bet link in a storymap names: a bet of this plan, nothing, or something that is not counted. */
export type BetLink = { kind: "none" } | { kind: "bet"; bet: string } | { kind: "elsewhere" | "unknown"; message: string };

/**
 * What a bet link names. A bare id is a bet of this plan. <repo>#<id> is one too when <repo> is this
 * plan's own repo (compared without case); any other repo's bet is elsewhere and isn't counted here.
 */
export function classifyBet(value: string, self: string | undefined, betIds: ReadonlySet<string>): BetLink {
  const v = value.trim();
  if (!v) return { kind: "none" };
  if (CROSS_REF.test(v)) {
    const [repo, id] = v.split("#");
    if (!self) return { kind: "unknown", message: `${v}: this planning repo has no origin, so nikOS can't tell whether it names one of its bets` };
    if (repo.toLowerCase() !== self.toLowerCase()) return { kind: "elsewhere", message: `${v} names a bet in another plan, so it isn't counted here` };
    return betIds.has(id) ? { kind: "bet", bet: id } : { kind: "unknown", message: `${v}: no bet called ${id} in this planning repo` };
  }
  if (BET_ID.test(v)) return betIds.has(v) ? { kind: "bet", bet: v } : { kind: "unknown", message: `${v}: no bet called ${v} in this planning repo` };
  return { kind: "unknown", message: `'${v}' isn't a bet id: write it as <id>, or <repo>#<id> for a bet in another repo` };
}

/** Every story a storymap lists in its releases, once each. */
const storyIds = (storymap: any): string[] => {
  const all: unknown[] = (storymap?.releases ?? []).flatMap((r: any) => (Array.isArray(r?.stories) ? r.stories : []));
  return [...new Set(all.filter((s): s is string => typeof s === "string"))];
};

const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => map.set(key, [...(map.get(key) ?? []), value]);

/** How old a repo's copy is, in the words the plan uses. A failed read says why, and what it kept. */
export function ageOf(r: Pick<CachedRepo, "state" | "read_at" | "reason">, now: Date): string {
  const why = r.reason ?? "no reason given";
  if (!r.read_at) return r.state === "ok" ? "not read yet" : `could not be read: ${why}`;
  const when = summaryAge({ read_at: r.read_at }, now);
  return r.state === "ok" ? when : `${when}; the last read failed: ${why}`;
}

const readOf = (r: CachedRepo, now: Date): RepoRead => ({
  repo: r.repo,
  host: r.host,
  state: r.state,
  ...(r.read_at ? { read_at: r.read_at } : {}),
  ...(r.reason ? { reason: r.reason } : {}),
  age: ageOf(r, now),
});

/** A map that names this plan's bets: which stories name each bet, and its summary's stories by id. */
interface Scope {
  ref: MapRef;
  repo: CachedRepo;
  /** The bets the map names as a whole (its bet:), which count it even while it has no stories. */
  named: Set<string>;
  stories: Map<string, string[]>;
  summary: Map<string, SummaryStory>;
}

function figuresOf(bet: string, scopes: Scope[]): Figures {
  let total = 0;
  let done = 0;
  let approved = 0;
  let inProgress = 0;
  let notCurrent = 0;
  let noSummary = 0;
  for (const s of scopes) {
    for (const id of s.stories.get(bet) ?? []) {
      const row = s.summary.get(id);
      if (!row) {
        total++;
        noSummary++;
        continue;
      }
      if (row.status === "cancelled") continue;
      total++;
      if (doneHere(row)) done++;
      if (row.approval === "approved") approved++;
      if (row.status === "in_progress") inProgress++;
      if (row.proof) notCurrent++;
    }
  }
  const status: Status = total > 0 && done === total ? "Shipped" : done > 0 || inProgress > 0 ? "Building" : "Not started";
  return { status, total, done, approved, inProgress, notCurrent, noSummary, maps: scopes.map((s) => s.ref) };
}

/** The bets below a bet through aligns_to, nearest first. Each is visited once, so a cycle ends. */
export function below(bet: string, children: Map<string, string[]>): string[] {
  const seen = new Set([bet]);
  const order: string[] = [];
  const queue = [...(children.get(bet) ?? [])];
  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    order.push(next);
    queue.push(...(children.get(next) ?? []));
  }
  return order;
}

/**
 * Each planning bet's delivery, from the maps that name it. Pure: give it what has been read. A bet
 * with maps of its own is its own figures; otherwise each bet below it with maps is listed on its own.
 */
export function deliveriesFrom(input: PlanInput): PlanDeliveries {
  const ids = new Set(input.bets.map((b) => b.id));
  const warnings: DeliveryWarning[] = [];
  const warned = new Set<string>();
  const warn = (w: DeliveryWarning) => {
    const key = JSON.stringify(w);
    if (warned.has(key)) return;
    warned.add(key);
    warnings.push(w);
  };

  // Each map's stories, by the bet they name. A map is listed once however many times it appears.
  const scopes = new Map<string, Scope>();
  for (const repo of input.repos) {
    for (const m of repo.maps) {
      for (const message of m.problems) warn({ repo: repo.repo, map: m.key, message });
      if (!m.storymap) continue;
      const named = new Set<string>();
      if (typeof m.storymap.bet === "string") {
        const link = classifyBet(m.storymap.bet, input.self, ids);
        if (link.kind === "bet") named.add(link.bet);
        else if (link.kind !== "none") warn({ repo: repo.repo, map: m.key, message: link.message });
      }
      const stories = new Map<string, string[]>();
      for (const story of storyIds(m.storymap)) {
        for (const value of betsFor(m.storymap, story).bets) {
          const link = classifyBet(String(value), input.self, ids);
          if (link.kind === "bet") {
            const have = stories.get(link.bet) ?? [];
            if (!have.includes(story)) push(stories, link.bet, story);
          } else if (link.kind !== "none") {
            warn({ repo: repo.repo, map: m.key, message: link.message });
          }
        }
      }
      const ref = { host: repo.host, repo: repo.repo, key: m.key };
      const key = `${ref.host}/${ref.repo}/${ref.key}`;
      if (scopes.has(key)) continue;
      const summary = new Map((m.summary?.stories ?? []).map((s) => [s.id, s]));
      scopes.set(key, { ref, repo, named, stories, summary });
    }
  }
  const all = [...scopes.values()];
  const scopesOf = (bet: string) => all.filter((s) => s.named.has(bet) || (s.stories.get(bet) ?? []).length > 0);

  // The bets below each bet: a bet that aligns to another is one of its children.
  const children = new Map<string, string[]>();
  for (const b of input.bets) {
    for (const ref of b.aligns) {
      const link = classifyBet(ref, input.self, ids);
      if (link.kind === "bet") push(children, link.bet, b.id);
    }
  }

  const readFor = new Map<CachedRepo, RepoRead>(input.repos.map((r) => [r, readOf(r, input.now)]));
  const readsOf = (list: Scope[]): RepoRead[] => [...new Set(list.map((s) => s.repo))].map((r) => readFor.get(r)!);

  const storiesOf = (bet: string): StoryRow[] =>
    scopesOf(bet).flatMap((s) =>
      (s.stories.get(bet) ?? []).map((id) => {
        const row = s.summary.get(id);
        return { id, map: s.ref, status: row?.status ?? null, approval: row?.approval === "approved" ? "approved" : "none", ...(row?.proof ? { proof: row.proof } : {}) };
      }),
    );
  const stories = new Map<string, StoryRow[]>();
  const bets = new Map<string, BetDelivery>();
  for (const b of input.bets) {
    const own = scopesOf(b.id);
    if (own.length) {
      bets.set(b.id, { bet: b.id, source: "own", delivery: figuresOf(b.id, own), via: [], reads: readsOf(own) });
      stories.set(b.id, storiesOf(b.id));
      continue;
    }
    const via = below(b.id, children)
      .map((bet) => ({ bet, scopes: scopesOf(bet) }))
      .filter((v) => v.scopes.length > 0)
      .map((v) => ({ bet: v.bet, delivery: figuresOf(v.bet, v.scopes) }));
    const reads = readsOf(below(b.id, children).flatMap((d) => scopesOf(d)));
    bets.set(b.id, { bet: b.id, source: via.length ? "via" : "none", via, reads });
    stories.set(b.id, below(b.id, children).flatMap((d) => storiesOf(d)));
  }

  return { cached: input.cached, bets, stories, repos: input.repos.map((r) => readFor.get(r)!), warnings };
}

/** The copy's repos, as refresh left them. A map whose storymap or summary can't be used says why. */
export interface CacheRead {
  cached: boolean;
  repos: CachedRepo[];
}

const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/i;
const MAP_KEY = /^[a-z0-9][a-z0-9_-]*$/i;

function readMap(dir: string, key: string): CachedMap {
  const problems: string[] = [];
  let storymap: any;
  const file = join(dir, "storymap.yaml");
  if (!store().exists(file)) {
    problems.push("storymap.yaml is missing");
  } else {
    try {
      const data = parse(store().read(file));
      const bad = contractProblems("storymap.yaml", data, "format_version", "planning", "contract/storymap.schema.json");
      if (bad.length) problems.push(`storymap.yaml: ${bad[0]}`);
      else storymap = data;
    } catch (err) {
      problems.push(err instanceof NewerContractError ? err.message : "storymap.yaml isn't valid YAML");
    }
  }
  const summary: CachedMap = { key, problems, ...(storymap ? { storymap } : {}) };
  if (!store().exists(join(dir, "delivery.yaml"))) return summary;
  const read = readDeliverySummaryResult(dir, "planning");
  if (read.ok) return { ...summary, summary: read.summary };
  problems.push(read.newer ? read.reason : `delivery.yaml: ${read.reason}`);
  return summary;
}

/** What refresh left under .nikos/delivery/. Entries that name a host or repo that can't be a path are skipped. */
export function readCache(root: string): CacheRead {
  const cached = existsSync(join(cacheRoot(root), "index.json"));
  const repos: CachedRepo[] = [];
  for (const entry of Object.values(readCacheIndex(root).repos)) {
    if (typeof entry?.repo !== "string" || typeof entry.host !== "string" || !REPO_PATH.test(entry.repo) || !HOST.test(entry.host)) continue;
    const dir = join(cacheRoot(root), entry.host, ...entry.repo.split("/"));
    const keys = (Array.isArray(entry.maps) ? entry.maps : []).filter((k): k is string => typeof k === "string" && MAP_KEY.test(k));
    repos.push({
      repo: entry.repo,
      host: entry.host,
      state: entry.state === "ok" ? "ok" : "unreachable",
      ...(entry.read_at ? { read_at: entry.read_at } : {}),
      ...(entry.reason ? { reason: entry.reason } : {}),
      maps: keys.map((key) => readMap(join(dir, "maps", key), key)),
    });
  }
  return { cached, repos };
}

/** Every bet in the plan's areas, with what it aligns to. A bet that won't load still counts as a bet. */
export function planBetsOf(planRepo: string): PlanBet[] {
  const out: PlanBet[] = [];
  for (const area of listAreas(planRepo)) {
    for (const id of betIds(area.dir)) {
      let aligns: string[] = [];
      try {
        aligns = alignsList(loadBet(area.dir, id).meta?.aligns_to);
      } catch {
        // validate reports a bet that won't load; here it still counts, with nothing aligned
      }
      out.push({ id, aligns });
    }
  }
  return out;
}

/** The delivery of every bet in a planning repo, from the copies plan refresh kept. */
export function planDeliveries(planRepo: string, now: Date = new Date()): PlanDeliveries {
  const cache = readCache(planRepo);
  return deliveriesFrom({ self: ownRepo(planRepo), cached: cache.cached, bets: planBetsOf(planRepo), repos: cache.repos, now });
}
