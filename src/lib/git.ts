// Git facts about a repo that nikOS needs: which repo path it is on its host, and its commit.
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";

/** This repo's path on its host, from the origin remote: owner/repo, or group/subgroup/project. */
export function ownRepo(root: string): string | undefined {
  const url = spawnSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8" }).stdout?.trim() ?? "";
  const m = url.match(/^(?:[a-z+]+:\/\/[^/]+\/|[^@\s]+@[^:\s]+:)(.+?)(?:\.git)?\/?$/);
  return m?.[1];
}

/** The commit HEAD points at, or undefined when the repo has no commit yet. */
export function headOf(root: string): string | undefined {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

/** Paths a team repo writes about itself: its status and approvals, its identity file, and the copies it fetched. Changes there aren't code. */
const TEAM_OWN = [":!status", ":!approvals", ":!nikos.team.yaml", ":!.nikos"];

/** Whether the code (everything but a team's own status, approvals and copies) changed since a commit. */
export function codeChangedSince(root: string, commit: string): boolean {
  const r = spawnSync("git", ["diff", "--quiet", commit, "HEAD", "--", ".", ...TEAM_OWN], { cwd: root, encoding: "utf8" });
  return r.status !== 0;
}

/** Whether the code has uncommitted changes (a team's own status and approvals don't count). */
export function codeIsDirty(root: string): boolean {
  const r = spawnSync("git", ["status", "--porcelain", "--", ".", ...TEAM_OWN], { cwd: root, encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() !== "";
}

// ---- Branches and commits for saves from the dashboard -------------------------------------
// Every git call is an argv list (no shell), with no prompts, so a missing login fails instead of
// hanging. A runner can be passed in; tests use one that records the calls.

export interface GitResult {
  status: number | null;
  stdout: string;
  stderr: string;
}
export type Runner = (cmd: string, args: string[], cwd: string) => GitResult;

/** Runs a command with spawnSync: argv, no shell, no terminal prompts. */
export const realRun: Runner = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr || (r.error ? r.error.message : "") };
};

export const gitIn = (root: string, args: string[], run: Runner = realRun): GitResult => run("git", args, root);

/** The first line of a command's error, for a message. */
export const firstLine = (text: string) => text.trim().split("\n")[0] ?? "";

const sameFolder = (a: string, b: string) => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
};

/**
 * Whether the plan's folder is the top of its own git repo. A plan folder with no .git of its own,
 * inside some other repo, is not: a save there would switch that repo's branch and commit into it.
 */
export function isGit(root: string, run: Runner = realRun): boolean {
  const r = gitIn(root, ["rev-parse", "--show-toplevel"], run);
  return r.status === 0 && sameFolder(r.stdout.trim(), root);
}

/** The branch HEAD is on, or undefined when HEAD is detached. */
export function currentBranch(root: string, run: Runner = realRun): string | undefined {
  const r = gitIn(root, ["symbolic-ref", "--short", "-q", "HEAD"], run);
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : undefined;
}

/** The branch a repo's work is merged into: origin's default, else main, else master. */
export function baseBranch(root: string, run: Runner = realRun): string | undefined {
  const origin = gitIn(root, ["symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"], run);
  if (origin.status === 0 && origin.stdout.trim().startsWith("origin/")) return origin.stdout.trim().slice("origin/".length);
  for (const name of ["main", "master"]) if (branchExists(root, name, run)) return name;
  return undefined;
}

export function branchExists(root: string, name: string, run: Runner = realRun): boolean {
  return gitIn(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`], run).status === 0;
}

/** Whether origin has the branch as last fetched (a push leaves it there). */
export function remoteHas(root: string, name: string, run: Runner = realRun): boolean {
  return gitIn(root, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${name}`], run).status === 0;
}

/** The planning folders a save writes, that exist in the repo. */
export function nikosPaths(root: string): string[] {
  return ["planning", "maps", "intent"].filter((p) => existsSync(join(root, p)));
}

/** git status lines for paths (or all of them, when paths is undefined), as git prints them. No paths is no lines. */
export function statusOf(root: string, paths: string[] | undefined, run: Runner = realRun): string[] {
  if (paths && paths.length === 0) return [];
  const args = ["status", "--porcelain", "--untracked-files=all", ...(paths ? ["--", ...paths] : [])];
  const r = gitIn(root, args, run);
  return r.status === 0 ? r.stdout.split("\n").filter((l) => l.trim() !== "") : [];
}

/** The file a status line is about, unquoted. For a rename, the new name. */
export const pathOf = (line: string) => (line.slice(3).split(" -> ").pop() ?? "").replace(/^"|"$/g, "");

/**
 * Changed files outside the planning folders: a save leaves them alone, and the pending bar warns about them.
 * git prints paths from the top of the repo, so a plan in a subfolder of a larger repo looks at its own prefix.
 */
export function unrelatedDirty(root: string, run: Runner = realRun): string[] {
  const own = ["planning/", "maps/", "intent/"];
  const prefix = gitIn(root, ["rev-parse", "--show-prefix"], run).stdout.trim();
  return statusOf(root, undefined, run).filter((l) => {
    const path = pathOf(l);
    if (!prefix) return !own.some((p) => path.startsWith(p));
    if (!path.startsWith(prefix)) return true; // outside this folder
    const inside = path.slice(prefix.length);
    return !own.some((p) => inside.startsWith(p));
  });
}

/** Whether a branch is the base one, or the repo has no base and the branch isn't a nikos one (a save must not go there). */
export function onBaseBranch(branch: string, base: string | undefined): boolean {
  return branch === base || (!base && !branch.startsWith("nikos/"));
}

/** Create a branch from HEAD and switch to it. Uncommitted changes come along. */
export function switchNewBranch(root: string, name: string, run: Runner = realRun): { ok: boolean; error?: string } {
  const r = gitIn(root, ["switch", "-c", name], run);
  return r.status === 0 ? { ok: true } : { ok: false, error: firstLine(r.stderr) || "git switch failed" };
}

/** Stage the planning paths and commit only them, so nothing else in the index is taken. */
export function commitPaths(root: string, paths: string[], message: string, run: Runner = realRun): { ok: boolean; sha?: string; error?: string } {
  if (!paths.length) return { ok: false, error: "Nothing to commit" };
  const add = gitIn(root, ["add", "--", ...paths], run);
  if (add.status !== 0) return { ok: false, error: firstLine(add.stderr) || "git add failed" };
  const staged = gitIn(root, ["diff", "--cached", "--name-only", "--", ...paths], run);
  if (!staged.stdout.trim()) return { ok: false, error: "Nothing to commit" };
  const commit = gitIn(root, ["commit", "-q", "-m", message, "--", ...paths], run);
  if (commit.status !== 0) return { ok: false, error: firstLine(commit.stderr || commit.stdout) || "git commit failed" };
  return { ok: true, sha: gitIn(root, ["rev-parse", "HEAD"], run).stdout.trim() };
}

/** Push a branch to origin, setting its upstream. Only ever called from a click. */
export function pushBranch(root: string, name: string, run: Runner = realRun): { ok: boolean; error?: string } {
  const r = gitIn(root, ["push", "-u", "origin", name], run);
  return r.status === 0 ? { ok: true } : { ok: false, error: firstLine(r.stderr) || "git push failed" };
}
