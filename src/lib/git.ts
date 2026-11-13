// Git facts about a repo that nikOS needs: which repo path it is on its host, and its commit.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";

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

/**
 * Paths nikOS writes about a map's own status and sign-offs (its state, approvals and delivery summary),
 * and the repo's decisions and constitution. They change with each move, sign-off and decision, not with
 * the code, so they never lapse an approval.
 */
const BOOKKEEPING = [
  ":!.nikos",
  ":(exclude,glob)maps/*/state.yaml",
  ":(exclude,glob)maps/*/state/**",
  ":(exclude,glob)maps/*/approvals.yaml",
  ":(exclude,glob)maps/*/approvals/**",
  ":(exclude,glob)maps/*/delivery.yaml",
  ":(exclude)decisions.md",
  ":(exclude)constitution.md",
];

/**
 * Whether the code changed since a commit. A folder with no git, or a repo with no commit yet, has
 * no code to compare, so nothing changed.
 */
export function codeChangedSince(root: string, commit: string): boolean {
  if (!headOf(root)) return false;
  const r = spawnSync("git", ["diff", "--quiet", commit, "HEAD", "--", ".", ...BOOKKEEPING], { cwd: root, encoding: "utf8" });
  return r.status !== 0;
}

/** Whether the code has uncommitted changes (nikOS's own bookkeeping files don't count). */
export function codeIsDirty(root: string): boolean {
  const r = spawnSync("git", ["status", "--porcelain", "--", ".", ...BOOKKEEPING], { cwd: root, encoding: "utf8" });
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
 * Changed files outside the planning and map folders (and the repo's decisions and constitution): a save leaves
 * them alone, and the pending bar warns about them.
 * git prints paths from the top of the repo, so a plan in a subfolder of a larger repo looks at its own prefix.
 */
export function unrelatedDirty(root: string, run: Runner = realRun): string[] {
  const own = ["planning/", "maps/"];
  // The repo's own decisions and constitution are nikOS's files too (see BOOKKEEPING).
  const ownFiles = ["decisions.md", "constitution.md"];
  const mine = (inside: string) => own.some((p) => inside.startsWith(p)) || ownFiles.includes(inside);
  const prefix = gitIn(root, ["rev-parse", "--show-prefix"], run).stdout.trim();
  return statusOf(root, undefined, run).filter((l) => {
    const path = pathOf(l);
    if (!prefix) return !mine(path);
    if (!path.startsWith(prefix)) return true; // outside this folder
    return !mine(path.slice(prefix.length));
  });
}

/** Whether a branch is the base one, or the repo has no base and the branch isn't a nikos one (a save must not go there). */
export function onBaseBranch(branch: string, base: string | undefined): boolean {
  return branch === base || (!base && !branch.startsWith("nikos/"));
}

/**
 * The base name if no branch has it, else base-2, base-3, and so on. A name is taken when a local branch has it or
 * it's in `taken` (the branches origin has, from remoteBranches).
 */
export function nextBranchName(root: string, base: string, run: Runner = realRun, taken: string[] = []): string {
  let name = base;
  for (let n = 2; branchExists(root, name, run) || taken.includes(name); n++) name = `${base}-${n}`;
  return name;
}

/**
 * The branch names origin has, from ls-remote, or [] when the repo has no origin. Throws when origin can't be
 * listed, so a caller never guesses that a name is free.
 */
export function remoteBranches(root: string, run: Runner = realRun): string[] {
  if (gitIn(root, ["remote", "get-url", "origin"], run).status !== 0) return [];
  const r = gitIn(root, ["ls-remote", "--heads", "origin"], run);
  if (r.status !== 0) throw new Error(`Couldn't list the branches on origin: ${firstLine(r.stderr) || "git ls-remote failed"}`);
  return r.stdout
    .split("\n")
    .map((line) => line.split("\t")[1] ?? "")
    .filter(Boolean)
    .map((ref) => ref.replace(/^refs\/heads\//, ""));
}

/** Create a branch from HEAD and switch to it. Uncommitted changes come along. */
export function switchNewBranch(root: string, name: string, run: Runner = realRun): { ok: boolean; error?: string } {
  const r = gitIn(root, ["switch", "-c", name], run);
  return r.status === 0 ? { ok: true } : { ok: false, error: firstLine(r.stderr) || "git switch failed" };
}

/** Stage the planning paths and commit only them, so nothing else in the index is taken. */
/** Make a branch from a start point (e.g. main) and switch to it. The start point's commits are the branch's; the current branch is left as it is. */
export function switchNewBranchFrom(root: string, name: string, from: string, run: Runner = realRun): { ok: boolean; error?: string } {
  const r = gitIn(root, ["switch", "-c", name, from], run);
  return r.status === 0 ? { ok: true } : { ok: false, error: firstLine(r.stderr) || "git switch failed" };
}
export function commitPaths(root: string, paths: string[], message: string, run: Runner = realRun): { ok: boolean; sha?: string; error?: string } {
  if (!paths.length) return { ok: false, error: "Nothing to commit" };
  // -A stages a removed file too: a story moved into another activity folder shows its old path as removed.
  const add = gitIn(root, ["add", "-A", "--", ...paths], run);
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
