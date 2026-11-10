// The delivery summary a map's owner commits: maps/<key>/delivery.yaml, worked out from the map's
// own files (see lib/map-summary.ts) and written by nikos map status, state set, approve and map new.
// The plans above read it, so no rollout reads a map's live state.
// An approval here is the name it was given, not a verified identity (the amendment, rule 11).
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { schemaProblems } from "./schema.js";
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
  format_version: 1;
  map: string;
  /** The map's owner (its storymap owner, else the repo's group key). */
  owner: string;
  read_at: string;
  stories: SummaryStory[];
}

/** Write a map's summary. Refuses a summary that doesn't match its schema, so a bad one is never committed. */
export function writeDeliverySummary(mapDir: string, summary: DeliverySummary): string {
  const problems = schemaProblems("delivery-summary.schema.json", summary);
  if (problems.length) throw new Error(`${DELIVERY_SUMMARY}: ${problems[0]}`);
  const path = join(mapDir, DELIVERY_SUMMARY);
  // Overwritten on each run: it is generated, and read_at moves with every run.
  store().write(path, `# Written by nikos map status from the map's own files. Commit it: the plans above read it.\n${stringify(summary)}`);
  return path;
}

/** A map's summary, or undefined when there is none, or the file doesn't read against its schema. */
export function readDeliverySummary(mapDir: string): DeliverySummary | undefined {
  const path = join(mapDir, DELIVERY_SUMMARY);
  if (!store().exists(path)) return undefined;
  try {
    const data = parse(store().read(path));
    return schemaProblems("delivery-summary.schema.json", data).length ? undefined : (data as DeliverySummary);
  } catch {
    return undefined;
  }
}

/** How old a summary is, as the rollouts say it: "read 3 days ago (2026-11-05)". */
export function summaryAge(summary: Pick<DeliverySummary, "read_at">, now: Date = new Date()): string {
  const read = new Date(summary.read_at);
  const date = summary.read_at.slice(0, 10);
  const days = Math.floor((now.getTime() - read.getTime()) / 86_400_000);
  if (Number.isNaN(days) || days < 1) return `read today (${date})`;
  return `read ${days === 1 ? "1 day" : `${days} days`} ago (${date})`;
}
