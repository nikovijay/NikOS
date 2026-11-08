// Plans this repo works toward, in other repos. planning/upstream.yaml lists them;
// `nikos planning sync` fetches a read-only copy of each into .nikos/upstream/<repo path>/
// (gitignored) and records the commit it read in planning/upstream.lock. This repo only ever
// stores references like owner/repo#id, never the upstream content. Any git host works:
// GitHub by default, GitLab (with nested groups) or a self-managed host through `host:`, and
// anything else through `url:`.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import { CROSS_REF, REPO_PATH } from "../lib/bets.js";
import { parseFrontMatter } from "../lib/frontmatter.js";
import { walk } from "../lib/project.js";
import { fetchCopy } from "../lib/fetch-copy.js";
import { storyMapsOf } from "../lib/maps.js";
import { betIds, krIds, loadBet, loadKr, paths, today, writePlanning } from "./model.js";

export interface UpstreamEntry {
  /** The repo's path on its host: owner/repo, or group/subgroup/project. */
  repo: string;
  ref: string;
  url: string;
}
export interface LockEntry {
  repo: string;
  ref: string;
  commit: string;
  synced: string;
  /** For a plan further up the chain: the upstream that named it. */
  via?: string;
}

export const git = (args: string[], cwd?: string) => spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });

const HOST = /^[A-Za-z0-9.-]+(:[0-9]+)?$/;

/**
 * The upstream plans listed in planning/upstream.yaml. A repo is its path on the host; the url is
 * https://<host>/<repo>.git, with host github.com unless the entry names one (gitlab.com, or a
 * self-managed host), and url: overrides it for anything else.
 */
export function upstreamEntries(root: string): UpstreamEntry[] {
  const p = paths(root).upstream;
  if (!existsSync(p)) return [];
  const list = parse(readFileSync(p, "utf8")) ?? [];
  if (!Array.isArray(list)) throw new Error("planning/upstream.yaml should be a list of { repo, ref }");
  return list.map((e: any) => repoEntry(e, "planning/upstream.yaml"));
}

/** Check one { repo, ref, host, url } entry from a plan's yaml list, and work out its url. */
export function repoEntry(e: any, file: string): UpstreamEntry {
  if (typeof e?.repo !== "string" || !REPO_PATH.test(e.repo)) {
    throw new Error(`${file}: '${e?.repo}' is not a repo path (owner/repo, or group/subgroup/project on GitLab)`);
  }
  if (e.host !== undefined && (typeof e.host !== "string" || !HOST.test(e.host))) throw new Error(`${file}: '${e.host}' is not a host name, e.g. gitlab.com`);
  return { repo: e.repo, ref: e.ref ?? "main", url: e.url ?? `https://${e.host ?? "github.com"}/${e.repo}.git` };
}

export function readLock(root: string): LockEntry[] {
  const p = paths(root).lock;
  return existsSync(p) ? (parse(readFileSync(p, "utf8")) ?? []) : [];
}

const cacheDir = (root: string, repo: string) => join(paths(root).cache, ...repo.split("/"));

/** Make sure .nikos/ is gitignored, so upstream copies are never committed. */
export function ignoreCache(root: string): void {
  const p = join(root, ".gitignore");
  const text = existsSync(p) ? readFileSync(p, "utf8") : "";
  if (!/^\/?\.nikos\/?$/m.test(text)) appendFileSync(p, `${text && !text.endsWith("\n") ? "\n" : ""}# nikos planning: read-only copies of upstream plans\n.nikos/\n`);
}

export interface SyncReport {
  synced: LockEntry[];
  unresolved: { repo: string; reason: string }[];
}

/** How many levels up sync follows: team → group → department → company, with room to spare. */
const MAX_DEPTH = 6;

/**
 * Fetch each upstream plan read-only into the cache, and the plans above those: a team that names
 * its department also gets the department's company, so settings and plans reach every level.
 * Returns what was read and what wasn't; writes no lock. Unreachable ones are reported, never fatal.
 */
export function fetchChain(entries: UpstreamEntry[], cache: string, previous: LockEntry[] = []): SyncReport {
  const report: SyncReport = { synced: [], unresolved: [] };
  const entryDir = (repo: string) => join(cache, ...repo.split("/"));
  const queue: { entry: UpstreamEntry; depth: number; via?: string }[] = entries.map((entry) => ({ entry, depth: 1 }));
  const seen = new Set(queue.map((q) => q.entry.repo));
  const scratch = join(cache, ".fetch");
  while (queue.length) {
    const { entry: e, depth, via } = queue.shift()!;
    const dir = entryDir(e.repo);
    // Fetch into a scratch folder and swap it in only on success: a failed fetch keeps the last good copy.
    const fetched = fetchCopy(e.url, e.ref, join(scratch, ...e.repo.split("/")));
    if ("error" in fetched) {
      report.unresolved.push({ repo: e.repo, reason: fetched.error });
      const kept = previous.find((l) => l.repo === e.repo);
      if (kept) report.synced.push(kept); // the last good lock entry, with the copy it was read at
    } else {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dirname(dir), { recursive: true });
      renameSync(join(scratch, ...e.repo.split("/")), dir);
      report.synced.push({ repo: e.repo, ref: e.ref, commit: fetched.commit, synced: today(), ...(via ? { via } : {}) });
    }
    // The copy on disk (new, or the last good one) names the plans above it.
    if (depth >= MAX_DEPTH || !existsSync(dir)) continue;
    let above: UpstreamEntry[] = [];
    try {
      above = upstreamEntries(dir);
    } catch (err) {
      report.unresolved.push({ repo: `${e.repo}'s upstream.yaml`, reason: (err as Error).message });
    }
    for (const up of above) {
      if (seen.has(up.repo)) continue;
      seen.add(up.repo);
      queue.push({ entry: up, depth: depth + 1, via: e.repo });
    }
  }
  rmSync(scratch, { recursive: true, force: true });
  return report;
}

/**
 * Fetch every upstream plan read-only, and the plans above those, into .nikos/upstream/, and
 * record the commits read in planning/upstream.lock.
 */
export function sync(root: string): SyncReport {
  ignoreCache(root);
  const report = fetchChain(upstreamEntries(root), paths(root).cache, readLock(root));
  writePlanning(root, paths(root).lock, `# Written by nikos planning sync: the upstream commit each plan was read at.\n${stringify(report.synced)}`);
  return report;
}

/** Compare each locked commit with the upstream's current one. */
export function checkStale(root: string): { stale: { repo: string; locked: string; current: string }[]; unresolved: { repo: string; reason: string }[] } {
  // This repo's own upstreams, and the ones further up that their copies name.
  const entries = [...upstreamEntries(root)];
  for (const l of readLock(root)) {
    if (!REPO_PATH.test(l.repo)) continue;
    try {
      for (const e of upstreamEntries(cacheDir(root, l.repo))) if (!entries.some((x) => x.repo === e.repo)) entries.push(e);
    } catch {
      // A copy with a broken upstream.yaml was reported at sync.
    }
  }
  const out = { stale: [] as { repo: string; locked: string; current: string }[], unresolved: [] as { repo: string; reason: string }[] };
  for (const l of readLock(root)) {
    const e = entries.find((x) => x.repo === l.repo);
    if (!e) continue;
    const r = git(["ls-remote", e.url, e.ref]);
    const current = r.status === 0 ? r.stdout.split(/\s+/)[0] : "";
    if (!current) out.unresolved.push({ repo: l.repo, reason: (r.stderr || "not reachable").trim().split("\n").pop()! });
    else if (current !== l.commit) out.stale.push({ repo: l.repo, locked: l.commit, current });
  }
  return out;
}

/** The repo paths under .nikos/upstream/ that hold a planning/ folder, at any group depth. */
function copiesOnDisk(cache: string, prefix = "", depth = 0): string[] {
  if (depth > 8 || !existsSync(cache)) return [];
  return readdirSync(cache, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "planning")
    .flatMap((d) => {
      const path = prefix ? `${prefix}/${d.name}` : d.name;
      return existsSync(join(cache, d.name, "planning")) ? [path] : copiesOnDisk(join(cache, d.name), path, depth + 1);
    });
}

/** The read-only copies on disk: each upstream's key results and bets. */
export function loadUpstream(root: string): { repo: string; commit?: string; krs: any[]; bets: any[] }[] {
  const lock = readLock(root);
  // Locked repos, plus copies whose lock entry is missing (e.g. placed by hand).
  const repos = new Set<string>([...lock.map((l) => l.repo), ...copiesOnDisk(paths(root).cache)].filter((r) => REPO_PATH.test(r)));
  const out = [];
  for (const repo of repos) {
    const root2 = cacheDir(root, repo);
    if (!existsSync(join(root2, "planning"))) continue;
    const krs = krIds(root2).flatMap((id) => {
      try {
        return [loadKr(root2, id).data];
      } catch {
        return [];
      }
    });
    const bets = betIds(root2).flatMap((id) => {
      try {
        return [loadBet(root2, id).meta];
      } catch {
        return [];
      }
    });
    out.push({ repo, commit: lock.find((l) => l.repo === repo)?.commit, krs, bets });
  }
  return out;
}

/** Find owner/repo#id among the synced copies. */
export function resolveRef(root: string, ref: string): { repo: string; kind: "kr" | "bet"; data: any } | undefined {
  if (!CROSS_REF.test(ref)) return undefined;
  const [repo, id] = ref.split("#");
  const up = loadUpstream(root).find((u) => u.repo === repo);
  const kr = up?.krs.find((k) => k.id === id);
  if (kr) return { repo, kind: "kr", data: kr };
  const bet = up?.bets.find((b) => b.id === id);
  return bet ? { repo, kind: "bet", data: bet } : undefined;
}

/** Every owner/repo#id this repo's planning files and story map name, with whether it resolves. */
export function crossRefs(root: string): { ref: string; file: string; resolved: boolean }[] {
  const refs: { ref: string; file: string }[] = [];
  for (const id of krIds(root)) {
    const k = loadKr(root, id);
    for (const r of [k.data?.aligns_to ?? []].flat()) if (typeof r === "string") refs.push({ ref: r, file: k.file });
  }
  for (const p of walk(paths(root).bets, ".md")) {
    const meta = parseFrontMatter(readFileSync(p, "utf8"))?.meta;
    for (const r of [meta?.krs?.primary, ...(meta?.krs?.also ?? []), ...[meta?.aligns_to ?? []].flat()]) if (typeof r === "string" && r.includes("#")) refs.push({ ref: r, file: `planning/bets/${basename(p)}` });
  }
  for (const ref of storyMapsOf(root)) {
    const file = ref.id ? `maps/${ref.id}/storymap.yaml` : "intent/storymap.yaml";
    const map = parse(readFileSync(join(ref.dir, "storymap.yaml"), "utf8"));
    for (const r of map?.releases ?? []) for (const b of r?.bets ?? []) if (CROSS_REF.test(b)) refs.push({ ref: b, file });
    for (const list of Object.values(map?.story_bets ?? {})) for (const b of list as string[]) if (CROSS_REF.test(b)) refs.push({ ref: b, file });
  }
  return refs.map((r) => ({ ...r, resolved: resolveRef(root, r.ref) !== undefined }));
}

export async function runSync(root: string, opts: { check?: boolean } = {}): Promise<number> {
  if (!upstreamEntries(root).length) {
    console.log("No upstream plans: add them to planning/upstream.yaml as `- repo: owner/repo` (ref defaults to main).");
    return 0;
  }
  if (opts.check) {
    const r = checkStale(root);
    for (const s of r.stale) console.log(`! ${s.repo} is stale: locked at ${s.locked.slice(0, 7)}, upstream is at ${s.current.slice(0, 7)} — run \`nikos planning sync\``);
    for (const u of r.unresolved) console.log(`? ${u.repo} is unresolved: ${u.reason}`);
    if (!r.stale.length && !r.unresolved.length) console.log("✓ every upstream copy is current");
    return 0;
  }
  const r = sync(root);
  for (const s of r.synced.filter((s) => !r.unresolved.some((u) => u.repo === s.repo))) console.log(`✓ ${s.repo} @ ${s.commit.slice(0, 7)} → .nikos/upstream/${s.repo}/ (read-only copy)`);
  for (const u of r.unresolved) console.log(`? ${u.repo} is unresolved: ${u.reason}. Planning carries on without it.`);
  console.log("✓ planning/upstream.lock updated");
  return 0;
}
