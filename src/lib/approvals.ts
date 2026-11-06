// Approvals live in intent/approvals.yaml, apart from state.yaml, so a repo can protect them:
// a CODEOWNERS rule on the file means an approval only lands when the right person reviews the
// PR or merge request. Agents write state.yaml all the time; approvals.yaml only changes on sign-off.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { read } from "./project.js";

export interface Approval {
  by: string;
  on: string;
  /** The feature fingerprint that was approved. */
  spec_hash: string;
  /** Which time the story reached done: going through done again needs a new approval. */
  done_at: string;
}

export const approvalsPath = (intentDir: string) => join(intentDir, "approvals.yaml");

export function loadApprovals(intentDir: string): Record<string, Approval> {
  const path = approvalsPath(intentDir);
  if (!existsSync(path)) return {};
  return parse(read(path))?.approvals ?? {};
}

/**
 * Which done a story is on. Stories done before done_at existed fall back to the date of their
 * last move, which stays put while they stay done.
 */
export const doneMark = (state: { done_at?: string; updated?: string } | undefined) => String(state?.done_at ?? state?.updated ?? "unknown");

/**
 * Whether an approval still holds for a story's current state. It holds while the story is done,
 * since the same done, with the same feature. Returns undefined when it holds, or why not.
 */
export function approvalLapse(approval: Approval, state: { status?: string; done_at?: string; updated?: string } | undefined, currentHash: string | undefined): string | undefined {
  if (state?.status !== "done") return state ? `it's ${state.status} now` : "it has no entry in state.yaml";
  if (approval.done_at !== doneMark(state)) return "it went through done again since";
  if (currentHash && approval.spec_hash !== currentHash) return "its feature changed since";
  return undefined;
}
