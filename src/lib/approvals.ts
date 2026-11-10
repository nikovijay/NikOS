// Approvals live in intent/approvals.yaml, or maps/<key>/approvals/<ID>.yaml (one per story), apart
// from story state, so a repo can protect them: a CODEOWNERS rule on them means an approval only
// lands when the right person reviews the PR or merge request. Agents write state all the time;
// approvals only change on sign-off.
import { join } from "node:path";
import { loadApprovalEntries, type StoryHome } from "./state-files.js";

export interface Approval {
  by: string;
  on: string;
  /** How it was given: typed in a terminal, answered in a chat with an agent, or asked by nikos mcp through the person's app. */
  via?: "terminal" | "chat" | "app" | "tracker";
  /** The feature fingerprint that was approved. */
  spec_hash: string;
  /** Which time the story reached done: going through done again needs a new approval. */
  done_at: string;
  /** The commit the story was tested at, for a story in a repo with git: a new commit's code lapses it. */
  tested_commit?: string;
}

export const approvalsPath = (intentDir: string) => join(intentDir, "approvals.yaml");

export function loadApprovals(home: StoryHome): Record<string, Approval> {
  return loadApprovalEntries<Approval>(home);
}

/**
 * Which done a story is on. Stories done before done_at existed fall back to the date of their
 * last move, which stays put while they stay done.
 */
export const doneMark = (state: { done_at?: string; updated?: string } | undefined) => String(state?.done_at ?? state?.updated ?? "unknown");

/**
 * Whether an approval still holds for a story's current state. It holds while the story is done,
 * since the same done, with the same feature. An approval that names the commit it was tested at
 * also lapses when the story was tested at another one. Returns undefined when it holds, or why not.
 */
export function approvalLapse(
  approval: Approval,
  state: { status?: string; done_at?: string; updated?: string; evidence?: { commit?: string } } | undefined,
  currentHash: string | undefined,
): string | undefined {
  if (state?.status !== "done") return state ? `it's ${state.status} now` : "it has no entry in state";
  if (approval.done_at !== doneMark(state)) return "it went through done again since";
  if (currentHash && approval.spec_hash !== currentHash) return "its feature changed since";
  if (approval.tested_commit !== undefined && approval.tested_commit !== state.evidence?.commit) return "it was tested at another commit";
  return undefined;
}
