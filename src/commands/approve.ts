// `nikos approve`: a person's sign-off on a done story, written to maps/<key>/approvals/<ID>.yaml. Two
// ways in, recorded as `via`:
// - terminal: the person runs it and types the story id back. A coding agent runs commands
//   without a terminal, so it can't take this route.
// - chat: the agent asked "Do you want to approve …?" and the person answered Approve. The
//   playbooks only allow it after that answer; `via: chat` shows it was given that way.
// - app: nikos mcp asked the person through their app (MCP elicitation), so the model never
//   saw the question or gave the answer.
// - tracker: a person moved the story's ticket to a status mapped to approved (nikos tracker
//   record), when tracker.approvals is on.
// A repo can go further and protect a map's approvals/ with CODEOWNERS, so every approval also
// needs a review on GitHub or GitLab.
// The approval holds while the story stays done, since the same done, with the same feature.
import { spawnSync } from "node:child_process";
import { relative } from "node:path";
import { userInfo } from "node:os";
import { createInterface } from "node:readline/promises";
import { approvalLapse, doneMark, loadApprovals } from "../lib/approvals.js";
import { approvalFileOf, noEntry, storyState, writeApproval } from "../lib/state-files.js";
import { resolveSettings, type ApprovalRoute } from "../lib/settings.js";
import { STORY_ID, read, specHash } from "../lib/project.js";
import { resolveStoryMap } from "../lib/maps.js";
import { codeChangedSince, codeIsDirty, headOf } from "../lib/git.js";
import { featureFor } from "./clear.js";
import { StateError, failingScenarios } from "./state.js";
import { verify } from "./verify.js";
import { writeMapSummary } from "../lib/map-summary.js";

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
export type Via = "terminal" | "chat" | "app" | "tracker";

export function approve(story: string, opts: { dir?: string; map?: string; by: string; date?: string; via?: Via }): ApproveResult {
  if (!STORY_ID.test(story)) throw new StateError(`'${story}' is not a story id (expected e.g. HT-1 or PAY-CHK-12)`);
  const ref = resolveStoryMap(opts.dir ?? process.cwd(), { story, map: opts.map });
  const home = ref.dir;
  const settings = resolveSettings(ref.root, { map: ref.dir });
  const policy = settings["approval.policy"];
  if (policy.value === "off") throw new StateError(`Approvals are off here (approval.policy, set by ${policy.from})`);
  const via = opts.via ?? "terminal";
  const routes = settings["approval.routes"];
  // A tracker approval counts when tracker.approvals is on; the other routes by approval.routes.
  if (via === "tracker" && !settings["tracker.approvals"].value) throw new StateError("Tracker approvals don't count here (tracker.approvals is off)");
  if (via !== "tracker" && !(routes.value as ApprovalRoute[]).includes(via)) {
    throw new StateError(`Approvals ${via === "app" ? "through the app" : via === "chat" ? "in chat" : "in a terminal"} don't count here: approval.routes is ${(routes.value as string[]).join(", ")} (set by ${routes.from})`);
  }
  // A map's story with no state entry is todo, so it's refused below as not done.
  const entry = storyState(home, story) ?? { status: "todo" };
  if (!entry) throw new StateError(noEntry(home, story));
  if (entry.status !== "done") throw new StateError(`${story} is ${entry.status}: only a done story can be approved`);
  const feature = featureFor(story, ref.root, ref.id);
  const hash = feature ? specHash(read(feature)) : undefined;
  if (!hash) throw new StateError(`No feature file is tagged @${story}`);
  if (entry.spec_hash && entry.spec_hash !== hash) {
    throw new StateError(`${story}'s feature changed after it was done. Move it to needs_rework and through done again before approving`);
  }
  // A map's story is approved for the code it tested: no code may have changed since the commit the
  // proof ran at. A commit that only moves nikOS's own state or approvals doesn't count. Without git
  // or a commit there is no commit to test against, so these checks are skipped.
  const head = headOf(ref.root);
  const tested = entry.evidence?.commit ?? entry.tested_commit;
  // Uncommitted code isn't any commit: the proof ran on it, so it can't be approved at a commit.
  if (head && codeIsDirty(ref.root)) {
    throw new StateError(`${story} can't be approved: the code has uncommitted changes. Commit them, then run its scenarios again: nikos state set ${story} needs_rework, then in_progress, then done, then approve`);
  }
  // A story done before its folder had a commit (or migrated with no evidence) has no commit to test against.
  if (head && !tested) {
    throw new StateError(`${story} was done with no recorded test commit, so nikOS can't tell what its proof covers: run its scenarios again: nikos state set ${story} needs_rework, then in_progress, then done, then approve`);
  }
  if (head && codeChangedSince(ref.root, tested!)) {
    throw new StateError(`${story} was tested at ${tested!.slice(0, 7)}, and the code has changed since (HEAD is ${head.slice(0, 7)}): run its scenarios again: nikos state set ${story} needs_rework, then in_progress, then done, then approve`);
  }
  const existing = loadApprovals(home)[story];
  if (existing && !approvalLapse(existing, entry, hash)) {
    throw new StateError(`${story} is already approved (by ${existing.by} on ${existing.on})`);
  }

  let run;
  try {
    run = verify(ref.root, story, { map: ref.id });
  } catch (err) {
    throw new StateError(`${story} isn't approved: its scenarios couldn't run. ${(err as Error).message}`);
  }
  if (run.status !== 0) {
    const failing = failingScenarios(run.output);
    throw new StateError(`${story} isn't approved: its scenarios don't all pass${failing.length ? `:\n${failing.map((f) => `  ✗ ${f}`).join("\n")}` : ". See the runner output."}`);
  }

  const on = opts.date ?? new Date().toISOString().slice(0, 10);
  writeApproval(home, story, { by: opts.by, on, via, spec_hash: hash, done_at: doneMark(entry), ...(head && tested ? { tested_commit: tested } : {}) });
  // The map's delivery.yaml shows the approval, so it's written with it.
  writeMapSummary(ref.root, ref.dir);
  return { story, by: opts.by, on };
}

export async function runApprove(args: string[]): Promise<number> {
  const flag = (n: string) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const stories = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
  const dir = flag("dir") ?? process.cwd();
  const map = flag("map");
  const via = flag("via") ?? "terminal";
  if (!stories.length || (via !== "terminal" && via !== "chat")) {
    console.error("Usage: nikos approve <story-id>... [--via chat] [--dir <path>]");
    return 1;
  }
  const by = approver(dir);
  if (via === "terminal") {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.error(
        "✗ nikos approve only runs in an interactive terminal. In a chat with an agent, the agent asks \"Do you want to approve …?\" and records your answer with --via chat.",
      );
      return 1;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const want = stories.join(" ");
      const typed = (await rl.question(`Approving ${want} as ${by}. Scenarios run again first.\nType ${want} to approve: `)).trim();
      if (typed !== want) {
        console.error("✗ Not approved: that wasn't the story id.");
        return 1;
      }
    } finally {
      rl.close();
    }
  }
  let failed = 0;
  for (const story of stories) {
    try {
      approve(story, { dir, map, by, via });
      // The file the approval went to, from the repo root: the map's approvals/<ID>.yaml.
      const ref = resolveStoryMap(dir, { story, map });
      const where = relative(ref.root, approvalFileOf(ref.dir, story));
      console.log(`${story}: approved by ${by}${via === "chat" ? " in chat" : ""} (${where})`);
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`);
      failed++;
    }
  }
  return failed ? 1 : 0;
}
