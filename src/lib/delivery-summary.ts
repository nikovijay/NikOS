// The delivery summary a map's owner commits: maps/<key>/delivery.yaml, worked out from the map's
// own files (see lib/map-summary.ts) and written by nikos map status, state set, approve and map new.
// The plans above read it, so no rollout reads a map's live state.
// An approval here is the name it was given, not a verified identity (the amendment, rule 11).
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { contractProblems, contractVersion, NewerContractError, schemaProblems } from "./schema.js";
import { store } from "./store.js";

export const DELIVERY_SUMMARY = "delivery.yaml";

export interface SummaryStory {
  id: string;
  status: string;
  approval: "none" | "approved";
  approved_by?: string;
  /** Set when the proof isn't for the current feature: the plans above don't count the story done. */
  proof?: "changed" | "behind" | "unverified";
  read_at: string;
}

export interface DeliverySummary {
  version: 1;
  map: string;
  /** The map's owner (its storymap owner, else the repo's group key). Absent when neither names one. */
  owner?: string;
  read_at: string;
  stories: SummaryStory[];
}

/**
 * Write a map's summary. Refuses a summary that doesn't match its schema, so a bad one is never committed, and
 * refuses to overwrite a delivery.yaml a newer nikOS wrote (NewerContractError): the writers run in the code repo.
 */
export function writeDeliverySummary(mapDir: string, summary: DeliverySummary): string {
  const problems = schemaProblems("delivery-summary.schema.json", summary);
  if (problems.length) throw new Error(`${DELIVERY_SUMMARY}: ${problems[0]}`);
  const path = join(mapDir, DELIVERY_SUMMARY);
  if (store().exists(path)) {
    let onDisk: unknown;
    try {
      onDisk = parse(store().read(path));
    } catch {
      onDisk = undefined; // not YAML: nikOS wrote it, so this run replaces it
    }
    const newer = contractVersion(DELIVERY_SUMMARY, onDisk, "version", "code");
    if (newer) throw new NewerContractError(newer);
  }
  // Overwritten on each run: it is generated, and read_at moves with every run.
  store().write(path, `# Written by nikos map status from the map's own files. Commit it: the plans above read it.\n${stringify(summary)}`);
  return path;
}

export type SummaryRead = { ok: true; summary: DeliverySummary } | { ok: false; reason: string; newer?: true };

/**
 * A map's summary, or why there isn't one: a missing file, one that isn't YAML, one that doesn't read
 * against the contract schema, or one written by a newer nikOS (newer: true). Never silently undefined.
 * side is the repo whose nikOS is reading: the one a newer file names as the repo to upgrade.
 */
export function readDeliverySummaryResult(mapDir: string, side: "planning" | "code"): SummaryRead {
  const path = join(mapDir, DELIVERY_SUMMARY);
  if (!store().exists(path)) return { ok: false, reason: "no delivery.yaml yet" };
  let data: unknown;
  try {
    data = parse(store().read(path));
  } catch (err) {
    return { ok: false, reason: `is not valid YAML: ${(err as Error).message.split("\n")[0]}` };
  }
  let problems: string[];
  try {
    problems = contractProblems(DELIVERY_SUMMARY, data, "version", side, "contract/delivery.schema.json");
  } catch (err) {
    if (err instanceof NewerContractError) return { ok: false, reason: err.message, newer: true };
    throw err;
  }
  if (problems.length) return { ok: false, reason: problems[0] };
  return { ok: true, summary: data as DeliverySummary };
}

/**
 * A map's summary, or undefined when there is none or it doesn't read. A summary from a newer nikOS
 * throws NewerContractError, so the caller can tell refusal from a bad file.
 */
export function readDeliverySummary(mapDir: string, side: "planning" | "code"): DeliverySummary | undefined {
  const read = readDeliverySummaryResult(mapDir, side);
  if (read.ok) return read.summary;
  if (read.newer) throw new NewerContractError(read.reason);
  return undefined;
}

/** How old a summary is, as the rollouts say it: "read 3 days ago (2026-11-05)". */
export function summaryAge(summary: Pick<DeliverySummary, "read_at">, now: Date = new Date()): string {
  const read = new Date(summary.read_at);
  const date = summary.read_at.slice(0, 10);
  const days = Math.floor((now.getTime() - read.getTime()) / 86_400_000);
  if (Number.isNaN(days) || days < 1) return `read today (${date})`;
  return `read ${days === 1 ? "1 day" : `${days} days`} ago (${date})`;
}
