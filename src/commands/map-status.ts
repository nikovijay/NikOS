// `nikos map status`: in a group repo, how each team assigned to a map is doing on its stories.
// Each team's repo is fetched read-only (or read from the last fetch with --offline), and every
// story shows its holder's status, whether that status proves the story against the current
// feature, the team's delivery approval and the group's intent approval. Nothing is written to a
// team's repo. The one file it writes is each read map's delivery.yaml in this group's repo (not
// with --offline), which the plans above read so they never fetch a team (see lib/delivery-summary.ts).
import { basename, join, resolve } from "node:path";
import { writeDeliverySummary, type DeliverySummary } from "../lib/delivery-summary.js";
import { headOf, ownRepo } from "../lib/git.js";
import { isTeamRepo } from "../lib/team.js";
import { repoEntry } from "../planning/upstream.js";
import { ASSIGNMENTS, mapStoryIds, type Assignment } from "../lib/assignments.js";
import { isDone } from "../lib/project.js";
import { resolveSettings } from "../lib/settings.js";
import { fetchTeams, FRESHNESS, groupMaps, mapViews, readTeamIndex, short, type Freshness, type GroupMap, type StoryView, type TeamIndex } from "../team/status.js";

export interface TeamRow {
  team: string;
  repo: string;
  url?: string;
  ref?: string;
  commit?: string;
  fetched?: string;
  attempted?: string;
  ok: boolean;
  error?: string;
  retired: boolean;
}

export interface StoryRow {
  id: string;
  /** The holder's repo path, or "." when this group holds it. */
  holder: string | null;
  team: string | null;
  status: string;
  ticket: string | null;
  freshness: Freshness;
  reason: string;
  copy: "fetched" | "last-copy" | "none";
  delivery: string;
  intent: string;
  /** Done and approval is required here, but none holds yet. */
  awaiting: boolean;
  from: { team: string; repo: string; status: string | null } | null;
}

export interface MapStatus {
  map: string;
  key: string;
  group: { repo: string; commit?: string };
  offline: boolean;
  /** Whether any team is assigned to this map. */
  assigned: boolean;
  teams: TeamRow[];
  stories: StoryRow[];
  counts: Record<Freshness, number>;
  /** The name each approved story's delivery approval was given (not a verified identity). Written to delivery.yaml, not in --json. */
  approvers: Record<string, string>;
}

/** Each team holding a story of the map, in assignment order, then any retired team read for its moved stories. */
function teamRows(gm: GroupMap, index: TeamIndex): TeamRow[] {
  const rows: TeamRow[] = [];
  const seen = new Set<string>();
  for (const a of gm.list) {
    if (seen.has(a.repo)) continue;
    seen.add(a.repo);
    rows.push(rowOf(a, index));
  }
  // A retired team (no stories left anywhere) belongs to this map only while one of its stories is still recorded with it.
  const ids = mapStoryIds(gm.data);
  for (const c of Object.values(index.teams)) {
    if (c.retired && !seen.has(c.repo) && ids.some((id) => index.holders[id] === c.repo)) {
      seen.add(c.repo);
      rows.push({ team: c.team, repo: c.repo, url: c.url, ref: c.ref, commit: c.commit, fetched: c.fetched, attempted: c.attempted, ok: c.ok, error: c.error, retired: true });
    }
  }
  return rows;
}

function rowOf(a: Assignment, index: TeamIndex): TeamRow {
  if (a.repo === ".") return { team: a.team, repo: ".", ok: true, retired: false };
  const c = index.teams[a.repo];
  const e = repoEntry(a, ASSIGNMENTS);
  return {
    team: a.team,
    repo: a.repo,
    url: e.url,
    ref: e.ref,
    ...(c?.commit ? { commit: c.commit, fetched: c.fetched } : {}),
    ...(c?.attempted ? { attempted: c.attempted } : {}),
    ok: !!c?.ok,
    ...(c?.error ? { error: c.error } : {}),
    retired: false,
  };
}

const zeroCounts = (): Record<Freshness, number> => Object.fromEntries(FRESHNESS.map((f) => [f, 0])) as Record<Freshness, number>;

/**
 * The status of each group map's stories and teams. Every map is read; with map, only that one.
 * Teams are fetched once, for all the maps, unless offline (then the last fetch is read).
 */
export function mapStatus(root: string, opts: { map?: string; offline?: boolean } = {}): MapStatus[] {
  if (isTeamRepo(root)) throw new Error("this is a team repo: run nikos map status in the group repo");
  const maps = groupMaps(root);
  if (!maps.length) throw new Error("no story maps in maps/: nikos map status runs in a group repo (nikos map new --bet <bet-id> --key <KEY> makes one)");
  const want = opts.map?.toLowerCase();
  const picked = want ? maps.filter((m) => m.id === want) : maps;
  if (!picked.length) throw new Error(`no story map "${opts.map}" in maps/ (have: ${maps.map((m) => m.id).join(", ")})`);
  const group = { repo: ownRepo(root) ?? basename(resolve(root)), commit: headOf(root) };
  const index = picked.some((m) => m.list.length) ? fetchTeams(root, { offline: opts.offline }) : readTeamIndex(root);
  const policy = () => {
    try {
      return resolveSettings(root)["approval.policy"].value as string;
    } catch {
      return undefined; // a settings file that doesn't read is reported by doctor, and the default applies
    }
  };

  return picked.map((gm) => {
    const base = { map: gm.id, key: gm.key, group, offline: !!opts.offline };
    if (!gm.list.length) return { ...base, assigned: false, teams: [], stories: [], counts: zeroCounts(), approvers: {} };
    const views: StoryView[] = mapViews(root, gm, index, undefined, policy());
    const counts = zeroCounts();
    for (const v of views) counts[v.freshness]++;
    const approvers = Object.fromEntries(views.filter((v) => v.approvedBy).map((v) => [v.id, v.approvedBy!]));
    return {
      ...base,
      assigned: true,
      approvers,
      teams: teamRows(gm, index),
      stories: views.map((v) => ({
        id: v.id,
        holder: v.repo ?? null,
        team: v.team ?? null,
        status: v.status,
        ticket: v.ticket ?? null,
        freshness: v.freshness,
        reason: v.reason,
        copy: v.copy,
        delivery: v.delivery,
        intent: v.intent,
        awaiting: v.awaiting,
        from: v.from ? { team: v.from.team, repo: v.from.repo, status: v.from.status ?? null } : null,
      })),
      counts,
    };
  });
}

/**
 * Write each assigned map's delivery.yaml into this group's repo, from the status just read: the
 * owner commits it, and the plans above read it. Offline reads write nothing (they're not fresh).
 * Returns the files written, or why none were (no origin remote names the group's repo path).
 */
export function writeSummaries(root: string, results: MapStatus[], now: Date = new Date()): { written: string[]; skipped?: string } {
  const todo = results.filter((r) => r.assigned && !r.offline);
  if (!todo.length) return { written: [] };
  const owner = ownRepo(root);
  if (!owner) return { written: [], skipped: "no origin remote to take the group's repo path from, so delivery.yaml isn't written" };
  const read_at = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    written: todo.map((r) => {
      const summary: DeliverySummary = {
        format_version: 1,
        map: r.map,
        owner,
        read_at,
        stories: r.stories.map((s) => ({
          id: s.id,
          team: s.holder ?? "none",
          status: s.status,
          approval: r.approvers[s.id] ? "approved" : "none",
          ...(r.approvers[s.id] ? { approved_by: r.approvers[s.id] } : {}),
          read_at,
        })),
      };
      return writeDeliverySummary(join(root, "maps", r.map), summary);
    }),
  };
}

/** The --json object: one map's status, or { maps } when several were read. */
export const statusJson = (rs: MapStatus[]) => {
  const plain = rs.map(({ approvers: _approvers, ...rest }) => rest);
  return plain.length === 1 ? plain[0] : { maps: plain };
};

/** What a story's status column says: its status, and why it isn't current when it isn't. */
function statusCell(s: StoryRow): string {
  if (s.freshness === "current" && isDone(s.status)) return s.reason;
  // A story the group held itself (--repo .) has no team status to show: the move is the news.
  if (s.freshness === "moved" && s.from?.repo === ".") return "moved from this group";
  if (s.freshness === "moved") return `moved from ${s.from?.team ?? "?"}: ${s.from?.status ?? "no status"}`;
  if (s.freshness === "not-fetched") return `${s.status} (not fetched)`;
  if (s.freshness === "changed" || s.freshness === "behind" || s.freshness === "unverified") return `${s.status} (${s.freshness})`;
  return s.status;
}

/** One map's status as lines for a terminal. */
export function formatMapStatus(r: MapStatus): string {
  if (!r.assigned) return `No teams assigned to ${r.map}: run nikos assign "<team>" --repo <path> --map ${r.map}`;
  const out: string[] = [];
  const stories = r.stories.length;
  const teams = r.teams.filter((t) => t.repo !== ".").length;
  const at = r.group.commit ? ` at ${r.group.commit.slice(0, 7)}` : "";
  out.push(`Map ${r.map} in ${r.group.repo}${at} (${stories} ${stories === 1 ? "story" : "stories"}, ${teams} ${teams === 1 ? "team" : "teams"})`);
  if (r.offline) {
    const dates = r.teams.map((t) => t.fetched).filter((d): d is string => !!d).sort();
    out.push(`offline: showing copies fetched ${dates[0] ?? "(none yet)"}`);
  }
  out.push("", "Teams");
  const width = Math.max(...r.teams.map((t) => t.team.length), 0);
  for (const t of r.teams) out.push(`  ${t.team.padEnd(width)}  ${t.repo.padEnd(repoWidth(r.teams))}  ${teamLine(t, r.offline)}`);

  out.push("", "Stories");
  const rows = r.stories.map((s) => [s.id, s.team ?? "-", statusCell(s), s.ticket ?? "-", s.delivery, s.intent]);
  const head = ["STORY", "TEAM", "STATUS", "TICKET", "DELIVERY", "INTENT"];
  const cols = head.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const line = (cells: string[]) => `  ${cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(cols[i]))).join("  ")}`.trimEnd();
  out.push(line(head));
  for (const row of rows) out.push(line(row));

  const attention = r.stories.filter((s) => (s.freshness !== "current" && s.freshness !== "in-place") || s.awaiting);
  if (attention.length) {
    out.push("", "Needs attention");
    for (const s of attention) out.push(`  ${s.id}  ${s.team ?? "-"}  ${s.reason}`);
  }
  return out.join("\n");
}

const repoWidth = (teams: TeamRow[]) => Math.max(...teams.map((t) => t.repo.length), 0);

/** A team's state in the Teams section: when its copy was fetched, or why it's old or missing. */
function teamLine(t: TeamRow, offline: boolean): string {
  if (t.repo === ".") return "this group (--repo .)";
  const tail = t.retired ? "; retired: no stories left, read for the stories it gave up" : "";
  if (t.commit && t.ok) return `${offline ? "copy from" : "fetched"} ${t.fetched} at ${short(t.commit)}${tail}`;
  if (t.commit) return `fetch failed: ${t.error ?? "unknown"}; showing copy from ${t.fetched} at ${short(t.commit)}${tail}`;
  if (t.error) return `fetch failed: ${t.error}${tail}`;
  return `not fetched yet: run nikos map status without --offline${tail}`;
}

/** `nikos map status [--map <id>] [--offline] [--json]`. Exit 0 even when a team can't be fetched. */
export function runMapStatus(args: string[]): number {
  const flag = (n: string) => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const dir = resolve(flag("--dir") ?? process.cwd());
  try {
    const results = mapStatus(dir, { map: flag("--map"), offline: args.includes("--offline") });
    // --json only reports: it writes nothing, so a piped run leaves the owner's tree as it was.
    if (args.includes("--json")) {
      console.log(JSON.stringify(statusJson(results), null, 2));
      return 0;
    }
    console.log(results.map(formatMapStatus).join("\n\n"));
    const { written, skipped } = writeSummaries(dir, results);
    for (const p of written) console.log(`\nWrote ${p}: commit it, so the plans above show this delivery`);
    if (skipped) console.log(`! ${skipped}`);
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
