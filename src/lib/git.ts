// Git facts about a repo that nikOS needs: which repo path it is on its host, and its commit.
import { spawnSync } from "node:child_process";

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
