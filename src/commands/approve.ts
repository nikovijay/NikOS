// `nikos approve`: a person's sign-off on a done story. It only runs in an interactive terminal
// and asks for the story id to be typed back, so a coding agent (which runs commands without a
// terminal) can't approve its own work. The approval holds while the feature stays unchanged.
import { spawnSync } from "node:child_process";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { parse } from "yaml";
import { STORY_ID, findIntentDir, read, specHash } from "../lib/project.js";
import { featureFor } from "./clear.js";
import { StateError, setState, type StateResult } from "./state.js";

/** Who is approving: git's user.name, or the login name when git has none. */
export function approver(dir: string): string {
  const git = spawnSync("git", ["config", "user.name"], { cwd: dir, encoding: "utf8" });
  return git.stdout?.trim() || userInfo().username;
}

/** Check a story can be approved, then approve it. The terminal check lives in runApprove. */
export function approve(story: string, opts: { dir?: string; by: string; date?: string }): StateResult {
  if (!STORY_ID.test(story)) throw new StateError(`'${story}' is not a story id (expected e.g. HT-1)`);
  const intentDir = findIntentDir(opts.dir ?? process.cwd());
  const entry = parse(read(join(intentDir, "state.yaml")))?.stories?.[story];
  if (!entry) throw new StateError(`${story} has no entry in state.yaml`);
  if (entry.status === "approved") throw new StateError(`${story} is already approved (by ${entry.approved_by ?? "someone"} on ${entry.approved_on ?? "an unknown date"})`);
  if (entry.status !== "done") throw new StateError(`${story} is ${entry.status}: only a done story can be approved`);
  const feature = featureFor(story, dirname(intentDir));
  if (feature && entry.spec_hash && entry.spec_hash !== specHash(read(feature))) {
    throw new StateError(`${story}'s feature changed after it was done. Move it to needs_rework and through done again before approving`);
  }
  return setState(story, "approved", { dir: opts.dir, by: opts.by, date: opts.date, approving: true });
}

export async function runApprove(args: string[]): Promise<number> {
  const [story, ...rest] = args;
  if (!story) {
    console.error("Usage: nikos approve <story-id> [--dir <path>]");
    return 1;
  }
  const i = rest.indexOf("--dir");
  const dir = i >= 0 ? rest[i + 1] : process.cwd();
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("✗ nikos approve only runs in an interactive terminal. Approval is a person's sign-off, so an agent can't give it.");
    return 1;
  }
  const by = approver(dir);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const typed = (await rl.question(`Approving ${story} as ${by}. Its scenarios run again first.\nType ${story} to approve: `)).trim();
    if (typed !== story) {
      console.error("✗ Not approved: that wasn't the story id.");
      return 1;
    }
  } finally {
    rl.close();
  }
  try {
    approve(story, { dir, by });
    console.log(`${story}: approved by ${by}`);
    return 0;
  } catch (err) {
    const e = err as StateError;
    if (e.result?.output && !e.result.failing.length) console.error(e.result.output);
    console.error(`✗ ${e.message}`);
    return 1;
  }
}
