// `nikos join` and `nikos settings`: link this repo to the plan above it, and see or change the
// settings it inherits. Joining is one line in planning/upstream.yaml plus a sync; nothing in
// the repo moves, so a repo that started on its own keeps everything it has.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse, parseDocument, stringify } from "yaml";
import { REPO_PATH } from "../lib/bets.js";
import { fetchCopy } from "../lib/fetch-copy.js";
import { asLine, hostNameOf, hostOf, requestArgv } from "../lib/forge.js";
import { baseBranch, commitPaths, gitIn, isGit, nextBranchName, ownRepo, pushBranch, statusOf, switchNewBranch } from "../lib/git.js";
import { formatSettings, resolveSettings, resolveSettingsDetailed, setSetting, type Resolved } from "../lib/settings.js";
import { store } from "../lib/store.js";
import { keyClash } from "../lib/keys.js";
import { addRepo, loadRepos, writeRepos, type RepoEntry } from "../plan/repos.js";
import { isPlanRepo, paths, today } from "../planning/model.js";
import { readLock, sync, upstreamEntries, type SyncReport } from "../planning/upstream.js";

/** The switches runJoin reads: a repo path may follow one of them. */
const SWITCHES = ["--home", "--push"];

export interface JoinResult {
  repo: string;
  added: boolean;
  /** Whether the plan could be fetched. When it couldn't, it stays listed, for a later sync. */
  fetched: boolean;
  sync: SyncReport;
  settings: Resolved;
}

/** The plan a group is homed in, or the one it'd need to be: the entry marked home: true in its planning/upstream.yaml. */
function homeIn(path: string): string | undefined {
  if (!store().exists(path)) return undefined;
  const list = parseDocument(store().read(path)).toJSON();
  const home = Array.isArray(list) ? list.find((e: any) => e?.home === true) : undefined;
  return typeof home?.repo === "string" ? home.repo : undefined;
}

/**
 * Add an upstream plan to planning/upstream.yaml (if it isn't there), sync, and resolve the settings.
 * home: this plan is the repo's home, marked in planning/upstream.yaml.
 */
export function joinPlan(root: string, input: { repo: string; host?: string; url?: string; ref?: string; home?: boolean }): JoinResult {
  if (!REPO_PATH.test(input.repo)) throw new Error(`'${input.repo}' is not a repo path (owner/repo, or group/subgroup/project on GitLab)`);
  const path = join(root, "planning", "upstream.yaml");
  if (input.home) {
    const other = homeIn(path);
    if (other && other !== input.repo) throw new Error(`${other} is already this plan's home: a group has one home`);
  }
  const before = store().exists(path) ? store().read(path) : undefined;
  const added = !upstreamEntries(root).some((e) => e.repo === input.repo);
  if (added) {
    const doc = parseDocument(before ?? "# Plans in other repos this one works toward. nikos planning sync reads them.\n[]\n");
    const entry = { repo: input.repo, ...(input.ref ? { ref: input.ref } : {}), ...(input.host ? { host: input.host } : {}), ...(input.url ? { url: input.url } : {}) };
    if (!doc.contents || !("items" in (doc.contents as any))) doc.contents = doc.createNode([]) as any;
    (doc.contents as any).flow = false;
    (doc.contents as any).items.push(doc.createNode(entry));
    store().write(path, doc.toString({ lineWidth: 0 }));
    try {
      upstreamEntries(root); // a bad host or url fails here, before anything is fetched
    } catch (err) {
      store().write(path, before ?? "[]\n");
      throw err;
    }
  }
  // The home is marked on the plan's entry in planning/upstream.yaml.
  if (input.home) {
    const doc = parseDocument(store().read(path));
    const item = (doc.contents as any).items.find((it: any) => it?.toJSON?.()?.repo === input.repo);
    if (item) item.set("home", true);
    store().write(path, doc.toString({ lineWidth: 0 }));
  }
  const copy = join(paths(root).cache, ...input.repo.split("/"));
  const undo = () => {
    if (before === undefined) store().remove(path);
    else store().write(path, before);
    // A plan this call didn't add keeps its copy and its lock: only what this call made is taken back.
    if (!added) return;
    rmSync(copy, { recursive: true, force: true });
    const lock = readLock(root).filter((l) => l.repo !== input.repo);
    store().write(paths(root).lock, `# Written by nikos planning sync: the commit each plan's copy was read at.\n${stringify(lock)}`);
  };
  const report = sync(root);
  const fetched = !report.unresolved.some((u) => u.repo === input.repo);
  // Its key must be its own across the chain: this repo's, and the copies already here (amendment D5).
  const fetchedKey = fetched && store().exists(join(copy, "planning", "plan.yaml")) ? parse(store().read(join(copy, "planning", "plan.yaml")))?.key : undefined;
  const copies = [paths(root).cache];
  const clash = typeof fetchedKey === "string" ? keyClash(root, input.repo, fetchedKey, copies) : undefined;
  if (clash) {
    undo();
    throw new Error(clash);
  }
  return { repo: input.repo, added, fetched, sync: report, settings: resolveSettings(root) };
}

export interface RepoJoinInput {
  /** The planning repo's path on its host: owner/repo, or group/subgroup/project on GitLab. */
  plan: string;
  host?: string;
  url?: string;
  ref?: string;
  /** A checkout of the planning repo already on this computer, used instead of a fresh clone. */
  planDir?: string;
  /** Push the branch to the planning repo's origin. Off by default: nothing leaves this computer without it. */
  push?: boolean;
}

export interface RepoJoin {
  plan: string;
  /** This code repo's path, as planning/repos.yaml lists it. */
  repo: string;
  alreadyListed: boolean;
  /** The nikos/join branch the entry is on, when one was made. */
  branch?: string;
  /** The planning checkout the branch is in, when one was made. A temp clone stays until it is reviewed. */
  where?: string;
  pushed: boolean;
  /** The command that opens the review from the checkout, when this forge has one. */
  request?: string;
}

/**
 * Add this code repo to planning/repos.yaml of a new-layout planning repo, on a new nikos/join branch
 * for review. The planning repo is cloned to a temp folder, or planDir is used, and only that repo
 * changes: this code repo is never written to. Returns undefined when the plan is the old kind
 * (planning/plan.yaml), which the caller joins with joinPlan.
 */
export function joinPlanRepo(codeRoot: string, input: RepoJoinInput): RepoJoin | undefined {
  if (!REPO_PATH.test(input.plan)) throw new Error(`'${input.plan}' is not a repo path (owner/repo, or group/subgroup/project on GitLab)`);
  const tmp = input.planDir ? undefined : mkdtempSync(join(tmpdir(), "nikos-join-"));
  const copy = tmp ? join(tmp, "plan") : resolve(input.planDir!);
  let keep = false;
  try {
    if (tmp) {
      const url = input.url ?? `https://${input.host ?? "github.com"}/${input.plan}.git`;
      const got = fetchCopy(url, input.ref, copy, undefined, { keepGit: true });
      // The plan's layout is unknown until it is read. Unreachable, it joins the old way, as it always has.
      // A push was asked for, though, and that needs the branch, so it is refused.
      if ("error" in got) {
        if (input.push) throw new Error(`Couldn't read ${input.plan}: ${got.error}. Nothing was written.`);
        return undefined;
      }
    } else if (!isGit(copy)) throw new Error(`${copy} isn't a git repo: --plan-dir needs the checkout of the planning repo`);

    if (!isPlanRepo(copy)) {
      if (input.push || input.planDir) throw new Error(`${input.plan} is the old kind of plan (planning/plan.yaml), which joins without a branch. --plan-dir and --push need a planning repo with planning/company/`);
      return undefined;
    }
    const dirty = statusOf(copy, ["planning"]);
    if (dirty.length) throw new Error(`${copy} has changes in planning/ that aren't committed. Commit or stash them, then join again.`);

    // Only a new-layout plan needs this repo's path, so the origin is checked here, after the layout is known.
    const origin0 = gitIn(codeRoot, ["remote", "get-url", "origin"]).stdout.trim();
    if (!origin0) throw new Error("This repo has no origin, so there's no repo path to list it under. Set one with: git remote add origin <url>");
    const code = ownRepo(codeRoot);
    if (!code) throw new Error("This repo's origin is a local path, so there's no repo path to list it under. Set one with: git remote add origin <url>");
    // A token in the origin's url stays out of the file that gets committed: only the host and the path are kept.
    const origin = origin0.replace(/^(https?:\/\/)[^/@]+@/i, "$1");

    // The entry names this repo by its path. The url is written only when origin isn't the plain https one for it.
    const host = hostNameOf(origin);
    const plain = `https://${host ?? "github.com"}/${code}`;
    const normal = origin === `${plain}.git` || origin === plain;
    const entry: RepoEntry = { repo: code, ...(host && host !== "github.com" ? { host } : {}), ...(normal ? {} : { url: origin }) };
    const before = loadRepos(copy);
    const next = addRepo(before, entry);
    if (!next.added) return { plan: input.plan, repo: code, alreadyListed: true, pushed: false };

    const name = nextBranchName(copy, `nikos/join-${code.replace(/\//g, "-")}-${today()}`);
    const made = switchNewBranch(copy, name);
    if (!made.ok) throw new Error(`Couldn't create a branch in ${copy}: ${made.error}`);
    // The branch exists now, so the clone stays for review, even if the commit below fails.
    keep = true;
    writeRepos(copy, next.doc);
    const committed = commitPaths(copy, ["planning/repos.yaml"], `nikos: list ${code} in planning/repos.yaml`);
    if (!committed.ok) throw new Error(`${name} is in ${copy}, but the commit didn't finish: ${committed.error}`);
    if (input.push) {
      const pushed = pushBranch(copy, name);
      if (!pushed.ok) throw new Error(`${name} is committed in ${copy}, but the push didn't finish: ${pushed.error}`);
    }
    const base = baseBranch(copy) ?? "main";
    const planOrigin = gitIn(copy, ["remote", "get-url", "origin"]).stdout.trim();
    const argv = requestArgv(hostOf(planOrigin), base, name);
    return { plan: input.plan, repo: code, alreadyListed: false, branch: name, where: copy, pushed: !!input.push, request: asLine(argv) };
  } finally {
    if (tmp && !keep) rmSync(tmp, { recursive: true, force: true });
  }
}

/** What joining a planning repo did, in words. */
export function describeRepoJoin(r: RepoJoin): string {
  if (r.alreadyListed) return `${r.repo} is already listed in ${r.plan}'s planning/repos.yaml. Nothing was written.`;
  const lines = [`✓ Listed ${r.repo} in ${r.plan}'s planning/repos.yaml, on branch ${r.branch}.`, `The branch is in ${r.where}.`];
  if (r.pushed) lines.push(`Pushed ${r.branch} to ${r.plan}.`);
  else lines.push(`Not pushed. To send it for review: git -C ${r.where} push -u origin ${r.branch}`);
  if (r.request) lines.push(`Open the review from ${r.where}: ${r.request}`);
  else lines.push("Open the review in the forge's web interface.");
  lines.push("", "Nothing in this repo moved.");
  return lines.join("\n");
}

/** What joining did, in words: for the command line and the MCP tool alike. */
export function describeJoin(r: JoinResult): string {
  const why = r.sync.unresolved.find((u) => u.repo === r.repo)?.reason;
  if (!r.fetched) {
    return [
      `✗ Couldn't fetch ${r.repo}: ${why}`,
      `  It's ${r.added ? "now" : "still"} listed in planning/upstream.yaml, but nothing comes from it until it can be fetched.`,
      "  Check the repo path is right and that you can clone it. Then run: nikos planning sync",
      "  To stop following it, delete its entry from planning/upstream.yaml.",
    ].join("\n");
  }
  const lines = [r.added ? `✓ Joined ${r.repo}. It's listed in planning/upstream.yaml.` : `This repo already follows ${r.repo}.`];
  lines.push("Fetched a read-only copy of:");
  for (const s of r.sync.synced) lines.push(`  ✓ ${s.repo} at ${s.commit.slice(0, 7)}${s.via ? ` (the plan above ${s.via})` : ""}`);
  for (const u of r.sync.unresolved) lines.push(`  ? ${u.repo}: ${u.reason}`);
  lines.push("", "The settings that now apply here:", formatSettings(r.settings), "", "Nothing in this repo moved.");
  return lines.join("\n");
}

export function runJoin(args: string[]): number {
  const flag = (n: string) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  // --home and --push are switches, so the repo may come straight after them.
  const repo = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && !SWITCHES.includes(args[i - 1])));
  if (!repo) {
    console.error("✗ Which plan should this repo join? Give its repo path. For example: nikos join acme/company-plan\n\nUsage: nikos join <owner/repo | group/subgroup/project> [--home] [--push] [--host gitlab.com] [--url <git url>] [--ref <branch>] [--plan-dir <checkout>] [--dir <path>]");
    return 1;
  }
  const dir = flag("dir") ?? process.cwd();
  const host = flag("host");
  const url = flag("url");
  const ref = flag("ref");
  try {
    // A planning repo with planning/repos.yaml gets a branch for review. Any other plan joins the old way.
    const listed = joinPlanRepo(dir, { plan: repo, host, url, ref, planDir: flag("plan-dir"), push: args.includes("--push") });
    if (listed) {
      console.log(describeRepoJoin(listed));
      return 0;
    }
    const r = joinPlan(dir, { repo, host, url, ref, home: args.includes("--home") });
    (r.fetched ? console.log : console.error)(describeJoin(r));
    return r.fetched ? 0 : 1;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}

/** Read a value given on the command line: JSON when it parses (true, ["app","chat"]), else text; a, b, c is a list. */
const valueOf = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw.includes(",") ? raw.split(",").map((s) => s.trim()).filter(Boolean) : raw;
  }
};

export function runSettings(args: string[]): number {
  const i = args.indexOf("--dir");
  const root = i >= 0 ? args[i + 1] : process.cwd();
  const [sub = "show", key, raw] = args.filter((a, n) => a !== "--dir" && (i < 0 || n !== i + 1));
  try {
    if (sub === "show") {
      const r = resolveSettingsDetailed(root);
      console.log(formatSettings(r.resolved));
      for (const p of r.problems) console.log(`! ${p}`);
      return 0;
    }
    if (sub === "set" && key && raw !== undefined) {
      setSetting(root, key, valueOf(raw));
      console.log(`${key}: ${JSON.stringify(resolveSettings(root)[key].value)}  (this repo)`);
      return 0;
    }
    console.error("Usage: nikos settings [show] | nikos settings set <key> <value> [--dir <path>]");
    return 1;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
