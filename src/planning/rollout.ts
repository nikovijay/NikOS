// `nikos planning rollout`: how the plans below this one are doing. planning/downstream.yaml
// lists the departments and teams that plan against this repo; rollout fetches a read-only copy
// of each into .nikos/downstream/<repo path>/ (gitignored), and of the ones they list in turn,
// and reports for each: has it joined, when did it last sync this plan, how is its delivery
// going, and which of its key results and bets point up here. Nothing is written to their repos.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parse, parseDocument } from "yaml";
import { isDone } from "../lib/project.js";
import { storyMapOf } from "../commands/map.js";
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
  /** stale: no check-in within its window. checkedIn: it has had at least one. */
  krs: { id: string; title: string; aligns_to?: string; progress: number; stale: boolean; checkedIn: boolean }[];
  bets: { id: string; outcome: string; delivery: string; krs: string[] }[];
}

export interface Rollout {
  /** This repo's path, as the plans below name it in their upstream.yaml. */
  repo?: string;
  plans: DownstreamPlan[];
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
    const base = { name: listed.name, ...(via ? { via } : {}), krs: [], bets: [] };
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
      plans.push({ name: `${e.repo}'s downstream.yaml`, state: "unreachable", reason: (err as Error).message, krs: [], bets: [] });
    }
  }
  if (!opts.offline) {
    ignoreCache(root);
    mkdirSync(cache(root), { recursive: true });
    writeFileSync(indexOf(root), JSON.stringify(index, null, 2));
  }
  return { ...(self ? { repo: self } : {}), plans };
}

/** The rollout as lines, one block per plan. */
export function formatRollout(r: Rollout): string {
  if (!r.plans.length) return "No plans below this one: list departments and teams in planning/downstream.yaml as `- name: Payments` and `repo: acme/payments-plan`.";
  const out: string[] = [];
  const joined = r.plans.filter((p) => p.state === "joined").length;
  out.push(`${joined} of ${r.plans.length} plans below ${r.repo ?? "this one"} have joined.`);
  for (const p of r.plans) {
    const mark = p.state === "joined" ? "✓" : p.state === "not joined" ? "!" : "?";
    out.push(`\n${mark} ${p.name}${p.repo && p.repo !== p.name ? ` (${p.repo})` : ""}${p.via ? `, below ${p.via}` : ""}: ${p.state}${p.reason ? `, ${p.reason}` : ""}`);
    if (p.synced) out.push(`    synced on ${p.synced.on} at ${p.synced.commit.slice(0, 7)}${p.synced.current === false ? `, behind ${p.via ?? "this plan"}: ask them to run nikos planning sync` : ""}`);
    if (p.delivery) out.push(`    delivery: ${p.delivery.done} of ${p.delivery.stories} stories done${p.delivery.approved ? ` (${p.delivery.approved} approved)` : ""}, ${p.delivery.inProgress} in progress`);
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
