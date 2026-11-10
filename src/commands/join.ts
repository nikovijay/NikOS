// `nikos join` and `nikos settings`: link this code repo to a planning repo. The plan lists this repo in
// planning/repos.yaml on a nikos/join branch for review, and this repo commits nikos.plan.yaml (the settings its
// maps take from the plan) on a nikos/link branch made from main. main is never touched, and nothing is pushed without --push.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { REPO_PATH } from "../lib/bets.js";
import { fetchCopy } from "../lib/fetch-copy.js";
import { asLine, hostNameOf, hostOf, requestArgv } from "../lib/forge.js";
import { baseBranch, branchExists, commitPaths, currentBranch, firstLine, gitIn, headOf, isGit, nextBranchName, ownRepo, pushBranch, remoteBranches, statusOf, switchNewBranchFrom } from "../lib/git.js";
import { resolveStoryMap } from "../lib/maps.js";
import { formatSettings, resolveSettings, resolveSettingsDetailed, setSetting } from "../lib/settings.js";
import { oldLayoutProblem } from "../plan/repo.js";
import { LINK_BRANCH, LINK_FILE, linkFromCopy, linkOnBranch, mapBindings, parseLink, pullPlanSettings, readLink, snapshotHash, writeLink, type PlanLink, type PlanRef, type PullResult } from "../plan/settings-link.js";
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

/** A link this code repo holds, and the branch it is on: in its checkout, committed on nikos/link, or on its origin. */
interface Held {
  link: PlanLink;
  branch: string;
}

/**
 * The link in this repo's checkout, or committed on nikos/link. A link written here but not committed stops the join:
 * the commit is what CI and other branches see, so the commit comes first.
 */
function heldLink(root: string): Held | undefined {
  const here = readLink(root);
  if (here) {
    const branch = currentBranch(root) ?? "HEAD";
    if (gitIn(root, ["show", `HEAD:${LINK_FILE}`]).status !== 0)
      throw new Error(`${LINK_FILE} is written in this repo on ${branch}, but it isn't committed. Commit it (git add ${LINK_FILE}, then git commit -m "nikos: link this repo to ${here.plan.repo} (${LINK_FILE})"), then join again.`);
    return { link: here, branch };
  }
  const there = linkOnBranch(root);
  return there ? { link: there, branch: LINK_BRANCH } : undefined;
}

/** The link origin already has on nikos/link for this repo, fetched and read. Nothing is written for it here. */
function heldOnOrigin(root: string, remote: string[]): Held | undefined {
  if (!remote.includes(LINK_BRANCH)) return undefined;
  const fetched = gitIn(root, ["fetch", "-q", "origin", LINK_BRANCH]);
  if (fetched.status !== 0) throw new Error(`origin already has ${LINK_BRANCH} for this repo, and it couldn't be fetched: ${firstLine(fetched.stderr) || "git fetch failed"}. Nothing was written.`);
  const shown = gitIn(root, ["show", `FETCH_HEAD:${LINK_FILE}`]);
  return shown.status === 0 ? { link: parseLink(shown.stdout), branch: `origin/${LINK_BRANCH}` } : undefined;
}

/** The branches origin has. When origin can't be listed, only this computer's branches are checked. */
function originBranches(root: string): string[] {
  try {
    return remoteBranches(root);
  } catch {
    return [];
  }
}

/** A url with its user name and password taken out, as it is kept in a file that gets committed. */
const withoutPassword = (url: string) => url.replace(/^(https?:\/\/)[^/@]+@/i, "$1");

/** Whether a link's planning repo is the one asked for: same path, and same host (github.com when none is given). */
const samePlan = (held: PlanRef, input: RepoJoinInput) => held.repo === input.plan && (held.host ?? "github.com") === (input.host ?? "github.com");

/**
 * Link this code repo to a planning repo. Two branches are made, and nothing else changes:
 * the planning repo lists this repo in planning/repos.yaml on a nikos/join branch, for review; and this
 * repo commits nikos.plan.yaml, its settings from the plan, on a nikos/link branch made from main. The planning repo
 * is cloned to a temp folder, or planDir is used (and must be on its default branch, or on --ref). This repo must
 * have no uncommitted changes, and its branch is never switched under them. main is never touched. A repo already
 * linked to this plan writes nothing new; one linked to another plan is refused. Refuses a repo that can't be read, or that isn't a planning repo.
 */
export function joinPlanRepo(codeRoot: string, input: RepoJoinInput): RepoJoin {
  if (!REPO_PATH.test(input.plan)) throw new Error(`'${input.plan}' is not a repo path (owner/repo, or group/subgroup/project on GitLab)`);
  // One code repo takes its settings from one planning repo, so a link to another plan is refused before anything is read.
  const local = heldLink(codeRoot);
  const remote = local ? [] : originBranches(codeRoot);
  const held = local ?? heldOnOrigin(codeRoot, remote);
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
    // A checkout is read at the branch the join means: its default branch, or --ref. It may also be on the nikos/join
    // branch an earlier join made, when that branch changes nothing in planning/ but planning/repos.yaml. Anything else
    // would read the plan's settings from work that isn't on the default branch, so it's refused.
    let readAt: string | undefined;
    if (!tmp) {
      const want = input.ref ?? baseBranch(copy) ?? "main";
      const on = currentBranch(copy);
      const listingOnly = !!on && branchExists(copy, want) && gitIn(copy, ["diff", "--name-only", want, "HEAD", "--", "planning"]).stdout.split("\n").filter(Boolean).every((f) => f === "planning/repos.yaml");
      if (on !== want && !listingOnly) throw new Error(`${copy} is on ${on ?? "no branch"}, and its planning/ settings differ from ${want} there. Check out ${want} in that checkout, then join again. Nothing was written.`);
      readAt = want;
    }
    const dirty = statusOf(copy, ["planning"]);
    if (dirty.length) throw new Error(`${copy} has changes in planning/ that aren't committed. Commit or stash them, then join again.`);

    // Only a new-layout plan needs this repo's path, so the origin is checked here, after the layout is known.
    const origin0 = gitIn(codeRoot, ["remote", "get-url", "origin"]).stdout.trim();
    if (!origin0) throw new Error("This repo has no origin, so there's no repo path to list it under. Set one with: git remote add origin <url>");
    const code = ownRepo(codeRoot);
    if (!code) throw new Error("This repo's origin is a local path, so there's no repo path to list it under. Set one with: git remote add origin <url>");
    // A token in the origin's url stays out of the file that gets committed: only the host and the path are kept.
    const origin = withoutPassword(origin0);

    // This repo's own changes stay where they are, and its link is made from main, so a feature branch's commits stay out of it.
    // A first join switches to the new link branch, so it must be clean and have a local main.
    let base: string | undefined;
    if (!held) {
      const mine = statusOf(codeRoot, undefined);
      if (mine.length) throw new Error("This repo has changes that aren't committed. Commit or stash them, then join again. Nothing was written.");
      base = baseBranch(codeRoot);
      if (!base || !branchExists(codeRoot, base)) throw new Error("This repo has no local main branch to make the link from. Check out main, then join again. Nothing was written.");
    }

    // The settings snapshot, read from this copy at the commit it is on. A settings file that doesn't read stops
    // the join here, before anything is written. A repo already linked only compares, so a failure there is left for pull.
    const planRemote = withoutPassword(gitIn(copy, ["remote", "get-url", "origin"]).stdout.trim());
    const plainUrl = `https://${input.host ?? "github.com"}/${input.plan}.git`;
    const isPlainUrl = planRemote === plainUrl || planRemote === plainUrl.slice(0, -4);
    const plan: PlanRef = { repo: input.plan, ...(input.host && input.host !== "github.com" ? { host: input.host } : {}), ...(planRemote && !isPlainUrl ? { url: planRemote } : {}) };
    // The snapshot is read at the commit of the branch it was read from, so a checkout on a nikos/join branch records main's commit.
    const head = readAt ? gitIn(copy, ["rev-parse", "--verify", "-q", `${readAt}^{commit}`]).stdout.trim() : headOf(copy);
    if (!head) throw new Error(`${copy} has no commit yet, so there's nothing to link to. Nothing was written.`);
    let built: PullResult | undefined;
    try {
      built = linkFromCopy(copy, plan, { commit: head, at: new Date().toISOString(), ...(input.ref ? { ref: input.ref } : {}) }, mapBindings(codeRoot));
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
        const made = switchNewBranchFrom(copy, name, readAt ?? "HEAD");
        if (!made.ok) throw new Error(`Couldn't create a branch in ${copy}: ${made.error}`);
        // The branch exists now, so the clone stays for review, even if the commit below fails.
        keep = true;
        writeRepos(copy, next.doc);
        const committed = commitPaths(copy, ["planning/repos.yaml"], `nikos: list ${code} in planning/repos.yaml`);
        if (!committed.ok) throw new Error(`${name} is in ${copy}, but the commit didn't finish: ${committed.error}`);
        branch = name;
      }
    }

    // This repo: nikos.plan.yaml committed on a new link branch made from main, unless this repo is already linked (nothing new is written).
    let link: NonNullable<RepoJoin["link"]>;
    if (held) link = { branch: held.branch, written: false, pushed: false, stale };
    else {
      const from = currentBranch(codeRoot);
      const name = nextBranchName(codeRoot, LINK_BRANCH, undefined, remote);
      const made = switchNewBranchFrom(codeRoot, name, base!);
      if (!made.ok) throw new Error(`Couldn't create ${name} in this repo: ${made.error}.${branch ? ` The planning repo's branch is in ${copy}.` : ""}`);
      writeLink(codeRoot, built!.link);
      const committed = commitPaths(codeRoot, [LINK_FILE], `nikos: link this repo to ${input.plan} (${LINK_FILE})`);
      if (!committed.ok) throw new Error(`${name} is in this repo, but the commit didn't finish: ${committed.error}. ${LINK_FILE} is written but not committed: commit it, then join again.`);
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
      const planBase = baseBranch(copy) ?? "main";
      request = asLine(requestArgv(hostOf(planRemote), planBase, branch));
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
    lines.push(`main takes the plan's settings only once ${link.branch} is merged to it. Until then, CI on main enforces none of them.`);
  } else if (link?.branch.startsWith("origin/")) {
    lines.push(`This repo is already linked to ${r.plan} (${LINK_FILE} on ${link.branch}). To use that link here: git switch -c ${LINK_BRANCH} ${link.branch}`);
    if (link.stale) lines.push(`The plan's settings have changed since. Run nikos settings pull to refresh ${LINK_FILE}, then commit it.`);
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

/** The switches that take a value, which the positional words of nikos settings don't include. */
const VALUE_FLAGS = ["--dir", "--map"];

export function runSettings(args: string[]): number {
  const i = args.indexOf("--dir");
  const root = i >= 0 ? args[i + 1] : process.cwd();
  const m = args.indexOf("--map");
  const mapId = m >= 0 ? args[m + 1] : undefined;
  const [sub = "show", key, raw] = args.filter((a, n) => !VALUE_FLAGS.includes(a) && !VALUE_FLAGS.includes(args[n - 1]));
  try {
    if (sub === "show") {
      // --map shows the settings one story map takes, which can differ between a repo's maps.
      const dir = mapId !== undefined ? resolveStoryMap(root, { map: mapId }).dir : undefined;
      const r = resolveSettingsDetailed(root, dir ? { map: dir } : {});
      if (dir) console.log(`map: ${basename(dir)}`);
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
      console.log(`Commit ${LINK_FILE} so CI and the other branches see the refresh.`);
      for (const w of warnings) console.log(`! ${w}`);
      return 0;
    }
    console.error("Usage: nikos settings [show [--map <id>]] | nikos settings set <key> <value> | nikos settings pull [--dir <path>]");
    return 1;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
