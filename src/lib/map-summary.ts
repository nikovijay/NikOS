// A map's delivery summary, worked out from the map's own files: its storymap, features, state and
// approvals. Pure reads (no git, no network), so `nikos map status` and `nikos validate` agree, and
// a summary that no longer matches the files is caught before it is committed. The plans above
// read the committed delivery.yaml (see lib/delivery-summary.ts).
import { basename } from "node:path";
import { approvalLapse, loadApprovals } from "./approvals.js";
import { loadMapData, mapStoryIds } from "./map-data.js";
import { DELIVERY_SUMMARY, writeDeliverySummary, type DeliverySummary } from "./delivery-summary.js";
import { keyOf, mapOwnerOf, NO_OWNER, type StoryMapRef } from "./maps.js";
import { isDone, specHash } from "./project.js";
import { loadStates } from "./state-files.js";

export type Proof = "changed" | "behind" | "unverified";

/** One story's line in a summary, without read_at. */
export interface SummaryBodyStory {
  id: string;
  status: string;
  approval: "none" | "approved";
  approved_by?: string;
  /** Set when the status wasn't proved against the current feature. */
  proof?: Proof;
}

/** A summary without read_at: what the files say now. */
export interface SummaryBody {
  format_version: 1;
  map: string;
  owner: string;
  stories: SummaryBodyStory[];
}

/** Whether a story map gets a delivery.yaml: a map in this repo's maps/ (not intent/). */
export const hasSummary = (ref: StoryMapRef): boolean => ref.inRepo;

/** The owner a map's story ids and summary carry: its storymap owner, else the repo's group key. */
export function ownerFor(root: string, dir: string): string {
  const owner = mapOwnerOf(dir) ?? keyOf(root);
  if (!owner) throw new Error(NO_OWNER);
  return owner;
}

/**
 * The story ids in summary order: each release's stories in release order, then the stories no release names,
 * sorted by id (so the file reads the same whatever order the feature files were read in).
 */
function orderedIds(data: ReturnType<typeof loadMapData>): string[] {
  const ids = mapStoryIds(data);
  const placed = new Set([...data.releases.values()].flat());
  return [...ids.filter((id) => placed.has(id)), ...ids.filter((id) => !placed.has(id)).sort()];
}

/**
 * The summary a map's files say now. Each story's proof is judged against its feature, so a proof for an
 * older feature shows.
 */
export function summaryBody(root: string, dir: string): SummaryBody {
  const owner = ownerFor(root, dir);
  const data = loadMapData(dir);
  const states = loadStates(dir);
  const approvals = loadApprovals(dir);
  const stories = orderedIds(data).map((id): SummaryBodyStory => {
    const feature = data.features.find((f) => f.id === id);
    const hash = specHash(feature?.text ?? "");
    const state = states[id];
    const status = String(state?.status ?? "todo");
    const a = approvals[id];
    const approved = isDone(status) && !!a && !approvalLapse(a, state, hash);
    let proof: Proof | undefined;
    if (isDone(status) && !state?.spec_hash) proof = "unverified";
    else if (isDone(status) && state?.spec_hash !== hash) proof = "changed";
    // A cancelled story isn't being worked on, so an older feature doesn't make it behind.
    else if (!isDone(status) && status !== "cancelled" && state?.spec_hash && state.spec_hash !== hash) proof = "behind";
    return {
      id,
      status,
      approval: approved ? "approved" : "none",
      ...(approved ? { approved_by: a!.by } : {}),
      ...(proof ? { proof } : {}),
    };
  });
  return { format_version: 1, map: basename(dir), owner, stories };
}

/** The summary with read_at set on the file and on each story: what gets written. */
export function summaryWith(body: SummaryBody, now: Date): DeliverySummary {
  const read_at = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  return { ...body, read_at, stories: body.stories.map((s) => ({ ...s, read_at })) };
}

/** Write a map's delivery.yaml from its files now. Returns the path written. */
export function writeMapSummary(root: string, dir: string, now: Date = new Date()): string {
  return writeDeliverySummary(dir, summaryWith(summaryBody(root, dir), now));
}

/** The first way a committed delivery.yaml differs from what the files say now, or undefined when it matches. Ignores read_at and order. */
export function summaryDrift(body: SummaryBody, onDisk: unknown): { file: string; message: string } | undefined {
  const disk = onDisk as Partial<SummaryBody> | undefined;
  if (!disk || typeof disk !== "object") return { file: DELIVERY_SUMMARY, message: "is not a delivery summary" };
  for (const field of ["format_version", "map", "owner"] as const) {
    if (disk[field] !== body[field]) return { file: DELIVERY_SUMMARY, message: `${field} is '${disk[field]}' in ${DELIVERY_SUMMARY}, but '${body[field]}' now` };
  }
  const byId = new Map((Array.isArray(disk.stories) ? disk.stories : []).map((s: any) => [s?.id, s]));
  for (const want of body.stories) {
    const have = byId.get(want.id) as any;
    if (!have) return { file: DELIVERY_SUMMARY, message: `${want.id} is not in ${DELIVERY_SUMMARY}` };
    for (const field of ["status", "approval", "approved_by", "proof"] as const) {
      if (have[field] !== want[field]) {
        return { file: DELIVERY_SUMMARY, message: `${want.id}: ${field} is '${have[field] ?? "none"}' in ${DELIVERY_SUMMARY}, but '${want[field] ?? "none"}' now` };
      }
    }
  }
  const want = new Set(body.stories.map((s) => s.id));
  const extra = [...byId.keys()].find((id) => !want.has(id));
  if (extra !== undefined) return { file: DELIVERY_SUMMARY, message: `${extra} is in ${DELIVERY_SUMMARY} but not in the map` };
  return undefined;
}
