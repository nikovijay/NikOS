// Fetch one branch of a repo into a folder as a plain copy: no history, nothing to push back.
// Planning sync and team sync both read other repos this way, read-only.
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

/** The commit read, or the last line of git's error when the branch can't be fetched. */
export function fetchCopy(url: string, ref: string, dir: string): { commit: string } | { error: string } {
  rmSync(dir, { recursive: true, force: true });
  const clone = spawnSync("git", ["clone", "--quiet", "--depth", "1", "--branch", ref, url, dir], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (clone.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    return { error: (clone.stderr || "clone failed").trim().split("\n").pop()!.replace(/^fatal:\s*/, "") };
  }
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();
  rmSync(join(dir, ".git"), { recursive: true, force: true }); // a plain copy: nothing to push back
  return { commit };
}
