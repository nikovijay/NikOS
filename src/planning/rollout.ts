// `nikos planning rollout`: how the plans below this one are doing. planning/downstream.yaml
// lists the departments and teams that plan against this repo; rollout fetches a read-only copy
// of each into .nikos/downstream/<repo path>/ (gitignored), and of the ones they list in turn,
// and reports for each: has it joined, when did it last sync this plan, how is its delivery
// going, and which of its key results and bets point up here. Nothing is written to their repos.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parse, parseDocument } from "yaml";
import { findIntentDir, isDone } from "../lib/project.js";
import { loadStates } from "../lib/state-files.js";
import { storyMapOf } from "../commands/map.js";
import { next } from "../commands/next.js";
import { decisionEntries } from "../commands/decisions.js";
import { delivery, describeDelivery } from "./delivery.js";
import { progress, isStale } from "./krs.js";
import { betIds, krIds, loadBet, loadKr, today } from "./model.js";
import { git, ignoreCache, readLock, repoEntry, upstreamEntries, type UpstreamEntry } from "./upstream.js";

export interface DownstreamPlan {
  name: string;
  /** Its repo path, once it has one. */
  repo?: string;
  /** For a plan further down: the downstream that listed it. */
  via?: string;
  state: "no repo yet" | "unreachable" | "not joined" | "joined";
  reason?: string;
  /** When this repo's copy of it was fetched. */
  fetched?: string;
  /**
   * Its last sync of the plan it joined: when, and whether it read that plan's current commit.
   * That plan is this repo, or for a plan further down, `via` as rollout fetched it.
   */
  synced?: { on: string; commit: string; current?: boolean };
  delivery?: { stories: number; done: number; approved: number; inProgress: number; releases: number };
  /** The story its team builds next, as nikos next would say. */
  next?: { id: string; title: string };
  /** Stories with blockers in their state, and what's blocking each. */
  blockers: Blocker[];
  /** Its latest decisions, newest first. */
  decisions: Decision[];
  /** stale: no check-in within its window. checkedIn: it has had at least one. */
  krs: { id: string; title: string; aligns_to?: string; progress: number; stale: boolean; checkedIn: boolean }[];
  bets: { id: string; outcome: string; delivery: string; krs: string[] }[];
}

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
  kind: "kr" | "bet";
  id: string;
  title: string;
  /** The plan it belongs to: a downstream name, or this repo. */
  plan: string;
  repo?: string;
  /** For an unaligned key result: what it points at, which isn't in this rollout. */
  aligns_to?: string;
  children: AlignmentNode[];
}

export interface Rollout {
  /** This repo's path, as the plans below name it in their upstream.yaml. */
  repo?: string;
  /** This repo's own latest decisions. */
  decisions: Decision[];
  plans: DownstreamPlan[];
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

/** This repo's path on its host, from the origin remote: owner/repo, or group/subgroup/project. */
export function ownRepo(root: string): string | undefined {
  const url = spawnSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8" }).stdout?.trim() ?? "";
  const m = url.match(/^(?:[a-z+]+:\/\/[^/]+\/|[^@\s]+@[^:\s]+:)(.+?)(?:\.git)?\/?$/);
  return m?.[1];
}

interface Listed {
  name: string;
  entry?: UpstreamEntry;
}

/** The plans a repo (or a copy of one) lists in planning/downstream.yaml. */
export function downstreamEntries(dir: string): Listed[] {
  const p = join(dir, "planning", "downstream.yaml");
  if (!existsSync(p)) return [];
  const list = parse(readFileSync(p, "utf8")) ?? [];
  if (!Array.isArray(list)) throw new Error("planning/downstream.yaml should be a list of { name, repo }");
  return list.map((e: any) => {
    const name = typeof e === "string" ? e : String(e?.name ?? e?.repo ?? "");
    if (!name) throw new Error("planning/downstream.yaml: each entry needs a name or a repo");
    return { name, ...(e?.repo ? { entry: repoEntry(e, "planning/downstream.yaml") } : {}) };
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
  const blockers: Blocker[] = [];
  if (existsSync(join(dir, "intent", "storymap.yaml"))) {
    try {
      const map = storyMapOf(dir);
      const stories = map.releases.flatMap((r) => r.stories).filter((s) => s.status !== "cancelled");
      deliv = {
        stories: stories.length,
        done: stories.filter((s) => isDone(s.status)).length,
        approved: stories.filter((s) => s.status === "approved").length,
        inProgress: stories.filter((s) => s.status === "in_progress").length,
        releases: map.releases.length,
      };
      const titles = new Map([...stories, ...map.unreleased].map((s) => [s.id, s.title]));
      const id = (() => {
        try {
          return next(dir).story;
        } catch {
          return undefined; // no state.yaml to read a queue from: delivery and blockers still show
        }
      })();
      if (id) nextUp = { id, title: titles.get(id) ?? id };
      for (const [story, st] of Object.entries(loadStates(findIntentDir(dir)))) {
        if (st?.blockers?.length && st.status !== "cancelled" && !isDone(st.status)) blockers.push({ story, title: titles.get(story) ?? story, blockers: st.blockers.map(String) });
      }
    } catch {
      // A story map that doesn't read is the team's to fix; the rest of the rollout still shows.
    }
  }
  const krs = krIds(dir).flatMap((id) => {
    try {
      const k = loadKr(dir, id).data;
      return [{ id, title: k.title, ...(k.aligns_to ? { aligns_to: k.aligns_to } : {}), progress: progress(k), stale: isStale(k), checkedIn: (k.checkins?.length ?? 0) > 0 }];
    } catch {
      return [];
    }
  });
  const bets = betIds(dir).flatMap((id) => {
    try {
      const m = loadBet(dir, id).meta;
      return [{ id, outcome: m.outcome, delivery: describeDelivery(delivery(dir, id)), krs: [m.krs?.primary, ...(m.krs?.also ?? [])].filter(Boolean) }];
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
    blockers,
    decisions: latestDecisions(dir),
    krs,
    bets,
  };
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
    const base = { name: listed.name, ...(via ? { via } : {}), blockers: [], decisions: [], krs: [], bets: [] };
    if (!listed.entry) {
      plans.push({ ...base, state: "no repo yet" });
      continue;
    }
    const e = listed.entry;
    if (seen.has(e.repo)) continue;
    seen.add(e.repo);
    const dir = copyOf(root, e.repo);
    if (!opts.offline) {
      rmSync(dir, { recursive: true, force: true });
      const clone = git(["clone", "--quiet", "--depth", "1", "--branch", e.ref, e.url, dir]);
      if (clone.status !== 0) {
        rmSync(dir, { recursive: true, force: true });
        delete index[e.repo];
        plans.push({ ...base, repo: e.repo, state: "unreachable", reason: (clone.stderr || "clone failed").trim().split("\n").pop()! });
        continue;
      }
      index[e.repo] = { commit: git(["rev-parse", "HEAD"], dir).stdout.trim(), fetched: today() };
      rmSync(join(dir, ".git"), { recursive: true, force: true }); // a plain copy: nothing to push back
    } else if (!existsSync(dir)) {
      plans.push({ ...base, repo: e.repo, state: "unreachable", reason: "not fetched yet: run nikos planning rollout" });
      continue;
    }
    // A plan further down joins the one that listed it, not this repo.
    const plan = { ...base, ...read(root, dir, e.repo, depth === 1 ? self : parent), ...(index[e.repo] ? { fetched: index[e.repo].fetched } : {}) };
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
  return { ...(self ? { repo: self } : {}), decisions: latestDecisions(root), plans, tree: alignment(root, self, plans) };
}

type Source = { plan: string; repo?: string; krs: { id: string; title: string; aligns_to?: string }[]; bets: { id: string; krs: string[] }[] };

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
 * The tree from aligns_to links: each key result's children are the key results that align to it,
 * then the bets that name it. It records links only and never works out progress from children.
 */
export function alignment(root: string, self: string | undefined, plans: DownstreamPlan[]): Rollout["tree"] {
  const sources: Source[] = [own(root, self), ...plans.filter((p) => p.repo).map((p) => ({ plan: p.name, repo: p.repo, krs: p.krs, bets: p.bets }))];
  // A key result is known as repo#id. One from a repo whose path isn't known can't be pointed at.
  const key = (repo: string | undefined, id: string) => (repo ? `${repo}#${id}` : undefined);
  const krAt = new Map<string, { s: Source; k: Source["krs"][number] }>();
  for (const s of sources) for (const k of s.krs) if (key(s.repo, k.id)) krAt.set(key(s.repo, k.id)!, { s, k });
  const alignsTo = new Map<string, { s: Source; k: Source["krs"][number] }[]>();
  const betsOn = new Map<string, { s: Source; b: Source["bets"][number] }[]>();
  const placed = new Set<string>();
  for (const s of sources.slice(1)) {
    for (const k of s.krs) if (k.aligns_to && krAt.has(k.aligns_to)) alignsTo.set(k.aligns_to, [...(alignsTo.get(k.aligns_to) ?? []), { s, k }]);
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
        ...(betsOn.get(at) ?? []).map(({ s: bs, b }) => betNode(bs, b)),
      ],
    };
  };
  const betNode = (s: Source, b: Source["bets"][number]): AlignmentNode => {
    placed.add(`bet ${s.repo ?? s.plan}/${b.id}`);
    return { kind: "bet", id: b.id, title: b.id, plan: s.plan, ...(s.repo ? { repo: s.repo } : {}), children: [] };
  };
  const roots = sources[0].krs.map((k) => krNode(sources[0], k, new Set()));
  // Key results below that point at nothing here (or at nothing at all) start their own branch.
  const unaligned: AlignmentNode[] = [];
  for (const s of sources.slice(1)) {
    for (const k of s.krs) {
      if (placed.has(`kr ${key(s.repo, k.id)}`) || (k.aligns_to && krAt.has(k.aligns_to))) continue;
      unaligned.push({ ...krNode(s, k, new Set()), ...(k.aligns_to ? { aligns_to: k.aligns_to } : {}) });
    }
  }
  // Key results that only align to each other in a loop are still shown, from the first one listed.
  for (const s of sources.slice(1)) for (const k of s.krs) if (!placed.has(`kr ${key(s.repo, k.id)}`)) unaligned.push(krNode(s, k, new Set()));
  for (const s of sources) for (const b of s.bets) if (!placed.has(`bet ${s.repo ?? s.plan}/${b.id}`)) unaligned.push(betNode(s, b));
  return { roots, unaligned };
}

/** The alignment tree as indented lines, with box-drawing branches. */
export function formatTree(tree: Rollout["tree"]): string[] {
  const label = (n: AlignmentNode) =>
    n.kind === "kr" ? `KR ${n.id}: ${n.title} (${n.plan})${n.aligns_to ? ` → ${n.aligns_to}, not in this rollout` : ""}` : `bet ${n.id} (${n.plan})`;
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
  const tree = formatTree(r.tree);
  if (tree.length) out.push("", ...tree);
  if (r.decisions.length) out.push("", `Latest decisions here:`, ...r.decisions.map((d) => `  ${d.title}`));
  for (const p of r.plans) {
    const mark = p.state === "joined" ? "✓" : p.state === "not joined" ? "!" : "?";
    out.push(`\n${mark} ${p.name}${p.repo && p.repo !== p.name ? ` (${p.repo})` : ""}${p.via ? `, below ${p.via}` : ""}: ${p.state}${p.reason ? `, ${p.reason}` : ""}`);
    if (p.synced) out.push(`    synced on ${p.synced.on} at ${p.synced.commit.slice(0, 7)}${p.synced.current === false ? `, behind ${p.via ?? "this plan"}: ask them to run nikos planning sync` : ""}`);
    if (p.delivery) out.push(`    delivery: ${p.delivery.done} of ${p.delivery.stories} stories done${p.delivery.approved ? ` (${p.delivery.approved} approved)` : ""}, ${p.delivery.inProgress} in progress`);
    if (p.next) out.push(`    next: ${p.next.id} ${p.next.title}`);
    for (const b of p.blockers) out.push(`    blocked: ${b.story} ${b.title}: ${b.blockers.join("; ")}`);
    for (const d of p.decisions) out.push(`    decision: ${d.title}`);
    for (const k of p.krs) out.push(`    KR ${k.id}: ${k.title}, ${Math.round(k.progress * 100)}%${!k.checkedIn ? ", no check-ins yet" : k.stale ? ", stale" : ""}${k.aligns_to ? ` → ${k.aligns_to}` : ""}`);
    for (const b of p.bets) out.push(`    bet ${b.id}: ${b.delivery}, ${b.outcome}${b.krs.length ? ` → ${b.krs.join(", ")}` : ""}`);
  }
  return out.join("\n");
}

/** List a department or team in planning/downstream.yaml, or give an entry already there its repo. */
export function addDownstream(root: string, input: { name: string; repo?: string; host?: string; url?: string }): { name: string; repo?: string; added: boolean } {
  const name = input.name?.trim();
  if (!name) throw new Error("Give the department's or team's name");
  if ((input.host || input.url) && !input.repo) throw new Error("Give the repo path too (--repo), so rollout knows what to call it");
  const entry = { name, ...(input.repo ? { repo: input.repo } : {}), ...(input.host ? { host: input.host } : {}), ...(input.url ? { url: input.url } : {}) };
  if (input.repo) repoEntry(entry, "planning/downstream.yaml"); // a bad repo path or host fails before anything is written
  const p = join(root, "planning", "downstream.yaml");
  const doc = parseDocument(existsSync(p) ? readFileSync(p, "utf8") : "# The departments and teams that plan against this one: name, and their repo once they have one.\n[]\n");
  if (!doc.contents || !("items" in (doc.contents as any))) doc.contents = doc.createNode([]) as any;
  (doc.contents as any).flow = false;
  const items = (doc.contents as any).items as any[];
  const at = items.findIndex((it) => {
    const v = it?.toJSON?.() ?? it;
    return (typeof v === "string" ? v : v?.name) === name || (input.repo && v?.repo === input.repo);
  });
  if (at >= 0) items[at] = doc.createNode(entry);
  else items.push(doc.createNode(entry));
  mkdirSync(join(root, "planning"), { recursive: true });
  writeFileSync(p, doc.toString({ lineWidth: 0 }));
  return { name, ...(input.repo ? { repo: input.repo } : {}), added: at < 0 };
}
