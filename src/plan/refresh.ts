// nikos plan refresh: read each code repo in planning/repos.yaml, read-only, and keep the two files
// Plan reads from it (maps/<key>/storymap.yaml and delivery.yaml) under .nikos/delivery/. A repo that
// can't be read keeps its last good copy. This only copies: no bet is matched and nothing is added up.
import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fetchCopy } from "../lib/fetch-copy.js";
import { hostNameOf } from "../lib/forge.js";
import { isGit } from "../lib/git.js";
import { loadRepos, type RepoEntry } from "./repos.js";

/** The two files Plan reads from each map. Everything else in a code repo stays where it is. */
export const KEPT_FILES = ["storymap.yaml", "delivery.yaml"];

const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/i;

export interface CacheEntry {
  repo: string;
  host: string;
  /** The branch read, or "default" when none is named. */
  ref: string;
  state: "ok" | "unreachable";
  /** The commit and read time of the last good copy. Kept when a later read fails. */
  commit?: string;
  read_at?: string;
  /** The map keys copied in the last good read. */
  maps: string[];
  /** Set when the last read failed: git's reason, and when it was tried. */
  reason?: string;
  attempted_at: string;
}

/** .nikos/delivery/index.json: one entry per repo listed, keyed host/owner/repo. */
export interface CacheIndex {
  repos: Record<string, CacheEntry>;
}

export interface RepoRead {
  repo: string;
  host: string;
  state: "ok" | "unreachable";
  commit?: string;
  read_at?: string;
  reason?: string;
  /** True when a failed read kept an earlier good copy. */
  kept: boolean;
  maps: number;
}

export interface RefreshReport {
  repos: RepoRead[];
}

export const cacheRoot = (root: string) => join(root, ".nikos", "delivery");
const indexPath = (root: string) => join(cacheRoot(root), "index.json");
export const cacheKey = (host: string, repo: string) => `${host}/${repo}`;
const repoDir = (root: string, host: string, repo: string) => join(cacheRoot(root), host, ...repo.split("/"));

/** The index as last written, or an empty one when there is none or it doesn't read. */
export function readCacheIndex(root: string): CacheIndex {
  try {
    const data = JSON.parse(readFileSync(indexPath(root), "utf8"));
    if (data && typeof data.repos === "object" && data.repos !== null) return data as CacheIndex;
  } catch {
    // no index yet, or one that doesn't read: every repo is read again
  }
  return { repos: {} };
}

/** The map keys that have files in the copy: each folder under maps/ with a storymap.yaml or delivery.yaml. */
function mapsIn(copy: string): string[] {
  const maps = join(copy, "maps");
  if (!existsSync(maps)) return [];
  return readdirSync(maps)
    .filter((k) => !k.startsWith(".") && statSync(join(maps, k)).isDirectory())
    .filter((k) => KEPT_FILES.some((f) => existsSync(join(maps, k, f))))
    .sort();
}

/** A fresh copy of the kept files, in out/maps/<key>/. Nothing else from the read is kept. */
function keepFiles(copy: string, out: string, keys: string[]): void {
  for (const key of keys) {
    const from = join(copy, "maps", key);
    const to = join(out, "maps", key);
    mkdirSync(to, { recursive: true });
    for (const f of KEPT_FILES) if (existsSync(join(from, f))) copyFileSync(join(from, f), join(to, f));
  }
}

/** Keep .nikos/ out of git, without editing a tracked file: git's own exclude file, when it's not ignored already. */
function keepCacheOutOfGit(root: string): void {
  if (!isGit(root)) return;
  const rel = ".nikos/delivery/index.json";
  if (spawnSync("git", ["check-ignore", "-q", rel], { cwd: root }).status === 0) return;
  const exclude = spawnSync("git", ["rev-parse", "--git-path", "info/exclude"], { cwd: root, encoding: "utf8" }).stdout.trim();
  if (!exclude) return;
  const path = resolve(root, exclude);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, "# nikOS plan: the delivery copies from plan refresh are never committed\n/.nikos/\n");
}

/**
 * Read every repo in planning/repos.yaml, read-only, and write the index. A newer repos.yaml throws
 * (NewerContractError) before anything is fetched. Repos not listed any more lose their copies.
 */
export function refreshDelivery(root: string, opts: { now?: Date } = {}): RefreshReport {
  const now = opts.now ?? new Date();
  const repos = loadRepos(root).repos;
  const prev = readCacheIndex(root);
  const scratch = join(cacheRoot(root), ".fetch");
  const next: CacheIndex = { repos: {} };
  const report: RepoRead[] = [];
  try {
    for (const entry of repos) {
      const read = readOne(root, entry, prev, scratch, now);
      next.repos[cacheKey(read.host, entry.repo)] = read.entry;
      report.push(read.report);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  // A copy of a repo no longer listed is removed, so the cache holds only what the plan reads.
  for (const [key, old] of Object.entries(prev.repos)) {
    if (!next.repos[key] && old.host && old.repo) rmSync(repoDir(root, old.host, old.repo), { recursive: true, force: true });
  }
  mkdirSync(cacheRoot(root), { recursive: true });
  writeFileSync(indexPath(root), `${JSON.stringify(next, null, 2)}\n`);
  keepCacheOutOfGit(root);
  return { repos: report };
}

function readOne(
  root: string,
  entry: RepoEntry,
  prev: CacheIndex,
  scratch: string,
  now: Date,
): { entry: CacheEntry; report: RepoRead; host: string } {
  const host = entry.host ?? (entry.url ? hostNameOf(entry.url) : undefined) ?? "github.com";
  const ref = entry.ref ?? "default";
  const at = now.toISOString();
  const key = cacheKey(host, entry.repo);
  const before = prev.repos[key];
  const unreadable = (reason: string) => {
    const e: CacheEntry = { repo: entry.repo, host, ref, state: "unreachable", maps: [], reason, attempted_at: at };
    return { entry: e, host, report: { repo: entry.repo, host, state: "unreachable" as const, reason, kept: false, maps: 0 } };
  };
  // The host names a folder, so it's checked before any path is built from it.
  if (!HOST.test(host)) return unreadable(`'${host}' isn't a host name`);
  const target = repoDir(root, host, entry.repo);
  const haveCopy = !!before?.read_at && existsSync(join(target, "maps"));

  // A failed read keeps the last good copy, and says why the latest try failed.
  const fail = (reason: string) => {
    if (!haveCopy) {
      rmSync(target, { recursive: true, force: true });
      return unreadable(reason);
    }
    const e: CacheEntry = { ...before!, host, repo: entry.repo, ref, state: "unreachable", reason, attempted_at: at };
    return { entry: e, host, report: { repo: entry.repo, host, state: "unreachable" as const, commit: e.commit, read_at: e.read_at, reason, kept: true, maps: e.maps.length } };
  };

  const url = entry.url ?? `https://${host}/${entry.repo}.git`;
  // Each read gets its own folder, so two repos (or a crash) never share a scratch copy.
  const work = join(scratch, `${entry.repo.replace(/\//g, "-")}-${randomBytes(4).toString("hex")}`);
  mkdirSync(work, { recursive: true });
  const got = fetchCopy(url, entry.ref, join(work, "read"), ["maps"]);
  if ("error" in got) return fail(got.error);

  const out = join(work, "out");
  mkdirSync(out, { recursive: true });
  const maps = mapsIn(join(work, "read"));
  keepFiles(join(work, "read"), out, maps);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  renameSync(out, target);

  const e: CacheEntry = { repo: entry.repo, host, ref, state: "ok", commit: got.commit, read_at: at, maps, attempted_at: at };
  return { entry: e, host, report: { repo: entry.repo, host, state: "ok", commit: got.commit, read_at: at, kept: false, maps: maps.length } };
}
