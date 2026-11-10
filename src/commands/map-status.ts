// `nikos map status [--map <id>] [--json]`: each map in this repo, its stories' status, whether
// that status is proved against the current feature, and the approval that holds. Read from the
// map's own files only (no git, no network). It writes each map's delivery.yaml, which the plans
// above read, and nikos validate checks it against the files (see lib/map-summary.ts).
import { basename, join, resolve } from "node:path";
import { isDone } from "../lib/project.js";
import { mapDirs, keyOfMap } from "../lib/maps.js";
import { summaryBody, writeMapSummary, type Proof, type SummaryBody } from "../lib/map-summary.js";

export interface StoryRow {
  id: string;
  status: string;
  approval: "none" | "approved";
  approved_by?: string;
  proof?: Proof;
  /** Why the story needs attention, or "" when it doesn't. */
  reason: string;
}

export interface MapStatus {
  map: string;
  key: string;
  owner?: string;
  stories: StoryRow[];
  counts: { stories: number; done: number; approved: number; notCurrent: number };
  /** The summary the files say now, which is what gets written. Not in --json. */
  body: SummaryBody;
}

const REASON: Record<Proof, string> = {
  changed: "done, but its feature changed after it was proved: nikos state set <id> needs_rework, then in_progress, then done",
  behind: "in progress against an older feature: nikos state set <id> needs_rework, then in_progress",
  unverified: "done, with no proof against its feature: nikos state set <id> needs_rework, then in_progress, then done",
};

/** The status of each map in maps/, or only --map's. Throws when there is no map to read. */
export function mapStatus(root: string, opts: { map?: string } = {}): MapStatus[] {
  const dirs = mapDirs(root);
  if (!dirs.length) throw new Error("no story maps in maps/: nikos map status runs in a group repo (nikos map new --bet <bet-id> --key <KEY> makes one)");
  const want = opts.map?.toLowerCase();
  const picked = want ? dirs.filter((d) => basename(d) === want) : dirs;
  if (!picked.length) throw new Error(`no story map "${opts.map}" in maps/ (have: ${dirs.map((d) => basename(d)).join(", ")})`);
  return picked.map((dir) => {
    const body = summaryBody(root, dir);
    const stories = body.stories.map((s): StoryRow => ({
      id: s.id,
      status: s.status,
      approval: s.approval,
      ...(s.approved_by ? { approved_by: s.approved_by } : {}),
      ...(s.proof ? { proof: s.proof } : {}),
      reason: s.proof ? REASON[s.proof] : "",
    }));
    const done = body.stories.filter((s) => isDone(s.status) && !s.proof).length;
    return {
      map: body.map,
      key: keyOfMap(dir) ?? body.map,
      owner: body.owner,
      stories,
      counts: {
        stories: body.stories.length,
        done,
        approved: body.stories.filter((s) => s.approval === "approved").length,
        notCurrent: body.stories.filter((s) => s.proof).length,
      },
      body,
    };
  });
}

/** Write each map's delivery.yaml from its files now. Returns the files written. */
export function writeSummaries(root: string, results: MapStatus[], now: Date = new Date()): string[] {
  return results.map((r) => writeMapSummary(root, join(root, "maps", r.map), now));
}

/** The --json object: one map's status, or { maps } when several were read. */
export const statusJson = (rs: MapStatus[]) => {
  const plain = rs.map(({ body: _body, ...rest }) => rest);
  return plain.length === 1 ? plain[0] : { maps: plain };
};

/** One map's status as lines for a terminal. */
export function formatMapStatus(r: MapStatus): string {
  const out: string[] = [];
  const n = r.counts.stories;
  out.push(`Map ${r.map}${r.owner ? ` owned by ${r.owner}` : ""} (${n} ${n === 1 ? "story" : "stories"}, ${r.counts.done} done, ${r.counts.approved} approved)`);
  out.push("");
  const rows = r.stories.map((s) => [s.id, s.status + (s.proof ? ` (${s.proof})` : ""), s.approved_by ? `approved by ${s.approved_by}` : "-"]);
  const head = ["STORY", "STATUS", "APPROVAL"];
  const cols = head.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const line = (cells: string[]) => `  ${cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(cols[i]))).join("  ")}`.trimEnd();
  out.push(line(head));
  for (const row of rows) out.push(line(row));
  const attention = r.stories.filter((s) => s.reason);
  if (attention.length) {
    out.push("", "Needs attention");
    for (const s of attention) out.push(`  ${s.id}  ${s.reason}`);
  }
  return out.join("\n");
}

/** `nikos map status [--map <id>] [--json]`: prints each map's status, then writes its delivery.yaml. --json only prints. */
export function runMapStatus(args: string[]): number {
  const flag = (n: string) => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const dir = resolve(flag("--dir") ?? process.cwd());
  try {
    const results = mapStatus(dir, { map: flag("--map") });
    if (args.includes("--json")) {
      console.log(JSON.stringify(statusJson(results), null, 2));
      return 0;
    }
    console.log(results.map(formatMapStatus).join("\n\n"));
    for (const p of writeSummaries(dir, results)) console.log(`\nWrote ${p}: commit it, so the plans above show this delivery`);
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
