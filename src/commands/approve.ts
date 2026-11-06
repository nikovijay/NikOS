// `nikos approve`: a person's sign-off on a done story, written to intent/approvals.yaml. It only
// runs in an interactive terminal and asks for the story id to be typed back, so a coding agent
// (which runs commands without a terminal) can't approve its own work. A repo can go further and
// protect approvals.yaml with CODEOWNERS, so approvals need a review on GitHub or GitLab.
// The approval holds while the story stays done, since the same done, with the same feature.
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { parse, parseDocument } from "yaml";
import { approvalLapse, approvalsPath, doneMark, loadApprovals } from "../lib/approvals.js";
import { STORY_ID, findIntentDir, read, specHash } from "../lib/project.js";
import { featureFor } from "./clear.js";
import { StateError, failingScenarios } from "./state.js";
import { verify } from "./verify.js";

const NEW_FILE = `# Sign-offs on done stories, written by nikos approve. Protect this file with CODEOWNERS
# (e.g. "/intent/approvals.yaml @your-product-lead") so an approval needs that person's review.
format_version: 1
approvals: {}
`;

/** Who is approving: git's user.name, or the login name when git has none. */
export function approver(dir: string): string {
  const git = spawnSync("git", ["config", "user.name"], { cwd: dir, encoding: "utf8" });
  return git.stdout?.trim() || userInfo().username;
}

export interface ApproveResult {
  story: string;
  by: string;
  on: string;
}

/** Check a story can be approved, rerun its scenarios, then record the approval. The terminal check lives in runApprove. */
export function approve(story: string, opts: { dir?: string; by: string; date?: string }): ApproveResult {
  if (!STORY_ID.test(story)) throw new StateError(`'${story}' is not a story id (expected e.g. HT-1)`);
  const intentDir = findIntentDir(opts.dir ?? process.cwd());
  const entry = parse(read(join(intentDir, "state.yaml")))?.stories?.[story];
  if (!entry) throw new StateError(`${story} has no entry in state.yaml`);
  if (entry.status !== "done") throw new StateError(`${story} is ${entry.status}: only a done story can be approved`);
  const feature = featureFor(story, dirname(intentDir));
  const hash = feature ? specHash(read(feature)) : undefined;
  if (!hash) throw new StateError(`No feature file is tagged @${story}`);
  if (entry.spec_hash && entry.spec_hash !== hash) {
    throw new StateError(`${story}'s feature changed after it was done. Move it to needs_rework and through done again before approving`);
  }
  const existing = loadApprovals(intentDir)[story];
  if (existing && !approvalLapse(existing, entry, hash)) throw new StateError(`${story} is already approved (by ${existing.by} on ${existing.on})`);

  let run;
  try {
    run = verify(dirname(intentDir), story);
  } catch (err) {
    throw new StateError(`${story} isn't approved: its scenarios couldn't run. ${(err as Error).message}`);
  }
  if (run.status !== 0) {
    const failing = failingScenarios(run.output);
    throw new StateError(`${story} isn't approved: its scenarios don't all pass${failing.length ? `:\n${failing.map((f) => `  ✗ ${f}`).join("\n")}` : ". See the runner output."}`);
  }

  const path = approvalsPath(intentDir);
  // A Document keeps comments and the other approvals as they were.
  const doc = parseDocument(existsSync(path) ? read(path) : NEW_FILE);
  const on = opts.date ?? new Date().toISOString().slice(0, 10);
  doc.setIn(["approvals", story], doc.createNode({ by: opts.by, on, spec_hash: hash, done_at: doneMark(entry) }));
  writeFileSync(path, doc.toString({ flowCollectionPadding: false }));
  return { story, by: opts.by, on };
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
    console.log(`${story}: approved by ${by} (intent/approvals.yaml)`);
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
