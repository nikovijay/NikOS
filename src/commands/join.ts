// `nikos join` and `nikos settings`: list this code repo in a planning repo's planning/repos.yaml, on a
// nikos/join branch for review, and see or change this repo's settings. Nothing in the repo moves.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { REPO_PATH } from "../lib/bets.js";
import { fetchCopy } from "../lib/fetch-copy.js";
import { asLine, hostNameOf, hostOf, requestArgv } from "../lib/forge.js";
import { baseBranch, commitPaths, gitIn, isGit, nextBranchName, ownRepo, pushBranch, remoteBranches, statusOf, switchNewBranch } from "../lib/git.js";
import { formatSettings, resolveSettings, resolveSettingsDetailed, setSetting } from "../lib/settings.js";
import { oldLayoutProblem } from "../plan/repo.js";
import { pullPlanSettings } from "../plan/settings-link.js";
import { addRepo, loadRepos, writeRepos, type RepoEntry } from "../plan/repos.js";
import { isPlanRepo, today } from "../planning/model.js";

/** The switches runJoin reads: a repo path may follow one of them. */
const SWITCHES = ["--push"];

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
  /** A nikos/join branch origin already has for this repo: it is proposed there, so nothing was written. */
  proposed?: string;
  /** The planning checkout the branch is in, when one was made. A temp clone stays until it is reviewed. */
  where?: string;
  pushed: boolean;
  /** The command that opens the review from the checkout, when this forge has one. */
  request?: string;
}

/**
 * Add this code repo to planning/repos.yaml of a planning repo, on a new nikos/join branch for review.
 * The planning repo is cloned to a temp folder, or planDir is used, and only that repo changes: this
 * code repo is never written to. Refuses a repo that can't be read, or that isn't a planning repo.
 */
export function joinPlanRepo(codeRoot: string, input: RepoJoinInput): RepoJoin {
  if (!REPO_PATH.test(input.plan)) throw new Error(`'${input.plan}' is not a repo path (owner/repo, or group/subgroup/project on GitLab)`);
  const tmp = input.planDir ? undefined : mkdtempSync(join(tmpdir(), "nikos-join-"));
  const copy = tmp ? join(tmp, "plan") : resolve(input.planDir!);
  let keep = false;
  try {
    if (tmp) {
      const url = input.url ?? `https://${input.host ?? "github.com"}/${input.plan}.git`;
      const got = fetchCopy(url, input.ref, copy, undefined, { keepGit: true });
      if ("error" in got) throw new Error(`Couldn't read ${input.plan}: ${got.error}. Nothing was written.`);
    } else if (!isGit(copy)) throw new Error(`${copy} isn't a git repo: --plan-dir needs the checkout of the planning repo`);

    const old = oldLayoutProblem(copy);
    if (old) throw new Error(old);
    if (!isPlanRepo(copy)) throw new Error(`${input.plan} isn't a planning repo (it has no planning/company/). Join a planning repo made with nikos plan init.`);
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

    // A join branch origin already has for this repo means it's proposed there: a second join adds nothing. A new
    // name avoids every branch origin has, not just the local ones (a fresh clone has none of the others).
    const prefix = `nikos/join-${code.replace(/\//g, "-")}-`;
    const taken = remoteBranches(copy);
    const proposed = taken.find((b) => new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\d{4}-\\d{2}-\\d{2}(-\\d+)?$`).test(b));
    if (proposed) return { plan: input.plan, repo: code, alreadyListed: false, proposed, pushed: false };
    const name = nextBranchName(copy, `${prefix}${today()}`, undefined, taken);
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
  if (r.proposed) return `${r.repo} is already proposed to ${r.plan} on branch ${r.proposed}, on its origin. Nothing was written.`;
  const lines = [`✓ Listed ${r.repo} in ${r.plan}'s planning/repos.yaml, on branch ${r.branch}.`, `The branch is in ${r.where}.`];
  if (r.pushed) lines.push(`Pushed ${r.branch} to ${r.plan}.`);
  else lines.push(`Not pushed. To send it for review: git -C ${r.where} push -u origin ${r.branch}`);
  if (r.request) lines.push(`Open the review from ${r.where}: ${r.request}`);
  else lines.push("Open the review in the forge's web interface.");
  lines.push("", "Nothing in this repo moved.");
  return lines.join("\n");
}

export function runJoin(args: string[]): number {
  const flag = (n: string) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  // --push is a switch, so the repo may come straight after it.
  const repo = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && !SWITCHES.includes(args[i - 1])));
  if (!repo) {
    console.error("✗ Which planning repo should this repo join? Give its repo path. For example: nikos join acme/company-plan\n\nUsage: nikos join <owner/repo | group/subgroup/project> [--push] [--host gitlab.com] [--url <git url>] [--ref <branch>] [--plan-dir <checkout>] [--dir <path>]");
    return 1;
  }
  const dir = flag("dir") ?? process.cwd();
  const host = flag("host");
  const url = flag("url");
  const ref = flag("ref");
  try {
    console.log(describeRepoJoin(joinPlanRepo(dir, { plan: repo, host, url, ref, planDir: flag("plan-dir"), push: args.includes("--push") })));
    return 0;
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
    if (sub === "pull" && key === undefined) {
      const { link, warnings } = pullPlanSettings(root);
      const owners = Object.keys(link.owners);
      console.log(`✓ Pulled the settings from ${link.plan.repo} at ${link.read.commit.slice(0, 7)}${owners.length ? ` for ${owners.join(", ")}` : ""}.`);
      for (const w of warnings) console.log(`! ${w}`);
      return 0;
    }
    console.error("Usage: nikos settings [show] | nikos settings set <key> <value> | nikos settings pull [--dir <path>]");
    return 1;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
