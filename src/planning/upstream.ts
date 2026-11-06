// Plans this repo works toward, in other repos. planning/upstream.yaml lists them;
// `nikos planning sync` fetches a read-only copy of each into .nikos/upstream/<owner>/<repo>/
// (gitignored) and records the commit it read in planning/upstream.lock. This repo only ever
// stores references like owner/repo#id, never the upstream content.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { parse, stringify } from "yaml";
import { CROSS_REF } from "../lib/bets.js";
import { parseFrontMatter } from "../lib/frontmatter.js";
import { walk } from "../lib/project.js";
import { betIds, krIds, loadBet, loadKr, paths, today, writePlanning } from "./model.js";

export interface UpstreamEntry {
  repo: string;
  ref: string;
  url: string;
}
export interface LockEntry {
  repo: string;
  ref: string;
  commit: string;
  synced: string;
}

const git = (args: string[], cwd?: string) => spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });

/** The upstream plans listed in planning/upstream.yaml. A repo is owner/repo; url defaults to GitHub. */
export function upstreamEntries(root: string): UpstreamEntry[] {
  const p = paths(root).upstream;
  if (!existsSync(p)) return [];
  const list = parse(readFileSync(p, "utf8")) ?? [];
  if (!Array.isArray(list)) throw new Error("planning/upstream.yaml should be a list of { repo, ref }");
  return list.map((e: any) => {
    if (typeof e?.repo !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(e.repo)) throw new Error(`planning/upstream.yaml: '${e?.repo}' is not owner/repo`);
    return { repo: e.repo, ref: e.ref ?? "main", url: e.url ?? `https://github.com/${e.repo}.git` };
  });
}

export function readLock(root: string): LockEntry[] {
  const p = paths(root).lock;
  return existsSync(p) ? (parse(readFileSync(p, "utf8")) ?? []) : [];
}

const cacheDir = (root: string, repo: string) => join(paths(root).cache, ...repo.split("/"));

/** Make sure .nikos/ is gitignored, so upstream copies are never committed. */
function ignoreCache(root: string): void {
  const p = join(root, ".gitignore");
  const text = existsSync(p) ? readFileSync(p, "utf8") : "";
  if (!/^\/?\.nikos\/?$/m.test(text)) appendFileSync(p, `${text && !text.endsWith("\n") ? "\n" : ""}# nikos planning: read-only copies of upstream plans\n.nikos/\n`);
}

export interface SyncReport {
  synced: LockEntry[];
  unresolved: { repo: string; reason: string }[];
}

/** Fetch every upstream plan read-only. Unreachable ones are reported, never fatal. */
export function sync(root: string): SyncReport {
  ignoreCache(root);
  const report: SyncReport = { synced: [], unresolved: [] };
  const previous = readLock(root);
  for (const e of upstreamEntries(root)) {
    const dir = cacheDir(root, e.repo);
    rmSync(dir, { recursive: true, force: true });
    const clone = git(["clone", "--quiet", "--depth", "1", "--branch", e.ref, e.url, dir]);
    if (clone.status !== 0) {
      rmSync(dir, { recursive: true, force: true });
      report.unresolved.push({ repo: e.repo, reason: (clone.stderr || "clone failed").trim().split("\n").pop()! });
      const kept = previous.find((l) => l.repo === e.repo);
      if (kept) report.synced.push(kept); // keep the last good lock entry; its copy is gone, so refs show as unresolved
      continue;
    }
    const commit = git(["rev-parse", "HEAD"], dir).stdout.trim();
    rmSync(join(dir, ".git"), { recursive: true, force: true }); // a plain copy: nothing to push back
    report.synced.push({ repo: e.repo, ref: e.ref, commit, synced: today() });
  }
  writePlanning(root, paths(root).lock, `# Written by nikos planning sync: the upstream commit each plan was read at.\n${stringify(report.synced)}`);
  return report;
}

/** Compare each locked commit with the upstream's current one. */
export function checkStale(root: string): { stale: { repo: string; locked: string; current: string }[]; unresolved: { repo: string; reason: string }[] } {
  const entries = upstreamEntries(root);
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

/** The read-only copies on disk: each upstream's key results and bets. */
export function loadUpstream(root: string): { repo: string; commit?: string; krs: any[]; bets: any[] }[] {
  const lock = readLock(root);
  const repos = new Set<string>(lock.map((l) => l.repo));
  // Also pick up copies whose lock entry is missing (e.g. placed by hand).
  for (const owner of walk(paths(root).cache).map((p) => p.slice(paths(root).cache.length + 1).split(/[\\/]/).slice(0, 2).join("/"))) repos.add(owner);
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
    if (k.data?.aligns_to) refs.push({ ref: k.data.aligns_to, file: k.file });
  }
  for (const p of walk(paths(root).bets, ".md")) {
    const meta = parseFrontMatter(readFileSync(p, "utf8"))?.meta;
    for (const r of [meta?.krs?.primary, ...(meta?.krs?.also ?? [])]) if (typeof r === "string" && r.includes("#")) refs.push({ ref: r, file: `planning/bets/${basename(p)}` });
  }
  const mapPath = join(paths(root).intent, "storymap.yaml");
  if (existsSync(mapPath)) {
    const map = parse(readFileSync(mapPath, "utf8"));
    for (const r of map?.releases ?? []) for (const b of r?.bets ?? []) if (CROSS_REF.test(b)) refs.push({ ref: b, file: "intent/storymap.yaml" });
    for (const list of Object.values(map?.story_bets ?? {})) for (const b of list as string[]) if (CROSS_REF.test(b)) refs.push({ ref: b, file: "intent/storymap.yaml" });
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
