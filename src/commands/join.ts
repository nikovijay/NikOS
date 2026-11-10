// `nikos join` and `nikos settings`: link this code repo to a planning repo. The plan lists this repo in
// planning/repos.yaml on a nikos/join branch for review, and this repo commits nikos.plan.yaml (the settings
// its maps take from the plan) on a nikos/link branch. main is never touched, and nothing is pushed without --push.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { REPO_PATH } from "../lib/bets.js";
import { fetchCopy } from "../lib/fetch-copy.js";
import { asLine, hostNameOf, hostOf, requestArgv } from "../lib/forge.js";
import { baseBranch, branchExists, commitPaths, currentBranch, gitIn, headOf, isGit, nextBranchName, ownRepo, pushBranch, remoteBranches, statusOf, switchNewBranch } from "../lib/git.js";
import { formatSettings, resolveSettings, resolveSettingsDetailed, setSetting } from "../lib/settings.js";
import { oldLayoutProblem } from "../plan/repo.js";
import { LINK_FILE, linkFromCopy, mapOwners, parseLink, pullPlanSettings, readLink, snapshotHash, writeLink, type PlanLink, type PlanRef, type PullResult } from "../plan/settings-link.js";
import { addRepo, loadRepos, writeRepos, type RepoEntry } from "../plan/repos.js";
import { isPlanRepo, today } from "../planning/model.js";

/** The switches runJoin reads: a repo path may follow one of them. */
const SWITCHES = ["--push"];

/** The branch this repo's link is committed on. The planning repo's listing is on a nikos/join branch, the same way. */
const LINK_BRANCH = "nikos/link";

export interface RepoJoinInput {
  /** The planning repo's path on its host: owner/repo, or group/subgroup/project on GitLab. */
  plan: string;
  host?: string;
  url?: string;
  ref?: string;
  /** A checkout of the planning repo already on this computer, used instead of a fresh clone. */
  planDir?: string;
  /** Push both branches (the planning repo's and this repo's) to their origins. Off by default: nothing leaves this computer without it. */
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
  /** This code repo's link to the plan: the branch it is on, and whether this join committed it. */
  link?: { branch: string; written: boolean; pushed: boolean; from?: string; stale?: boolean };
  /** Things to know about the snapshot: an owner with no team in the plan. */
  warnings?: string[];
}

/** The link this code repo already has: in its checkout, or committed on its nikos/link branch. */
function heldLink(root: string): { link: PlanLink; branch?: string } | undefined {
  const here = readLink(root);
  if (here) return { link: here, branch: currentBranch(root) };
  if (!branchExists(root, LINK_BRANCH)) return undefined;
  const shown = gitIn(root, ["show", `${LINK_BRANCH}:${LINK_FILE}`]);
  return shown.status === 0 ? { link: parseLink(shown.stdout), branch: LINK_BRANCH } : undefined;
}

/** A url with its user name and password taken out, as it is kept in a file that gets committed. */
const withoutPassword = (url: string) => url.replace(/^(https?:\/\/)[^/@]+@/i, "$1");

/** Whether a link's planning repo is the one asked for: same path, and same host (github.com when none is given). */
const samePlan = (held: PlanRef, input: RepoJoinInput) => held.repo === input.plan && (held.host ?? "github.com") === (input.host ?? "github.com");

/**
 * Link this code repo to a planning repo. Two branches are made, and nothing else changes:
 * the planning repo lists this repo in planning/repos.yaml on a nikos/join branch, for review; and this
 * repo commits nikos.plan.yaml, its settings from the plan, on a nikos/link branch. The planning repo is
 * cloned to a temp folder, or planDir is used. This repo must have no uncommitted changes, and its branch
 * is never switched under them. main is never touched. A repo already linked to this plan writes nothing
 * new; one linked to another plan is refused. Refuses a repo that can't be read, or that isn't a planning repo.
 */
export function joinPlanRepo(codeRoot: string, input: RepoJoinInput): RepoJoin {
  if (!REPO_PATH.test(input.plan)) throw new Error(`'${input.plan}' is not a repo path (owner/repo, or group/subgroup/project on GitLab)`);
  // One code repo takes its settings from one planning repo, so a link to another plan is refused before anything is read.
  const held = heldLink(codeRoot);
  if (held && !samePlan(held.link.plan, input)) throw new Error(`This repo is already linked to ${held.link.plan.repo}, so it can't join ${input.plan} too. One repo takes its settings from one planning repo. Nothing was written.`);
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
    const origin = withoutPassword(origin0);

    // This repo's own changes stay where they are: a first join switches to its link branch, so it must be clean.
    if (!held) {
      const mine = statusOf(codeRoot, undefined);
      if (mine.length) throw new Error("This repo has changes that aren't committed. Commit or stash them, then join again. Nothing was written.");
    }

    // The settings snapshot, read from this copy at the commit it is on. A settings file that doesn't read stops
    // the join here, before anything is written. A repo already linked only compares, so a failure there is left for pull.
    const planRemote = withoutPassword(gitIn(copy, ["remote", "get-url", "origin"]).stdout.trim());
    const plainUrl = `https://${input.host ?? "github.com"}/${input.plan}.git`;
    const isPlainUrl = planRemote === plainUrl || planRemote === plainUrl.slice(0, -4);
    const plan: PlanRef = { repo: input.plan, ...(input.host && input.host !== "github.com" ? { host: input.host } : {}), ...(planRemote && !isPlainUrl ? { url: planRemote } : {}) };
    const head = headOf(copy);
    if (!head) throw new Error(`${copy} has no commit yet, so there's nothing to link to. Nothing was written.`);
    let built: PullResult | undefined;
    try {
      built = linkFromCopy(copy, plan, { commit: head, at: new Date().toISOString(), ...(input.ref ? { ref: input.ref } : {}) }, mapOwners(codeRoot));
    } catch (err) {
      if (!held) throw new Error(`${(err as Error).message}. Nothing was written.`);
    }
    const stale = held && built ? snapshotHash(built.link) !== snapshotHash(held.link) : undefined;

    // The planning repo: this repo listed in planning/repos.yaml, on a new join branch. Nothing there when it's listed or proposed.
    // A join branch origin already has for this repo means it's proposed there: a second join adds nothing. A new
    // name avoids every branch origin has, not just the local ones (a fresh clone has none of the others).
    // The entry names this repo by its path. The url is written only when origin isn't the plain https one for it.
    const host = hostNameOf(origin);
    const plain = `https://${host ?? "github.com"}/${code}`;
    const normal = origin === `${plain}.git` || origin === plain;
    const entry: RepoEntry = { repo: code, ...(host && host !== "github.com" ? { host } : {}), ...(normal ? {} : { url: origin }) };
    const next = addRepo(loadRepos(copy), entry);
    const listed = !next.added;
    let branch: string | undefined;
    let proposed: string | undefined;
    let planPushed = false;
    if (!listed) {
      const prefix = `nikos/join-${code.replace(/\//g, "-")}-`;
      const taken = remoteBranches(copy);
      proposed = taken.find((b) => new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\d{4}-\\d{2}-\\d{2}(-\\d+)?$`).test(b));
      if (!proposed) {
        const name = nextBranchName(copy, `${prefix}${today()}`, undefined, taken);
        const made = switchNewBranch(copy, name);
        if (!made.ok) throw new Error(`Couldn't create a branch in ${copy}: ${made.error}`);
        // The branch exists now, so the clone stays for review, even if the commit below fails.
        keep = true;
        writeRepos(copy, next.doc);
        const committed = commitPaths(copy, ["planning/repos.yaml"], `nikos: list ${code} in planning/repos.yaml`);
        if (!committed.ok) throw new Error(`${name} is in ${copy}, but the commit didn't finish: ${committed.error}`);
        branch = name;
      }
    }

    // This repo: nikos.plan.yaml committed on a new link branch, unless this repo is already linked (nothing new is written).
    let link: NonNullable<RepoJoin["link"]>;
    if (held) link = { branch: held.branch ?? "HEAD", written: false, pushed: false, stale };
    else {
      const from = currentBranch(codeRoot);
      const name = nextBranchName(codeRoot, LINK_BRANCH);
      const made = switchNewBranch(codeRoot, name);
      if (!made.ok) throw new Error(`Couldn't create ${name} in this repo: ${made.error}.${branch ? ` The planning repo's branch is in ${copy}.` : ""}`);
      writeLink(codeRoot, built!.link);
      const committed = commitPaths(codeRoot, [LINK_FILE], `nikos: link this repo to ${input.plan} (${LINK_FILE})`);
      if (!committed.ok) throw new Error(`${name} is in this repo, but the commit didn't finish: ${committed.error}`);
      link = { branch: name, written: true, pushed: false, from };
    }

    if (input.push) {
      if (branch) {
        const pushed = pushBranch(copy, branch);
        if (!pushed.ok) throw new Error(`${branch} is committed in ${copy}, but the push didn't finish: ${pushed.error}`);
        planPushed = true;
      }
      if (link.written) {
        const pushed = pushBranch(codeRoot, link.branch);
        if (!pushed.ok) throw new Error(`${link.branch} is committed in this repo, but the push didn't finish: ${pushed.error}`);
        link.pushed = true;
      }
    }

    let request: string | undefined;
    if (branch) {
      const base = baseBranch(copy) ?? "main";
      request = asLine(requestArgv(hostOf(planRemote), base, branch));
    }
    const warnings = built?.warnings.length ? built.warnings : undefined;
    return {
      plan: input.plan,
      repo: code,
      alreadyListed: listed,
      pushed: planPushed,
      link,
      ...(proposed ? { proposed } : {}),
      ...(branch ? { branch, where: copy, request } : {}),
      ...(warnings ? { warnings } : {}),
    };
  } finally {
    if (tmp && !keep) rmSync(tmp, { recursive: true, force: true });
  }
}

/** What joining a planning repo did, in words. */
export function describeRepoJoin(r: RepoJoin): string {
  const lines: string[] = [];
  if (r.alreadyListed) lines.push(`${r.repo} is already listed in ${r.plan}'s planning/repos.yaml.`);
  else if (r.proposed) lines.push(`${r.repo} is already proposed to ${r.plan} on branch ${r.proposed}, on its origin.`);
  else if (r.branch) {
    lines.push(`✓ Listed ${r.repo} in ${r.plan}'s planning/repos.yaml, on branch ${r.branch}.`, `The branch is in ${r.where}.`);
    if (r.pushed) lines.push(`Pushed ${r.branch} to ${r.plan}.`);
    else lines.push(`Not pushed. To send it for review: git -C ${r.where} push -u origin ${r.branch}`);
    if (r.request) lines.push(`Open the review from ${r.where}: ${r.request}`);
    else lines.push("Open the review in the forge's web interface.");
  }
  const link = r.link;
  if (link?.written) {
    lines.push(`✓ Linked this repo to ${r.plan}: ${LINK_FILE} is committed on branch ${link.branch}, with the settings its maps take from the plan.`);
    lines.push(link.pushed ? `Pushed ${link.branch} to this repo's origin.` : `Not pushed. To send it: git push -u origin ${link.branch}`);
    lines.push(link.from ? `This repo is now on ${link.branch}. To go back: git switch ${link.from}` : `This repo is now on ${link.branch}.`);
  } else if (link) {
    lines.push(`This repo is already linked to ${r.plan} (${LINK_FILE} on ${link.branch}).`);
    if (link.stale) lines.push(`The plan's settings have changed since. Run nikos settings pull to refresh ${LINK_FILE}, then commit it.`);
  }
  for (const w of r.warnings ?? []) lines.push(`! ${w}`);
  if (!r.branch && !link?.written) lines.push("Nothing was written.");
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
