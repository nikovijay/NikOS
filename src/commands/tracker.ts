// `nikos tracker`: keep a story map and a repo's tracker (Jira, Linear, GitHub or GitLab issues…)
// in step. nikOS never calls a tracker itself: the agent reads and writes tickets through the
// tracker's own MCP, and hands what it read to these commands, which apply the rules:
// - a ticket can approve a story (when tracker.approvals is on) or cancel it, never mark it
//   done: done still means the story's scenarios pass;
// - for everything else, nikOS says which tickets should move, and the agent moves them.
import { resolveStoryMap, type StoryMapRef } from "../lib/maps.js";
import { STORY_ID } from "../lib/project.js";
import { resolveSettings } from "../lib/settings.js";
import { store } from "../lib/store.js";
import { noEntry, storyState, updateStory } from "../lib/state-files.js";
import { approve } from "./approve.js";
import { storyMapOfRef } from "./map.js";
import { setState, StateError } from "./state.js";
import { newStory } from "./story.js";
import { newActivity } from "./step.js";

export type NikosStatus = "todo" | "in_progress" | "needs_rework" | "done" | "approved" | "cancelled";

/** The tracker settings that apply here. */
function trackerOf(root: string) {
  const s = resolveSettings(root);
  return {
    system: s["tracker.system"].value as string,
    statuses: s["tracker.statuses"].value as Record<string, NikosStatus>,
    approvals: s["tracker.approvals"].value as boolean,
  };
}

/** Link a story to its ticket (e.g. PAY-123, ENG-42, #57), in the map's state.yaml. */
export function linkTicket(input: { id: string; ticket: string; map?: string }, dir: string) {
  if (!STORY_ID.test(input.id)) throw new Error(`'${input.id}' is not a story id (expected e.g. HT-1 or PAY-CHK-12)`);
  const ticket = input.ticket.trim();
  if (!ticket) throw new Error("Give the ticket's key or number, e.g. PAY-123");
  const ref = resolveStoryMap(dir, { story: input.id, map: input.map });
  const home = ref.dir;
  updateStory(
    home,
    input.id,
    (doc, at) => {
      // A first link creates the story's status file, which starts at todo.
      if (!doc.getIn([...at, "status"])) doc.setIn([...at, "status"], "todo");
      doc.setIn([...at, "ticket"], ticket);
    },
    { create: true },
  );
  return { id: input.id, ticket };
}

export interface RecordResult {
  id: string;
  ticket?: string;
  /** What the tracker's status means to nikOS. */
  means: NikosStatus;
  /** What nikOS did about it. */
  outcome: "approved" | "cancelled" | "in step" | "differs" | "ignored";
  message: string;
}

/**
 * Record what a story's ticket says, as the agent read it from the tracker. Approved (when
 * tracker.approvals is on) approves the story; cancelled cancels it; anything else is only
 * compared, because nikOS's own status comes from the story's scenarios.
 */
export function recordTicket(input: { id: string; status: string; by?: string; on?: string; map?: string }, dir: string): RecordResult {
  const ref = resolveStoryMap(dir, { story: input.id, map: input.map });
  const root = ref.root;
  const t = trackerOf(root);
  if (t.system === "none") throw new Error("No tracker is set up here: set tracker.system first (nikos settings set tracker.system jira)");
  const means = t.statuses[input.status];
  if (!means) {
    throw new Error(`'${input.status}' isn't mapped to a nikOS status. Mapped: ${Object.keys(t.statuses).join(", ") || "none"}. Map it first: nikos settings set tracker.statuses '{"${input.status}": "done"}'`);
  }
  const story = storyMapOfRef(ref).releases.flatMap((r) => r.stories).find((s) => s.id === input.id);
  if (!story) throw new Error(`${input.id} is not in any release in storymap.yaml`);
  const ticket = storyTicket(ref, input.id);
  const base = { id: input.id, ...(ticket ? { ticket } : {}), means };

  if (means === "approved") {
    if (!t.approvals) return { ...base, outcome: "ignored", message: `${t.system} says approved, but tracker approvals don't count here (tracker.approvals is off)` };
    if (story.status === "approved") return { ...base, outcome: "in step", message: `${input.id} is already approved` };
    if (!input.by) throw new Error(`Say who moved the ticket to '${input.status}' (--by), as the tracker's history shows it`);
    approve(input.id, { dir, map: input.map, by: input.by, date: input.on, via: "tracker" });
    return { ...base, outcome: "approved", message: `${input.id} approved by ${input.by} in ${t.system}${ticket ? ` (${ticket})` : ""}` };
  }
  if (means === "cancelled") {
    if (story.status === "cancelled") return { ...base, outcome: "in step", message: `${input.id} is already cancelled` };
    setState(input.id, "cancelled", { dir, map: input.map, reason: `Cancelled in ${t.system}${ticket ? ` (${ticket})` : ""}${input.by ? ` by ${input.by}` : ""}`, date: input.on });
    return { ...base, outcome: "cancelled", message: `${input.id} cancelled, as ${t.system} says` };
  }
  const nikos = story.status === "approved" ? "done" : story.status;
  if (nikos === means) return { ...base, outcome: "in step", message: `${input.id} is ${means} in both` };
  return {
    ...base,
    outcome: "differs",
    message: `${t.system} says ${means} but nikOS says ${nikos}. nikOS's status comes from the story's scenarios, so move the ticket to match (nikos tracker sync lists the status to move it to)`,
  };
}

function storyTicket(ref: StoryMapRef, id: string): string | undefined {
  const v = storyState(ref.dir, id)?.ticket;
  return typeof v === "string" ? v : undefined;
}

export interface TicketMove {
  id: string;
  ticket: string;
  nikos: NikosStatus;
  /** The tracker status the ticket should have: the first one mapped to the story's status. */
  status: string;
}

/** For each linked story, the tracker status its ticket should be in. The agent moves the tickets. */
export function ticketMoves(dir: string, mapId?: string): TicketMove[] {
  const ref = resolveStoryMap(dir, { map: mapId });
  const t = trackerOf(ref.root);
  const stories = storyMapOfRef(ref).releases.flatMap((r) => r.stories);
  const statusFor = (s: NikosStatus) => Object.entries(t.statuses).find(([, v]) => v === s)?.[0] ?? (s === "approved" ? Object.entries(t.statuses).find(([, v]) => v === "done")?.[0] : undefined);
  const out: TicketMove[] = [];
  for (const s of stories) {
    const ticket = storyTicket(ref, s.id);
    const status = statusFor(s.status as NikosStatus);
    if (ticket && status) out.push({ id: s.id, ticket, nikos: s.status as NikosStatus, status });
  }
  return out;
}

export interface ImportedTicket {
  /** The ticket's key or number, e.g. PAY-123. */
  key: string;
  title: string;
  /** The epic, project or label it belongs to: it becomes the story's activity. */
  group?: string;
}

/**
 * Bring a tracker's backlog into the story map: each ticket becomes a story (in the last
 * release, or release), linked to its ticket, with its group as the activity. Tickets already
 * linked are skipped. Stories start as todo: their scenarios still have to be written.
 */
export function importTickets(tickets: ImportedTicket[], dir: string, opts: { release?: number; map?: string } = {}) {
  // Tickets become stories, which are authored in the repo's own map.
  const ref = resolveStoryMap(dir, { map: opts.map });
  const linked = new Set(storyMapOfRef(ref).releases.flatMap((r) => r.stories).map((s) => storyTicket(ref, s.id)).filter(Boolean));
  const added: { id: string; ticket: string }[] = [];
  const skipped: string[] = [];
  for (const t of tickets) {
    if (!t?.key || !t?.title) throw new Error("Each ticket needs a key and a title");
    if (linked.has(t.key)) {
      skipped.push(t.key);
      continue;
    }
    const activity = newActivity({ title: t.group?.trim() || "Backlog", map: opts.map }, dir);
    let story;
    try {
      story = newStory({ title: t.title, activity, release: opts.release, map: opts.map }, dir);
    } catch (err) {
      // Two tickets with the same title in one group: tell them apart by key.
      if (!/already exists/.test((err as Error).message)) throw err;
      story = newStory({ title: `${t.title} (${t.key})`, activity, release: opts.release, map: opts.map }, dir);
    }
    linkTicket({ id: story.id, ticket: t.key, map: opts.map }, dir);
    linked.add(t.key);
    added.push({ id: story.id, ticket: t.key });
  }
  return { added, skipped };
}

const USAGE = `Usage:
  nikos tracker link <story-id> <ticket>
  nikos tracker record <story-id> --status "<tracker status>" [--by "<who moved it>"] [--on <date>]
  nikos tracker sync [--json]          which tickets should move, and to what
  nikos tracker import <tickets.json> [--release <n>]   [{ "key", "title", "group" }]`;

export function runTracker(args: string[]): number {
  const [sub, ...rest] = args;
  const flag = (n: string) => {
    const i = rest.indexOf(`--${n}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const positional = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1].startsWith("--")));
  const dir = flag("dir") ?? process.cwd();
  try {
    if (sub === "link" && positional[1]) {
      const r = linkTicket({ id: positional[0], ticket: positional[1], map: flag("map") }, dir);
      console.log(`${r.id} ↔ ${r.ticket}`);
    } else if (sub === "record" && positional[0] && flag("status")) {
      const r = recordTicket({ id: positional[0], status: flag("status")!, by: flag("by"), on: flag("on"), map: flag("map") }, dir);
      console.log(`${r.outcome === "differs" ? "!" : "✓"} ${r.message}`);
    } else if (sub === "sync") {
      const moves = ticketMoves(dir, flag("map"));
      if (rest.includes("--json")) console.log(JSON.stringify(moves, null, 2));
      else for (const m of moves) console.log(`${m.ticket} → ${m.status}  (${m.id} is ${m.nikos})`);
    } else if (sub === "import" && positional[0]) {
      const tickets = JSON.parse(store().read(positional[0]));
      const r = importTickets(tickets, dir, { release: flag("release") ? Number(flag("release")) : undefined, map: flag("map") });
      for (const a of r.added) console.log(`+ ${a.id} ↔ ${a.ticket}`);
      if (r.skipped.length) console.log(`Already linked: ${r.skipped.join(", ")}`);
    } else {
      console.error(USAGE);
      return 1;
    }
    return 0;
  } catch (err) {
    console.error(`✗ ${err instanceof StateError ? err.message : (err as Error).message}`);
    return 1;
  }
}
