// `nikos tickets`: how a story map becomes tracker issues and epics (Jira's shape). nikOS never calls the
// tracker: it exports a file, the agent creates or updates the issues through the tracker's own MCP, and
// `nikos tickets keys` records the keys they got. The mapping is maps/<key>/tickets.yaml: the rules, the
// changes made by hand, and the epics' keys. A story's issue key is its ticket in state.yaml, the same link
// `nikos tracker` uses, so sync and record keep working when several stories share one issue.
import { join } from "node:path";
import { isMap, isSeq, parse, parseDocument, YAMLMap, YAMLSeq, type Document } from "yaml";
import { resolveStoryMap, type StoryMapRef } from "../lib/maps.js";
import { read } from "../lib/project.js";
import { contractVersion, schemaProblems } from "../lib/schema.js";
import { resolveSettings } from "../lib/settings.js";
import { loadStates } from "../lib/state-files.js";
import { store } from "../lib/store.js";
import { storyMapOfRef, type MapStory, type StoryMap } from "./map.js";
import { linkTicket } from "./tracker.js";
import { slugify } from "./init.js";
import { checkHash, hash } from "../planning/model.js";

export const TICKETS_FILE = "tickets.yaml";
const yamlOpts = { lineWidth: 0, flowCollectionPadding: false };
/** A tracker key, as Jira writes them: PAY-123. */
const KEY = /^[A-Z][A-Z0-9_]*-[0-9]+$/;

export interface TicketFields {
  issueType: string;
  epicType: string;
  label: string;
  component: string;
  /** labels, or a custom field's id (customfield_10042) that gets the story ids. */
  storyIds: string;
}

export interface TicketEpic {
  /** activity:<id>, release:<n>, or the id of one made by hand. Also its ref in the export. */
  id: string;
  title: string;
  key?: string;
}

export interface TicketIssue {
  /** Its first story's id: stable across exports, and what `tickets keys` reads back. */
  ref: string;
  stories: MapStory[];
  summary: string;
  /** The epic's id, or undefined for none. */
  epic?: string;
  key?: string;
  /** Other keys its stories are linked to: they were separate issues before they were combined. */
  otherKeys: string[];
  releases: number[];
}

export interface Tickets {
  ref: StoryMapRef;
  system: string;
  project: string;
  site: string;
  rules: { issues: "story" | "step"; epics: "activity" | "release" | "none" };
  fields: TicketFields;
  epics: TicketEpic[];
  issues: TicketIssue[];
  /** Problems worth a word that don't stop an export, e.g. a combined issue whose stories had two keys. */
  warnings: string[];
}

interface TicketsFile {
  rules?: { issues?: "story" | "step"; epics?: "activity" | "release" | "none" };
  fields?: { issue_type?: string; epic_type?: string; label?: string; component?: string; story_ids?: string };
  issues?: { stories: string[]; summary?: string; epic?: string }[];
  epics?: { id: string; title?: string; key?: string }[];
}

const pathOf = (ref: StoryMapRef) => join(ref.dir, TICKETS_FILE);

/** tickets.yaml as data, checked against its schema; an empty mapping when the map has none yet. */
export function readTicketsFile(ref: StoryMapRef): TicketsFile {
  const path = pathOf(ref);
  if (!store().exists(path)) return {};
  let data: unknown;
  try {
    data = parse(read(path));
  } catch (err) {
    throw new Error(`maps/${ref.id}/${TICKETS_FILE} isn't valid YAML: ${(err as Error).message}`);
  }
  const newer = contractVersion(TICKETS_FILE, data, "format_version", "code");
  if (newer) throw new Error(newer);
  const problems = schemaProblems("tickets.schema.json", data);
  if (problems.length) throw new Error(`maps/${ref.id}/${TICKETS_FILE}: ${problems.join("; ")}`);
  return data as TicketsFile;
}

/** The map's stories in the order its issues are listed: release, then activity and step, then build order. */
function ordered(m: StoryMap): { story: MapStory; release: number }[] {
  const column = (s: MapStory) => {
    const a = m.activities.findIndex((x) => x.id === s.activity);
    const steps = a >= 0 ? m.activities[a].steps : [];
    const st = steps.findIndex((x) => x.id === s.step);
    return (a < 0 ? m.activities.length : a) * 1000 + (st < 0 ? 0 : st);
  };
  return m.releases.flatMap((r) =>
    r.stories
      .map((story, i) => ({ story, release: r.number, i }))
      .filter((x) => x.story.status !== "cancelled")
      .sort((x, y) => column(x.story) - column(y.story) || x.i - y.i)
      .map(({ story, release }) => ({ story, release })),
  );
}

/**
 * The map's issues and epics: the rules give each story an issue and each issue an epic, and tickets.yaml's
 * changes are laid over them. Cancelled stories and stories in no release get no issue.
 */
export function ticketsOf(dir: string, mapId?: string): Tickets {
  const ref = resolveStoryMap(dir, { map: mapId });
  const file = readTicketsFile(ref);
  const m = storyMapOfRef(ref);
  const s = resolveSettings(ref.root, { map: ref.dir });
  const rules = { issues: file.rules?.issues ?? "story", epics: file.rules?.epics ?? "activity" } as Tickets["rules"];
  const fields: TicketFields = {
    issueType: file.fields?.issue_type ?? "Story",
    epicType: file.fields?.epic_type ?? "Epic",
    label: file.fields?.label ?? "nikos",
    component: file.fields?.component ?? "",
    storyIds: file.fields?.story_ids ?? "labels",
  };
  const warnings: string[] = [];
  const stories = ordered(m);
  const releaseOf = new Map(stories.map((x) => [x.story.id, x.release]));
  const states = loadStates(ref.dir);
  const ticketOf = (id: string) => {
    const t = states[id]?.ticket;
    return typeof t === "string" && t ? t : undefined;
  };

  // Each story's group: a hand-made issue first, else the rule's.
  const handOf = new Map<string, number>();
  (file.issues ?? []).forEach((entry, i) => {
    for (const id of entry.stories) {
      if (!releaseOf.has(id)) continue; // validate names stories the map no longer has
      if (handOf.has(id)) warnings.push(`${id} is in more than one issue in ${TICKETS_FILE}: the first one counts`);
      else handOf.set(id, i);
    }
  });
  const groupOf = (x: { story: MapStory; release: number }) =>
    handOf.has(x.story.id) ? `hand:${handOf.get(x.story.id)}` : rules.issues === "step" ? `step:${x.release}:${x.story.activity}/${x.story.step}` : `story:${x.story.id}`;

  const byGroup = new Map<string, { story: MapStory; release: number }[]>();
  for (const x of stories) {
    const g = groupOf(x);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(x);
  }

  const handEpics = new Map((file.epics ?? []).map((e) => [e.id, e]));
  const activityTitle = (id: string) => m.activities.find((a) => a.id === id)?.title ?? id;
  const stepTitle = (story: MapStory) => m.activities.find((a) => a.id === story.activity)?.steps.find((st) => st.id === story.step)?.title ?? activityTitle(story.activity);
  const epicTitle = (id: string): string => {
    const own = handEpics.get(id)?.title;
    if (own) return own;
    if (id.startsWith("activity:")) return activityTitle(id.slice(9));
    if (id.startsWith("release:")) {
      const r = m.releases.find((x) => x.number === Number(id.slice(8)));
      return r ? `Release ${r.number} · ${r.title}` : id;
    }
    return id;
  };

  const issues: TicketIssue[] = [...byGroup.entries()].map(([group, members]) => {
    const first = members[0];
    const entry = group.startsWith("hand:") ? file.issues![Number(group.slice(5))] : undefined;
    const ids = members.map((x) => x.story.id);
    const summary =
      entry?.summary ??
      (members.length === 1 ? first.story.title : group.startsWith("step:") ? `${stepTitle(first.story)} (R${first.release})` : `${first.story.title} and ${members.length - 1} more`);
    const ruleEpic = rules.epics === "activity" ? `activity:${first.story.activity}` : rules.epics === "release" ? `release:${first.release}` : undefined;
    const epic = entry?.epic === "none" ? undefined : (entry?.epic ?? ruleEpic);
    const keys = [...new Set(ids.map(ticketOf).filter((k): k is string => !!k))];
    if (keys.length > 1) warnings.push(`${ids.join(", ")} are one issue but linked to ${keys.join(" and ")}: the export updates ${keys[0]}, so close the others in the tracker`);
    return { ref: first.story.id, stories: members.map((x) => x.story), summary, epic, key: keys[0], otherKeys: keys.slice(1), releases: [...new Set(members.map((x) => x.release))] };
  });

  // The epics in use, in the order their first issue comes, then hand-made ones no issue uses yet.
  const used = [...new Set(issues.map((i) => i.epic).filter((e): e is string => !!e))];
  for (const id of handEpics.keys()) if (!used.includes(id) && !id.includes(":")) used.push(id);
  const epics = used.map((id) => ({ id, title: epicTitle(id), ...(handEpics.get(id)?.key ? { key: handEpics.get(id)!.key } : {}) }));

  return {
    ref,
    system: String(s["tracker.system"].value),
    project: String(s["tracker.project"].value),
    site: String(s["tracker.site"].value),
    rules,
    fields,
    epics,
    issues,
    warnings,
  };
}

/** One issue's description: each story's sentence and its acceptance criteria, as the feature files say them. */
function describe(issue: TicketIssue, mapId: string): string {
  return issue.stories
    .map((st) => {
      const criteria = st.criteria.filter((c) => !/^<.*>$/.test(c.title.trim()));
      const lines = [`${st.id} ${st.title}`];
      if (st.narrative && !/<[^>]+>/.test(st.narrative)) lines.push(st.narrative);
      if (criteria.length) lines.push("Acceptance criteria:", ...criteria.map((c) => `- ${c.title}`));
      return lines.join("\n");
    })
    .concat([`From the story map in maps/${mapId}, the source for these stories: their scenarios decide when this is done.`])
    .join("\n\n");
}

/**
 * The file the agent reads: epics first, then issues, each to create (no key yet) or update (has one).
 * Refs are stable: an epic's id, and an issue's first story id.
 */
export function exportTickets(dir: string, mapId?: string) {
  const t = ticketsOf(dir, mapId);
  if (!t.project) throw new Error("Say which tracker project the issues go in first: nikos settings set tracker.project PAY");
  const labels = (ids: string[]) =>
    [...(t.fields.label ? [t.fields.label] : []), ...(t.fields.storyIds === "labels" ? ids.map((id) => `${t.fields.label ? `${t.fields.label}-` : ""}${id.toLowerCase()}`) : [])];
  const action = (key?: string) => (key ? "update" : "create");
  return {
    format: "nikos-tickets/1",
    map: `maps/${t.ref.id}`,
    tracker: { system: t.system, project: t.project, ...(t.site ? { site: t.site } : {}) },
    fields: { issueType: t.fields.issueType, epicType: t.fields.epicType },
    epics: t.epics.map((e) => ({ ref: e.id, action: action(e.key), ...(e.key ? { key: e.key } : {}), summary: e.title, labels: t.fields.label ? [t.fields.label] : [] })),
    issues: t.issues.map((i) => {
      const ids = i.stories.map((s) => s.id);
      return {
        ref: i.ref,
        action: action(i.key),
        ...(i.key ? { key: i.key } : {}),
        type: t.fields.issueType,
        summary: i.summary,
        epic: i.epic ?? null,
        stories: ids,
        release: i.releases.map((n) => `R${n}`).join(", "),
        description: describe(i, t.ref.id),
        labels: labels(ids),
        ...(t.fields.component ? { components: [t.fields.component] } : {}),
        ...(t.fields.storyIds !== "labels" ? { fields: { [t.fields.storyIds]: ids.join(", ") } } : {}),
      };
    }),
    ...(t.warnings.length ? { warnings: t.warnings } : {}),
  };
}

/** The keys the agent reports, as { ref: key }, or the exported file with each new item's key filled in. */
export function keysFrom(input: unknown): Record<string, string> {
  const obj = input as Record<string, unknown> | null;
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error('Give the keys as { "<ref>": "<key>" }, or the exported file with each key filled in');
  if (obj.format === "nikos-tickets/1") {
    const out: Record<string, string> = {};
    for (const item of [...((obj.epics as unknown[]) ?? []), ...((obj.issues as unknown[]) ?? [])] as { ref?: unknown; key?: unknown }[]) {
      if (typeof item?.ref === "string" && typeof item.key === "string" && item.key) out[item.ref] = item.key;
    }
    return out;
  }
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, String(v ?? "")]));
}

/**
 * Write the keys the agent reports: an issue's key links each of its stories to it in state.yaml (as nikos
 * tracker link does), and an epic's goes into tickets.yaml. Every ref must be one the map has now.
 */
export function recordKeys(dir: string, keys: Record<string, string>, mapId?: string) {
  const t = ticketsOf(dir, mapId);
  const issueOf = new Map<string, TicketIssue>();
  for (const i of t.issues) for (const s of i.stories) issueOf.set(s.id, i);
  const epicIds = new Set(t.epics.map((e) => e.id));
  const entries = Object.entries(keys);
  if (!entries.length) throw new Error("No keys given");
  for (const [ref, key] of entries) {
    if (!KEY.test(key)) throw new Error(`'${key}' (for ${ref}) isn't a tracker key like PAY-123`);
    if (!issueOf.has(ref) && !epicIds.has(ref)) throw new Error(`${ref} isn't an issue or epic in maps/${t.ref.id}: export again and use its refs`);
  }
  const linked: { ref: string; key: string; stories: string[] }[] = [];
  const epics: { ref: string; key: string }[] = [];
  for (const [ref, key] of entries) {
    const issue = issueOf.get(ref);
    if (issue) {
      for (const s of issue.stories) linkTicket({ id: s.id, ticket: key, map: t.ref.id }, t.ref.root);
      linked.push({ ref, key, stories: issue.stories.map((s) => s.id) });
    } else epics.push({ ref, key });
  }
  if (epics.length) writeEpicKeys(t.ref, epics);
  return { map: t.ref.id, issues: linked, epics };
}

/** Set each epic's key in tickets.yaml, making the file (or the epic's entry) when it has none yet. */
function writeEpicKeys(ref: StoryMapRef, keys: { ref: string; key: string }[]): void {
  const path = pathOf(ref);
  const doc = parseDocument(store().exists(path) ? read(path) : "format_version: 1\n");
  let list = doc.get("epics", true);
  if (!isSeq(list)) {
    doc.set("epics", doc.createNode([]));
    list = doc.get("epics", true);
  }
  const seq = list as YAMLSeq<YAMLMap>;
  for (const { ref: id, key } of keys) {
    const entry = seq.items.find((e) => isMap(e) && e.get("id") === id);
    if (entry) entry.set("key", key);
    else seq.add(doc.createNode({ id, key }));
  }
  store().write(path, doc.toString(yamlOpts));
}

/** The hash a page sends with an edit to tickets.yaml: the file's, or an empty file's when there is none yet. */
export function ticketsHash(ref: StoryMapRef): string {
  const path = pathOf(ref);
  return hash(store().exists(path) ? read(path) : "");
}

/**
 * Change tickets.yaml: check it is as the page read it, change it, and write it if it still fits the schema.
 * A map with no file gets one. Comments and the order of what isn't touched are kept.
 */
function editTickets(ref: StoryMapRef, expect: string | undefined, fn: (doc: Document) => void): void {
  const path = pathOf(ref);
  const exists = store().exists(path);
  if (expect) checkHash(`maps/${ref.id}/${TICKETS_FILE}`, exists ? read(path) : "", expect);
  const doc = parseDocument(exists ? read(path) : "format_version: 1\n");
  fn(doc);
  const problems = schemaProblems("tickets.schema.json", doc.toJS());
  if (problems.length) throw new Error(`That would leave ${TICKETS_FILE} with: ${problems.join("; ")}`);
  store().write(path, doc.toString(yamlOpts));
}

/** A list in tickets.yaml (issues or epics), made when it has none yet. */
function listOf(doc: Document, name: "issues" | "epics"): YAMLSeq<YAMLMap> {
  if (!isSeq(doc.get(name, true))) doc.set(name, doc.createNode([]));
  return doc.get(name, true) as YAMLSeq<YAMLMap>;
}
const storiesIn = (entry: YAMLMap): string[] => {
  const v = entry.get("stories", true);
  return isSeq(v) ? v.items.map((i: any) => String(i?.value ?? i)) : [];
};
const flowList = (doc: Document, ids: string[]) => {
  const node = doc.createNode(ids) as YAMLSeq;
  node.flow = true;
  return node;
};

/** The issue a ref names, as the map and tickets.yaml make it now. */
function issueAt(t: Tickets, ref: string): TicketIssue {
  const issue = t.issues.find((i) => i.ref === ref) ?? t.issues.find((i) => i.stories.some((s) => s.id === ref));
  if (!issue) throw new Error(`${ref} isn't on any issue in maps/${t.ref.id}: it is cancelled, or in no release`);
  return issue;
}

/** The hand entry an issue has, made from its stories when it has none, so a summary or epic can be set on it. */
function entryFor(doc: Document, issue: TicketIssue): YAMLMap {
  const list = listOf(doc, "issues");
  const found = list.items.find((e) => isMap(e) && storiesIn(e).includes(issue.ref));
  if (found) return found;
  const entry = doc.createNode({}) as YAMLMap;
  entry.set("stories", flowList(doc, issue.stories.map((s) => s.id)));
  list.add(entry);
  return entry;
}

/** Take stories out of the hand entries they are in, dropping entries left with none. */
function takeOut(doc: Document, ids: string[]): void {
  const list = listOf(doc, "issues");
  for (const entry of [...list.items]) {
    if (!isMap(entry)) continue;
    const left = storiesIn(entry).filter((id) => !ids.includes(id));
    if (left.length === storiesIn(entry).length) continue;
    if (left.length) entry.set("stories", flowList(doc, left));
    else list.items.splice(list.items.indexOf(entry), 1);
  }
}

/** Check an epic id against the map: an activity, a release, one made by hand, or none. */
function epicProblem(t: Tickets, file: TicketsFile, epic: string): string | undefined {
  const m = storyMapOfRef(t.ref);
  if (epic === "none") return undefined;
  if (epic.startsWith("activity:")) return m.activities.some((a) => a.id === epic.slice(9)) ? undefined : `The map has no activity ${epic.slice(9)}`;
  if (epic.startsWith("release:")) return m.releases.some((r) => String(r.number) === epic.slice(8)) ? undefined : `The map has no release ${epic.slice(8)}`;
  return (file.epics ?? []).some((e) => e.id === epic && e.title) ? undefined : `There is no epic ${epic}: make it first`;
}

/** Make stories one issue. They leave any issue they were in; an optional summary names it. */
export function combineIssue(dir: string, input: { map?: string; stories: string[]; summary?: string }, expect?: string) {
  const t = ticketsOf(dir, input.map);
  const ids = [...new Set(input.stories.map((x) => x.trim()).filter(Boolean))];
  if (ids.length < 2) throw new Error("Pick at least two stories to make one issue");
  const on = new Set(t.issues.flatMap((i) => i.stories.map((s) => s.id)));
  const off = ids.filter((id) => !on.has(id));
  if (off.length) throw new Error(`${off.join(", ")} ${off.length === 1 ? "isn't" : "aren't"} on any issue: cancelled, or in no release`);
  editTickets(t.ref, expect, (doc) => {
    takeOut(doc, ids);
    const entry = doc.createNode({}) as YAMLMap;
    entry.set("stories", flowList(doc, ids));
    if (input.summary?.trim()) entry.set("summary", input.summary.trim());
    listOf(doc, "issues").add(entry);
  });
  return { ref: ids[0], stories: ids };
}

/** Split an issue into one issue per story. Its summary and epic go with it; each story's issue follows the rules. */
export function splitIssue(dir: string, input: { map?: string; ref: string }, expect?: string) {
  const t = ticketsOf(dir, input.map);
  const issue = issueAt(t, input.ref);
  const ids = issue.stories.map((s) => s.id);
  if (ids.length < 2) throw new Error(`${issue.ref} is already one story's issue`);
  editTickets(t.ref, expect, (doc) => {
    takeOut(doc, ids);
    // The step rule would put them back together, so each gets an entry of its own.
    if (t.rules.issues === "step") for (const id of ids) listOf(doc, "issues").add(doc.createNode({ stories: flowList(doc, [id]) }));
  });
  return { stories: ids };
}

/** Give an issue its own summary; a blank one goes back to the summary the rules give it. */
export function renameIssue(dir: string, input: { map?: string; ref: string; summary: string }, expect?: string) {
  const t = ticketsOf(dir, input.map);
  const issue = issueAt(t, input.ref);
  const summary = input.summary.trim();
  editTickets(t.ref, expect, (doc) => {
    const entry = entryFor(doc, issue);
    if (summary) entry.set("summary", summary);
    else entry.delete("summary");
  });
  return { ref: issue.ref, summary };
}

/** Put an issue under another epic: an activity:, release: or hand-made epic's id, none, or blank for the rules' one. */
export function setIssueEpic(dir: string, input: { map?: string; ref: string; epic: string }, expect?: string) {
  const t = ticketsOf(dir, input.map);
  const issue = issueAt(t, input.ref);
  const epic = input.epic.trim();
  const problem = epic ? epicProblem(t, readTicketsFile(t.ref), epic) : undefined;
  if (problem) throw new Error(problem);
  editTickets(t.ref, expect, (doc) => {
    const entry = entryFor(doc, issue);
    if (epic) entry.set("epic", epic);
    else entry.delete("epic");
  });
  return { ref: issue.ref, epic: epic || undefined };
}

/** Make an epic by hand. Its id comes from its title. */
export function newEpic(dir: string, input: { map?: string; title: string }, expect?: string) {
  const ref = resolveStoryMap(dir, { map: input.map });
  const title = input.title?.trim();
  if (!title) throw new Error("An epic needs a title");
  const taken = new Set((readTicketsFile(ref).epics ?? []).map((e) => e.id));
  const base = slugify(title) || "epic";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  editTickets(ref, expect, (doc) => listOf(doc, "epics").add(doc.createNode({ id, title })));
  return { id, title };
}

/** Change the rules: how stories become issues, and what the epics are. Hand changes stay as they are. */
export function setTicketRules(dir: string, input: { map?: string; issues?: string; epics?: string }, expect?: string) {
  const ref = resolveStoryMap(dir, { map: input.map });
  if (input.issues !== undefined && !["story", "step"].includes(input.issues)) throw new Error("issues is story or step");
  if (input.epics !== undefined && !["activity", "release", "none"].includes(input.epics)) throw new Error("epics is activity, release or none");
  if (input.issues === undefined && input.epics === undefined) throw new Error("Give issues, epics, or both");
  editTickets(ref, expect, (doc) => {
    if (input.issues !== undefined) doc.setIn(["rules", "issues"], input.issues);
    if (input.epics !== undefined) doc.setIn(["rules", "epics"], input.epics);
  });
}

const FIELD_KEYS = { issue_type: "issueType", epic_type: "epicType", label: "label", component: "component", story_ids: "storyIds" } as const;

/** Change the fields the tracker gets. A blank component or label leaves it out; types can't be blank. */
export function setTicketFields(dir: string, input: { map?: string } & Partial<Record<keyof typeof FIELD_KEYS, string>>, expect?: string) {
  const ref = resolveStoryMap(dir, { map: input.map });
  const given = (Object.keys(FIELD_KEYS) as (keyof typeof FIELD_KEYS)[]).filter((k) => input[k] !== undefined);
  if (!given.length) throw new Error("Give at least one field to change");
  editTickets(ref, expect, (doc) => {
    for (const k of given) {
      const v = String(input[k]).trim();
      if ((k === "issue_type" || k === "epic_type") && !v) throw new Error(`${k === "issue_type" ? "The issue type" : "The epic type"} can't be blank`);
      if (k === "story_ids" && !/^(labels|customfield_[0-9]+)$/.test(v)) throw new Error("Story ids go in labels, or a custom field's id like customfield_10042");
      if (k === "component" && !v) doc.deleteIn(["fields", k]);
      else doc.setIn(["fields", k], v);
    }
  });
}

/** The problems with a map's tickets.yaml, for nikos validate: errors stop a save, warnings don't. */
export function ticketProblems(ref: StoryMapRef): { errors: string[]; warnings: string[] } {
  if (!store().exists(pathOf(ref))) return { errors: [], warnings: [] };
  let file: TicketsFile;
  try {
    file = readTicketsFile(ref);
  } catch (err) {
    return { errors: [(err as Error).message.replace(`maps/${ref.id}/${TICKETS_FILE}: `, "")], warnings: [] };
  }
  const m = storyMapOfRef(ref);
  const inMap = new Set(m.releases.flatMap((r) => r.stories.map((s) => s.id)));
  const activities = new Set(m.activities.map((a) => a.id));
  const releases = new Set(m.releases.map((r) => r.number));
  const handEpics = new Set((file.epics ?? []).map((e) => e.id));
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const entry of file.issues ?? []) {
    for (const id of entry.stories) {
      if (!inMap.has(id)) warnings.push(`issues names ${id}, which isn't in any release of the map: take it out of ${TICKETS_FILE}`);
      if (seen.has(id)) errors.push(`${id} is in more than one issue: keep each story in one`);
      seen.add(id);
    }
    const e = entry.epic;
    if (!e || e === "none") continue;
    if (e.startsWith("activity:") && !activities.has(e.slice(9))) errors.push(`an issue names epic ${e}, but the map has no activity ${e.slice(9)}`);
    else if (e.startsWith("release:") && !releases.has(Number(e.slice(8)))) errors.push(`an issue names epic ${e}, but the map has no release ${e.slice(8)}`);
    else if (!e.includes(":") && !handEpics.has(e)) errors.push(`an issue names epic ${e}, which isn't in epics: add it there with a title`);
  }
  for (const e of file.epics ?? []) {
    if (!e.id.includes(":") && !e.title) errors.push(`epic ${e.id} needs a title`);
  }
  return { errors, warnings };
}

const USAGE = `Usage:
  nikos tickets                         the issues and epics the story map becomes
  nikos tickets export [--out <file>]   the file for your agent: epics, then issues, to create or update
  nikos tickets keys <file>             record the keys the tracker gave: { "<ref>": "<key>" }, or the export with keys filled in
Each takes --map when the repo has more than one story map.`;

export function runTickets(args: string[]): number {
  const [sub, ...rest] = args;
  const flag = (n: string) => {
    const i = rest.indexOf(`--${n}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const positional = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1].startsWith("--")));
  const dir = flag("dir") ?? process.cwd();
  const map = flag("map");
  try {
    if (sub === undefined || sub === "show") {
      const t = ticketsOf(dir, map);
      const stories = t.issues.reduce((n, i) => n + i.stories.length, 0);
      console.log(`maps/${t.ref.id}: ${stories} stories → ${t.issues.length} issues in ${t.epics.length} epics${t.project ? ` (${t.system} ${t.project})` : ""}`);
      for (const e of [...t.epics.map((x) => x.id), undefined]) {
        const own = t.issues.filter((i) => i.epic === e);
        if (!own.length) continue;
        const epic = e ? t.epics.find((x) => x.id === e)! : undefined;
        console.log(`\n${epic ? `${epic.title}${epic.key ? ` (${epic.key})` : ""}` : "No epic"}`);
        for (const i of own) console.log(`  ${i.key ?? "new"}  ${i.summary}  [${i.stories.map((s) => s.id).join(", ")}]`);
      }
      for (const w of t.warnings) console.log(`! ${w}`);
    } else if (sub === "export") {
      const out = JSON.stringify(exportTickets(dir, map), null, 2) + "\n";
      if (flag("out")) {
        store().write(flag("out")!, out, { create: true });
        console.log(`Wrote ${flag("out")}. Give it to your agent to create or update the issues with the tracker's MCP, then record the keys with nikos tickets keys.`);
      } else process.stdout.write(out);
    } else if (sub === "keys" && positional[0]) {
      const r = recordKeys(dir, keysFrom(JSON.parse(read(positional[0]))), map);
      for (const i of r.issues) console.log(`${i.key} ↔ ${i.stories.join(", ")}`);
      for (const e of r.epics) console.log(`${e.key} ↔ epic ${e.ref}`);
    } else {
      console.error(USAGE);
      return 1;
    }
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
