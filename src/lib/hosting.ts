// Where a new repo lives: on GitHub or GitLab, made with gh or glab, or only on this computer. nikOS
// makes the hosted repo only when the person chose one, sets it as origin, and never pushes: the
// person pushes when they're ready.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_PATH } from "./bets.js";
import { realRun, type Runner } from "./git.js";
import { toolFor, type Host } from "./forge.js";

export interface Hosting {
  forge: Host;
  /** owner/name on GitHub, or group/subgroup/name on GitLab. */
  repo: string;
  private: boolean;
}

export const FORGE_NAME: Record<Host, string> = { github: "GitHub", gitlab: "GitLab" };

/** "a private GitHub repo, acme/company-plan". */
export const describeHosting = (h: Hosting) => `a ${h.private ? "private" : "public"} ${FORGE_NAME[h.forge]} repo, ${h.repo}`;

/** The argv that makes the hosted repo from the local one and sets it as origin. It pushes nothing. */
export function createArgv(h: Hosting): string[] {
  const visibility = h.private ? "--private" : "--public";
  if (h.forge === "github") return ["gh", "repo", "create", h.repo, visibility, "--source", ".", "--remote", "origin"];
  return ["glab", "repo", "create", h.repo, visibility, "--defaultBranch", "main", "--remoteName", "origin"];
}

/** The signed-in account on the forge, to suggest as the owner. Undefined when the tool is missing or signed out. */
export function signedInAs(forge: Host, run: Runner = realRun, cwd = process.cwd()): string | undefined {
  if (!toolFor(forge, run, cwd)) return undefined;
  const r = forge === "github" ? run("gh", ["api", "user", "--jq", ".login"], cwd) : run("glab", ["api", "user"], cwd);
  if (r.status !== 0) return undefined;
  if (forge === "github") return r.stdout.trim() || undefined;
  try {
    return JSON.parse(r.stdout).username || undefined;
  } catch {
    return undefined;
  }
}

/** Why a repo path won't do, or undefined when it will. */
export function badRepoPath(forge: Host, repo: string): string | undefined {
  if (!REPO_PATH.test(repo)) return `'${repo}' isn't a repo path. Give the owner and the name, like acme/company-plan.`;
  if (forge === "github" && repo.split("/").length !== 2) return `'${repo}' has more than one /. A GitHub repo is owner/name, like acme/company-plan.`;
  return undefined;
}

/** The hosting flags: --github <owner/name> or --gitlab <group/name>, and --public. Undefined with neither. */
export function hostingFromFlags(flag: (n: string) => string | undefined, has: (n: string) => boolean): Hosting | undefined {
  if (has("github") && has("gitlab")) throw new Error("Pick one: --github <owner/name> or --gitlab <group/name>.");
  const forge: Host | undefined = has("github") ? "github" : has("gitlab") ? "gitlab" : undefined;
  if (!forge) {
    if (has("public")) throw new Error("--public goes with --github <owner/name> or --gitlab <group/name>.");
    return undefined;
  }
  const repo = flag(forge);
  if (!repo || repo === "true" || repo.startsWith("--")) throw new Error(`--${forge} needs the repo's path, for example: --${forge} acme/company-plan`);
  const problem = badRepoPath(forge, repo);
  if (problem) throw new Error(problem);
  return { forge, repo, private: !has("public") };
}

/** Whether the folder is a git repo with an origin remote already. */
export const hasOrigin = (dir: string, run: Runner = realRun) => existsSync(join(dir, ".git")) && run("git", ["remote", "get-url", "origin"], dir).status === 0;

export interface HostingResult {
  /** The line to show: ✓ made, or ! with what to run instead. */
  line: string;
  ok: boolean;
}

/**
 * Make the hosted repo for a local git repo and set it as origin. With gh or glab missing or failing, it
 * says the command to run. It never pushes.
 */
export function createHostedRepo(dir: string, h: Hosting, run: Runner = realRun): HostingResult {
  const argv = createArgv(h);
  const tool = argv[0];
  const what = describeHosting(h);
  if (hasOrigin(dir, run)) return { ok: false, line: `! This repo already has an origin remote, so nikOS didn't make ${what}.` };
  if (!toolFor(h.forge, run, dir)) return { ok: false, line: `! ${tool} isn't installed, so nikOS didn't make ${what}. Install ${tool}, sign in, then run this in ${dir}:\n    ${argv.join(" ")}` };
  const r = run(tool, argv.slice(1), dir);
  if (r.status !== 0) {
    const why = (r.stderr || r.stdout).trim().split("\n")[0];
    return { ok: false, line: `! Couldn't make ${what}${why ? `: ${why}` : ""}. Check you're signed in (${tool} auth status), then run this in ${dir}:\n    ${argv.join(" ")}` };
  }
  // glab adds origin when it runs inside a git repo; say so if it didn't.
  if (!hasOrigin(dir, run)) return { ok: true, line: `✓ Made ${what}. Set it as this repo's origin with: git remote add origin <its url>` };
  return { ok: true, line: `✓ Made ${what}, and set it as this repo's origin. Nothing is pushed yet.` };
}

/** The next step after a hosted repo is made: commit and push, when the person is ready. */
export const pushStep = (cd: string) => `Push it when you're ready: ${cd}git add . && git commit -m "Set up nikOS" && git push -u origin HEAD`;

/** For the flags: make the folder a git repo when it isn't one, then make the hosted repo. The lines to show. */
export function hostRepo(dir: string, h: Hosting, run: Runner = realRun): HostingResult[] {
  const out: HostingResult[] = [];
  if (!existsSync(join(dir, ".git"))) {
    const r = run("git", ["init", "-q", "-b", "main"], dir);
    if (r.status !== 0) return [{ ok: false, line: `! Couldn't make it a git repo: ${r.stderr.trim()}` }];
    out.push({ ok: true, line: "✓ Made it a git repo" });
  }
  out.push(createHostedRepo(dir, h, run));
  return out;
}
