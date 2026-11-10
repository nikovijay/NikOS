// The planning dashboard's data, for nikos plan serve: which area a page shows, its breadcrumb and
// period, its key results and bets with their delivery, and the drill-downs from a key result or bet.
// Everything here is read from the planning repo and its delivery copies. Nothing is written, and no
// network is used. The server and the export both build their pages from these functions.
import { directionOf, latest, isStale, progress } from "../planning/krs.js";
import { alignsList } from "../planning/levels.js";
import { RANK } from "./repo.js";
import { betIds, krIds, loadBet, loadKr, type Area, type AreaLevel } from "../planning/model.js";
import { below, readCache, type BetDelivery, type DeliveryWarning, type PlanDeliveries, type RepoRead, type StoryRow } from "./delivery.js";
import { areaFile, areaHolding, chainOf, findArea, listAreas, parentOf } from "./repo.js";

/** One area in the tree, company first, then each area below it. */
export interface AreaNode {
  rel: string;
  level: AreaLevel;
  id: string;
  /** The area's name as its plan.yaml (or team.yaml) gives it, or its id when it has none. */
  name: string;
  /** The rel of the area directly above, or null for the company. */
  parent: string | null;
  /** The rels of the areas directly below. */
  children: string[];
  /** The rels from the company down to this area, this area last. */
  path: string[];
}

export type AreaTree = AreaNode[];

export interface Crumb {
  label: string;
  rel: string;
  href: string;
}

/** A key result as a row of the ladder: its title, progress, latest check-in, and where it is held. */
export interface KrRef {
  id: string;
  /** The area that holds the key result, as people write it. */
  rel: string;
  /** The key results it aligns to, by bare id. */
  aligns: string[];
  title: string;
  owner: string;
  unit: string;
  by: string;
  period?: string;
  /** Progress from baseline toward target: 0..1, past 1 on overshoot, below 0 when it moved the wrong way. */
  progress: number;
  /** Which way the figure should move. Up unless the key result says down. */
  direction: "up" | "down";
  latest: { value: number; date: string } | null;
  stale: boolean;
  /** The hash of the key result's file as read: a save from the page sends it back, so a file changed since fails. */
  version: string;
}

/** A key result on an area's page: the ladder row, plus its objective, targets and what it aligns to. */
export interface DashKr extends KrRef {
  objective: string;
  baseline: number;
  target: number;
  aligns_to: string[];
  /** The key results above it that it aligns to, found in the company. */
  above: KrRef[];
}

/** A bet as a row of the ladder: its outcome, where it sits, and its delivery when it has any. */
export interface BetRef {
  id: string;
  rel: string;
  /** The bets it aligns to, by bare id. */
  aligns: string[];
  outcome: string;
  owner: string;
  delivery?: BetDelivery;
  stories: StoryRow[];
}

/** A bet on an area's page: its key results, what it aligns to, and its delivery. */
export interface DashBet extends BetRef {
  team: string;
  hypothesis: string;
  starts: string;
  review_on: string;
  deadline: string;
  krs: { primary: string | null; also: string[] };
  /** The bets above it that it aligns to, found in the company. */
  aligns_to: BetRef[];
}

/** A bet below an area's bets or key results, that delivers them: how it does, and the key result or bet it's of. */
export interface BelowBet extends BetRef {
  /** primary and also: it aims at the key result. via: a bet below one that does. child: a bet below one of the area's bets. */
  how: "primary" | "also" | "via" | "child";
  of: string;
}

/** A story map that delivers a bet: where it lives, who owns it, and how old its read is. */
export interface DrillMap {
  host: string;
  repo: string;
  key: string;
  owner?: string;
  title?: string;
  age: string;
}

export interface AreaPage {
  plan: { rel: string; level: AreaLevel; id: string; name: string; period?: string; reportsTo: string | null };
  today: string;
  tree: AreaTree;
  breadcrumb: Crumb[];
  /** The quarters that have department key results, oldest first. */
  periods: string[];
  /** The quarter the page shows, for departments, groups and teams. Undefined for the company. */
  period?: string;
  /** The key results in this area's ladder column: a company's or department's own, or those a group's or team's bets aim at. */
  krs: DashKr[];
  /** The key results above those, that the ladder's left column shows. */
  aboveKrs: KrRef[];
  bets: DashBet[];
  /** The bets above the area's bets, that the ladder's right column shows. */
  aboveBets: BetRef[];
  /** What was widened: the levels above the ladder, and the levels below it. */
  widen: { up: boolean; down: boolean };
  /** The bets below the area's bets and key results. Only when it widened down. */
  belowBets: BelowBet[];
  repos: RepoRead[];
  /** What the page says before the rest: an unknown area, or a quarter with no key results. */
  notices: string[];
  warnings: DeliveryWarning[];
  /** Files that won't load. The page still shows the rest. */
  problems: string[];
}

export interface DrillBet {
  id: string;
  rel: string;
  outcome: string;
  /** primary and also: the bet aims at the key result. via: a bet below one that does. */
  aims: "primary" | "also" | "via";
  delivery?: BetDelivery;
  maps: DrillMap[];
}

export interface DrillArea {
  rel: string;
  level: AreaLevel;
  id: string;
  name: string;
  bets: DrillBet[];
}

export interface KrDrill {
  kr: KrRef;
  areas: DrillArea[];
}

export interface BetDrill {
  bet: BetRef;
  /** Each bet below this one through aligns_to, nearest first. Each is listed once. */
  children: { id: string; rel: string; level: AreaLevel; outcome: string; delivery?: BetDelivery }[];
  maps: DrillMap[];
}

export interface UpChain {
  bet: BetRef;
  /** The bets above, level by level: depth 1 is what the bet aligns to directly. */
  levels: { depth: number; bets: BetRef[] }[];
  /** The key results the bet itself aims at. */
  krs: { primary: string | null; also: string[] };
}

const quarter = /^(\d{4})-Q([1-4])$/;

/** The quarter a date falls in, as the plan writes it: 2026-11-10 is 2026-Q4. */
const quarterOf = (date: string) => `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;

/** A name for a level: the plan's own name, or the id. Teams are known by their key. */
const nameOf = (area: Area): string => {
  const name = areaFile(area)?.name;
  return typeof name === "string" && name.trim() ? name : area.id;
};

/** Every area as a tree node. The company comes first; each node lists the areas directly below it. */
export function areaTree(repo: string): AreaTree {
  const areas = listAreas(repo);
  const parents = new Map(areas.map((a) => [a.rel, parentOf(a)?.rel ?? null] as const));
  return areas.map((a) => ({
    rel: a.rel,
    level: a.level,
    id: a.id,
    name: a.level === "company" ? (nameOf(a) === a.id ? "Company" : nameOf(a)) : nameOf(a),
    parent: parents.get(a.rel) ?? null,
    children: areas.filter((c) => parents.get(c.rel) === a.rel).map((c) => c.rel),
    path: chainOf(a).map((x) => x.rel),
  }));
}

/**
 * The area a page shows: the one named by ?at=, else the company. A name that isn't an area falls back to
 * the company, with a notice that says so.
 */
export function resolveAt(repo: string, at?: string): { area: Area; notice?: string } {
  const company = listAreas(repo).find((a) => a.level === "company");
  if (!company) throw new Error("This isn't a planning repo. Make one with: nikos plan init --name \"<company>\" --year <year>");
  const ref = at?.trim();
  if (!ref) return { area: company };
  try {
    return { area: findArea(repo, ref) };
  } catch {
    return { area: company, notice: `There's no area called '${ref}'. Showing the company instead.` };
  }
}

/** The breadcrumb for an area: Company, then each area above it down to the area itself. Each part links to its area. */
export function breadcrumbOf(tree: AreaTree, rel: string): Crumb[] {
  const node = tree.find((n) => n.rel === rel);
  if (!node) return [];
  return node.path.map((r) => {
    const n = tree.find((x) => x.rel === r)!;
    // A team is known by its key, as the plan writes it; a company is "Company".
    const label = n.level === "company" ? "Company" : n.level === "team" ? n.id : n.name;
    return { label, rel: r, href: `?at=${r}` };
  });
}

/** The quarters that have department key results, oldest first. Company key results are for the year, so they aren't here. */
export function periodsOf(repo: string): string[] {
  const out = new Set<string>();
  for (const area of listAreas(repo)) {
    if (area.level !== "department") continue;
    for (const id of krIds(area.dir)) {
      let period: unknown;
      try {
        period = loadKr(area.dir, id).data.period;
      } catch {
        continue; // reported with the area's own files
      }
      if (typeof period === "string" && quarter.test(period)) out.add(period);
    }
  }
  return [...out].sort();
}

/**
 * The quarter a page shows. A requested quarter with key results is shown as asked. Otherwise the current
 * quarter when it has key results, else the latest quarter that has them, with a notice saying so.
 */
export function pickPeriod(periods: string[], requested: string | undefined, today: string): { period?: string; notice?: string } {
  if (requested && periods.includes(requested)) return { period: requested };
  if (!periods.length) return requested ? { notice: `There are no key results for ${requested} yet.` } : {};
  const current = quarterOf(today);
  const fallback = periods.includes(current) ? current : periods[periods.length - 1];
  if (requested) return { period: fallback, notice: `There are no key results for ${requested} yet. Showing ${fallback}, the latest quarter with key results.` };
  if (fallback !== current) return { period: fallback, notice: `There are no key results for ${current} yet. Showing ${fallback}, the latest quarter with key results.` };
  return { period: fallback };
}

/** The key result a reference names, wherever it's held in the company, as a ladder row. Undefined when there's none. */
export function aboveKr(repo: string, id: string, on: string = new Date().toISOString().slice(0, 10), problems?: string[]): KrRef | undefined {
  return holderKr(repo, id, on, problems)?.ref;
}

/**
 * A key result held somewhere in the company, as a ladder row. A key result that won't load is a problem
 * for the page to say, and only that one is left out: the rest of the ladder still shows.
 */
function holderKr(repo: string, id: string, on: string, problems?: string[]): { ref: KrRef } | undefined {
  let holder: Area;
  try {
    holder = areaHolding(repo, id, "key result");
  } catch {
    return undefined;
  }
  try {
    return { ref: krRef(holder, id, on) };
  } catch (err) {
    problems?.push((err as Error).message.split("\n")[0]);
    return undefined;
  }
}

/** Every key result above the given references, through aligns_to, each once. A cycle ends. */
function krAncestors(repo: string, aligns: string[], on: string, problems?: string[]): KrRef[] {
  const out = new Map<string, KrRef>();
  const seen = new Set<string>();
  const queue = [...aligns];
  while (queue.length) {
    const ref = queue.shift()!;
    if (seen.has(ref)) continue;
    seen.add(ref);
    const hit = holderKr(repo, ref, on, problems);
    if (!hit) continue;
    out.set(`${hit.ref.rel}/${hit.ref.id}`, hit.ref);
    queue.push(...hit.ref.aligns);
  }
  return [...out.values()];
}

function krRef(area: Area, id: string, on: string): KrRef {
  const kr = loadKr(area.dir, id);
  const d = kr.data;
  const last = latest(d);
  return {
    id,
    rel: area.rel,
    aligns: alignsList(d.aligns_to),
    title: d.title ?? id,
    owner: d.owner ?? "",
    unit: d.unit ?? "",
    by: d.by ?? "",
    ...(d.period !== undefined ? { period: String(d.period) } : {}),
    progress: progress(d),
    direction: directionOf(d),
    latest: last ? { value: last.value, date: last.date } : null,
    stale: isStale(d, on),
    version: kr.hash,
  };
}

/** A bet's date as the plan writes it, or "" when it has none. */
const dateOf = (v: unknown): string => (typeof v === "string" ? v : v instanceof Date ? v.toISOString().slice(0, 10) : "");

interface BetRec {
  id: string;
  area: Area;
  owner: string;
  team: string;
  hypothesis: string;
  outcome: string;
  starts: string;
  review_on: string;
  deadline: string;
  krs: { primary: string | null; also: string[] };
  aligns: string[];
}

/** Every bet in the company, read once. A bet that won't load is listed as a problem, and left out. */
function betRecords(repo: string): { bets: Map<string, BetRec>; problems: string[] } {
  const bets = new Map<string, BetRec>();
  const problems: string[] = [];
  for (const area of listAreas(repo)) {
    for (const id of betIds(area.dir)) {
      try {
        const m = loadBet(area.dir, id).meta;
        bets.set(id, {
          id,
          area,
          owner: m.owner ?? "",
          team: m.team ?? "",
          hypothesis: m.hypothesis ?? "",
          outcome: m.outcome ?? "",
          starts: dateOf(m.starts),
          review_on: m.review_on ?? "",
          deadline: dateOf(m.deadline),
          krs: { primary: m.krs?.primary ?? null, also: m.krs?.also ?? [] },
          aligns: alignsList(m.aligns_to),
        });
      } catch (err) {
        problems.push((err as Error).message.split("\n")[0]);
      }
    }
  }
  return { bets, problems };
}

/** Each bet's children: the bets that align to it, by bare id. Refs to other repos are not counted. */
function childrenOf(bets: Map<string, BetRec>): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const b of bets.values()) {
    for (const ref of b.aligns) {
      if (!bets.has(ref)) continue;
      children.set(ref, [...(children.get(ref) ?? []), b.id]);
    }
  }
  return children;
}

/** The read age of a map's repo, and its owner and title from the copy. */
function mapRefOf(repo: string, deliveries: PlanDeliveries): (ref: { host: string; repo: string; key: string }) => DrillMap {
  const cached = new Map<string, { owner?: string; title?: string }>();
  for (const r of readCache(repo).repos) {
    for (const m of r.maps) {
      const sm = m.storymap ?? {};
      const owner = m.summary?.owner ?? sm.owner;
      const title = sm.title ?? sm.project;
      cached.set(`${r.host}/${r.repo}/${m.key}`, { ...(typeof owner === "string" && owner ? { owner } : {}), ...(typeof title === "string" && title ? { title } : {}) });
    }
  }
  return (ref) => {
    const read = deliveries.repos.find((r) => r.host === ref.host && r.repo === ref.repo);
    return { ...ref, ...(cached.get(`${ref.host}/${ref.repo}/${ref.key}`) ?? {}), age: read?.age ?? "not read yet" };
  };
}

/** A bet as a ladder row, with its delivery and stories from the plan's copies. */
function betRefOf(rec: BetRec, deliveries: PlanDeliveries): BetRef {
  const delivery = deliveries.bets.get(rec.id);
  return {
    id: rec.id,
    rel: rec.area.rel,
    aligns: rec.aligns,
    outcome: rec.outcome,
    owner: rec.owner,
    ...(delivery ? { delivery } : {}),
    stories: deliveries.stories.get(rec.id) ?? [],
  };
}

/**
 * An area's page: its key results and bets, what they align to above, its delivery and the period it
 * shows. A group's or team's key results are the ones its bets aim at. Files that won't load are problems.
 */
export function areaPage(repo: string, area: Area, opts: { period?: string; notices?: string[]; deliveries: PlanDeliveries; now: Date; widen?: { up: boolean; down: boolean } }): AreaPage {
  const today = opts.now.toISOString().slice(0, 10);
  const widen = opts.widen ?? { up: false, down: false };
  const tree = areaTree(repo);
  const { bets: records, problems: betProblems } = betRecords(repo);
  const problems = [...betProblems];
  const notices = [...(opts.notices ?? [])];
  const periods = periodsOf(repo);
  let period: string | undefined;
  if (area.level !== "company") {
    const picked = pickPeriod(periods, opts.period, today);
    period = picked.period;
    if (picked.notice) notices.push(picked.notice);
  }
  const ownBets = [...records.values()].filter((b) => b.area.rel === area.rel);

  // The key results in this area's column. A group or team has none of its own: it shows what its bets aim at.
  const holders: { id: string; holder: Area }[] = [];
  if (area.level === "company" || area.level === "department") {
    for (const id of krIds(area.dir)) holders.push({ id, holder: area });
  } else {
    const aimed = new Set<string>();
    for (const b of ownBets) for (const k of [b.krs.primary, ...b.krs.also]) if (k) aimed.add(k);
    for (const id of aimed) {
      try {
        holders.push({ id, holder: areaHolding(repo, id, "key result") });
      } catch {
        problems.push(`${area.rel}'s bets aim at '${id}', which isn't a key result in this company's plan`);
      }
    }
  }
  const krs: DashKr[] = [];
  for (const { id, holder } of holders) {
    // A department's quarterly key results show for the quarter picked; the company's are for the year.
    try {
      const d = loadKr(holder.dir, id).data;
      const quarterly = holder.level === "department" && d.period !== undefined;
      if (quarterly && period !== undefined && String(d.period) !== period) continue;
      const row = krRef(holder, id, today);
      const aligns = alignsList(d.aligns_to);
      krs.push({
        ...row,
        objective: d.objective ?? "",
        baseline: d.baseline,
        target: d.target,
        aligns_to: aligns,
        above: aligns.flatMap((r) => {
          const hit = aboveKr(repo, r, today, problems);
          return hit ? [hit] : [];
        }),
      });
    } catch (err) {
      problems.push((err as Error).message.split("\n")[0]);
    }
  }
  // One level above by default; widened, every level above through aligns_to. A key result in the column is not repeated above.
  const own = new Set(krs.map((k) => k.id));
  const aboveKrs = new Map<string, KrRef>();
  for (const k of krs) {
    for (const a of widen.up ? krAncestors(repo, k.aligns_to, today, problems) : k.above) if (!own.has(a.id)) aboveKrs.set(`${a.rel}/${a.id}`, a);
  }

  const bets: DashBet[] = ownBets.map((b) => {
    const aligns = b.aligns.flatMap((ref) => {
      const hit = records.get(ref);
      return hit ? [betRefOf(hit, opts.deliveries)] : [];
    });
    return {
      ...betRefOf(b, opts.deliveries),
      team: b.team,
      hypothesis: b.hypothesis,
      starts: b.starts,
      review_on: b.review_on,
      deadline: b.deadline,
      krs: b.krs,
      aligns_to: aligns,
    };
  });
  const aboveBets = new Map<string, BetRef>();
  for (const b of bets) {
    const up = widen.up ? upLevels(records, b.id).flat().map((r) => betRefOf(r, opts.deliveries)) : b.aligns_to;
    for (const a of up) aboveBets.set(`${a.rel}/${a.id}`, a);
  }

  // Widened down: the bets below the area's bets, and the bets that aim at its key results, with the bets below those.
  // A bet above the area, or already listed above or as the area's own, is left out; so is one not below it in level.
  const belowBets: BelowBet[] = [];
  if (widen.down) {
    const rank = RANK[area.level];
    const listed = new Set<string>([...ownBets.map((b) => b.id), ...[...aboveBets.values()].map((a) => a.id), ...ownBets.flatMap((b) => upLevels(records, b.id).flat().map((r) => r.id))]);
    const lower = (id: string) => RANK[records.get(id)!.area.level] > rank;
    const children = childrenOf(records);
    for (const b of ownBets) {
      for (const c of below(b.id, children)) {
        if (listed.has(c) || !lower(c)) continue;
        listed.add(c);
        belowBets.push({ ...betRefOf(records.get(c)!, opts.deliveries), how: "child", of: b.id });
      }
    }
    for (const k of krs) {
      for (const [id, aim] of aimsAt(records, k.id)) {
        if (listed.has(id) || !lower(id)) continue;
        listed.add(id);
        belowBets.push({ ...betRefOf(records.get(id)!, opts.deliveries), how: aim, of: k.id });
      }
    }
  }

  const warnings = opts.deliveries.warnings;
  const parent = parentOf(area);
  return {
    plan: {
      rel: area.rel,
      level: area.level,
      id: area.id,
      name: nameOf(area),
      ...(area.level === "company" && areaFile(area)?.period !== undefined ? { period: String(areaFile(area).period) } : {}),
      reportsTo: parent?.rel ?? null,
    },
    today,
    tree,
    breadcrumb: breadcrumbOf(tree, area.rel),
    periods,
    ...(period !== undefined ? { period } : {}),
    krs,
    aboveKrs: [...aboveKrs.values()],
    bets,
    aboveBets: [...aboveBets.values()],
    widen,
    belowBets,
    repos: opts.deliveries.repos,
    notices,
    warnings,
    problems,
  };
}

/** A key result's drill-down: the bets that aim at it, and the bets below those, grouped by the area that holds them. */
export function drillKr(repo: string, krId: string, deliveries: PlanDeliveries, now: Date = new Date()): KrDrill | undefined {
  const kr = aboveKr(repo, krId, now.toISOString().slice(0, 10));
  if (!kr) return undefined;
  const { bets } = betRecords(repo);
  const aims = aimsAt(bets, krId);
  const maps = mapRefOf(repo, deliveries);
  const areas = new Map<string, DrillArea>();
  for (const area of listAreas(repo)) areas.set(area.rel, { rel: area.rel, level: area.level, id: area.id, name: nameOf(area), bets: [] });
  for (const [id, aim] of aims) {
    const rec = bets.get(id)!;
    const delivery = deliveries.bets.get(id);
    areas.get(rec.area.rel)!.bets.push({
      id,
      rel: rec.area.rel,
      outcome: rec.outcome,
      aims: aim,
      ...(delivery ? { delivery } : {}),
      maps: (delivery?.delivery?.maps ?? []).map(maps),
    });
  }
  return { kr, areas: [...areas.values()].filter((a) => a.bets.length > 0) };
}

/** A bet's drill-down: the bets below it, each with its figures, and the story maps that deliver this bet. */
export function drillBet(repo: string, betId: string, deliveries: PlanDeliveries): BetDrill | undefined {
  const { bets } = betRecords(repo);
  const rec = bets.get(betId);
  if (!rec) return undefined;
  const maps = mapRefOf(repo, deliveries);
  return {
    bet: betRefOf(rec, deliveries),
    children: below(betId, childrenOf(bets)).map((id) => {
      const c = bets.get(id)!;
      const delivery = deliveries.bets.get(id);
      return { id, rel: c.area.rel, level: c.area.level, outcome: c.outcome, ...(delivery ? { delivery } : {}) };
    }),
    maps: (deliveries.bets.get(betId)?.delivery?.maps ?? []).map(maps),
  };
}

/** The bets above a bet, through aligns_to, level by level: level 0 is what it aligns to directly. Each bet is visited once, so a cycle ends. */
function upLevels(bets: Map<string, BetRec>, betId: string): BetRec[][] {
  const seen = new Set([betId]);
  const levels: BetRec[][] = [];
  let frontier = [betId];
  while (frontier.length) {
    const next: BetRec[] = [];
    for (const id of frontier) {
      for (const ref of bets.get(id)?.aligns ?? []) {
        const hit = bets.get(ref);
        if (!hit || seen.has(ref)) continue;
        seen.add(ref);
        next.push(hit);
      }
    }
    if (next.length) levels.push(next);
    frontier = next.map((b) => b.id);
  }
  return levels;
}

/** The bets above a bet, through aligns_to, level by level. Each bet is visited once, so a cycle ends. */
export function upChain(repo: string, betId: string, deliveries?: PlanDeliveries): UpChain | undefined {
  const { bets } = betRecords(repo);
  const root = bets.get(betId);
  if (!root) return undefined;
  const d = deliveries ?? emptyDeliveries;
  const levels = upLevels(bets, betId).map((list, i) => ({ depth: i + 1, bets: list.map((b) => betRefOf(b, d)) }));
  return { bet: betRefOf(root, d), levels, krs: root.krs };
}

/** The bets that aim at a key result (primary or also), and the bets below those, with how each one does. */
function aimsAt(bets: Map<string, BetRec>, krId: string): Map<string, DrillBet["aims"]> {
  const children = childrenOf(bets);
  const aims = new Map<string, DrillBet["aims"]>();
  for (const b of bets.values()) {
    if (b.krs.primary === krId) aims.set(b.id, "primary");
    else if (b.krs.also.includes(krId)) aims.set(b.id, "also");
  }
  for (const [id, how] of [...aims]) {
    if (how === "primary" || how === "also") for (const under of below(id, children)) if (!aims.has(under)) aims.set(under, "via");
  }
  return aims;
}

const emptyDeliveries: PlanDeliveries = { cached: false, bets: new Map(), stories: new Map(), repos: [], warnings: [] };
