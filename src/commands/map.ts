// The story map: activities as columns, releases as numbered bands, stories as cards tinted
// by state.yaml. Read-only and script-free: the page has nothing to edit and runs no code, so
// it can be shared as a file. Selecting a story opens its panel with :target, in CSS alone.
// Served live by nikos serve, it also gets a filter bar (see FILTER_JS).
import { loadStates } from "../lib/state-files.js";
import { THEME_BUTTON, THEME_CSS, THEME_HEAD } from "../lib/theme.js";
import { writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { parse, stringify } from "yaml";
import { approvalLapse, loadApprovals } from "../lib/approvals.js";
import { store } from "../lib/store.js";
import { oldLayoutProblem } from "../plan/repo.js";
import { isPlanRepo } from "../planning/model.js";
import { featureStoryIds, featureTags, isDone, read, specHash, walk } from "../lib/project.js";
import { BET_ID, CROSS_REF } from "../lib/bets.js";
import { OWNER, mapDirs, resolveStoryMap, storyPrefix, type StoryMapRef } from "../lib/maps.js";
import { writeMapSummary } from "../lib/map-summary.js";
import { KEY } from "../lib/keys.js";
import { runMapStatus } from "./map-status.js";
import { SAVE_BAR_CSS } from "../lib/save-bar.js";
import { EDIT_CSS, EDIT_JS, addActivityBox, addReleaseBox, addStepBox, addStoryBox, addStoryDialog, editDataOf, releaseTools, storyEditArea, type EditData } from "./map-edit.js";
import { DESIGN_CSS } from "../lib/design.js";
import { next } from "./next.js";

export interface MapCriterion {
  id: string;
  title: string;
  priority: string;
}
export interface MapStory {
  id: string;
  title: string;
  activity: string;
  /** The step within the activity, or "" when the story has none. */
  step: string;
  status: string;
  blocked: boolean;
  priority: string;
  effort: string;
  /** The user story sentence: As a…, I want…, So that…. */
  narrative: string;
  criteria: MapCriterion[];
  /** user_story (the default), technical or bug_risk, from a @type- tag. */
  type: string;
  personas: string[];
  dependsOn: string[];
  /** Dependencies that aren't done or approved yet. */
  waitingOn: string[];
  /** The feature changed after the story was done or approved. */
  specChanged: boolean;
  approvedBy: string;
  cancelledReason: string;
}
export interface MapRelease {
  number: number;
  title: string;
  goal: string;
  bets: string[];
  /** The bets this release names itself (not the map's one bet). A release that names any can't be removed. */
  ownBets: string[];
  stories: MapStory[];
}
export interface StoryMap {
  project: string;
  key: string;
  /** The team that owns the map, and the bet it delivers, when storymap.yaml names them. */
  owner?: string;
  bet?: string;
  personas: { id: string; title: string; description: string }[];
  activities: { id: string; title: string; steps: { id: string; title: string }[] }[];
  releases: MapRelease[];
  /** Stories with a feature file that no release names. */
  unreleased: MapStory[];
}

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const yamlAt = (path: string) => (store().exists(path) ? parse(read(path)) : undefined);
const PRIORITY = /@(must|should|could|wont)\b/;

type StateFields = "status" | "blocked" | "waitingOn" | "specChanged" | "approvedBy" | "cancelledReason";

/** One story's details from its feature file: title, tags, narrative and criteria. */
function featureStory(text: string, id: string): Omit<MapStory, StateFields> {
  const [head, body = ""] = text.split(/^\s*Feature:/m);
  const lines = body.split("\n");
  const narrative: string[] = [];
  for (const line of lines.slice(1)) {
    const t = line.trim();
    if (t.startsWith("@") || /^(Scenario|Background|Rule|Scenario Outline):/.test(t)) break;
    if (t) narrative.push(t);
  }
  const criteria: MapCriterion[] = [];
  let tags = "";
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("@")) tags = t;
    const m = /^Scenario(?: Outline)?:\s*(.+)$/.exec(t);
    if (!m) continue;
    const ac = /@(AC\d+)\b/.exec(tags)?.[1] ?? "";
    criteria.push({ id: ac, title: m[1].replace(/^AC\d+\s*[—–-]\s*/, ""), priority: PRIORITY.exec(tags)?.[1] ?? "" });
    tags = "";
  }
  return {
    id,
    title: lines[0]?.trim() || id,
    activity: /@activity-([a-z0-9-]+)/.exec(head)?.[1] ?? "",
    step: /@step-([a-z0-9-]+)/.exec(head)?.[1] ?? "",
    priority: PRIORITY.exec(head)?.[1] ?? "",
    effort: /@effort-([A-Za-z0-9]+)/.exec(head)?.[1] ?? "",
    narrative: narrative.map((l, i) => (i ? l.replace(/^So that\b/, "so that") : l)).join(", "),
    criteria,
    type: { technical: "technical", "bug-risk": "bug_risk" }[featureTags(text, "type")[0] ?? ""] ?? "user_story",
    personas: featureTags(text, "persona"),
    dependsOn: featureTags(text, "depends"),
  };
}

/** The story map as data: activities, releases with their bets, and every story's status. */
export function storyMapOf(dir: string, mapId?: string): StoryMap {
  const none: StoryMap = { project: "", key: "", personas: [], activities: [], releases: [], unreleased: [] };
  // Several maps and none picked, or no map at all: an empty map, so the dashboard and MCP still answer.
  if (!mapId && mapDirs(dir).length > 1) return none;
  if (!mapId && !mapDirs(dir).length && !store().exists(join(dir, "storymap.yaml"))) return none;
  return storyMapOfRef(resolveStoryMap(dir, { map: mapId }));
}

/** The story map a resolved reference points at: its storymap, features and every story's status. */
export function storyMapOfRef(ref: StoryMapRef): StoryMap {
  const mapDir = ref.dir;
  const map = yamlAt(join(mapDir, "storymap.yaml")) ?? {};
  const states: Record<string, { status?: string; blockers?: string[]; spec_hash?: string; done_at?: string; updated?: string; cancelled_reason?: string }> =
    loadStates(ref.dir);
  const approvals = loadApprovals(ref.dir);
  // Approved is shown as a status: done, plus an approval that still holds.
  const approvedBy = (id: string, hash?: string) => {
    const a = approvals[id];
    return a && !approvalLapse(a, states[id], hash) ? a.by : "";
  };
  const stateOf = (id: string, deps: string[], hash?: string) => {
    const st = states[id] ?? {};
    const by = approvedBy(id, hash);
    const status = by ? "approved" : st.status ?? "todo";
    return {
      status,
      blocked: (st.blockers ?? []).length > 0,
      waitingOn: isDone(status) || status === "cancelled" ? [] : deps.filter((d) => !isDone(states[d]?.status)),
      approvedBy: by,
      specChanged: isDone(status) && !!st.spec_hash && !!hash && st.spec_hash !== hash,
      cancelledReason: String(st.cancelled_reason ?? ""),
    };
  };
  const features = new Map<string, MapStory>();
  for (const file of walk(join(mapDir, "features"), ".feature")) {
    const text = read(file);
    const id = featureStoryIds(text)[0];
    if (!id) continue;
    const f = featureStory(text, id);
    features.set(id, { ...f, ...stateOf(id, f.dependsOn, specHash(text)) });
  }
  const story = (id: string): MapStory =>
    features.get(id) ?? {
      id, title: id, activity: "", step: "", priority: "", effort: "", narrative: "", criteria: [], type: "user_story", personas: [], dependsOn: [], ...stateOf(id, []),
    };
  const releases: MapRelease[] = (Array.isArray(map.releases) ? map.releases : []).map((r: any) => ({
    number: Number(r.number),
    title: String(r.title ?? `Release ${r.number}`),
    goal: String(r.goal ?? ""),
    // A map's one bet in bet: is delivered by each of its releases.
    bets: typeof map.bet === "string" ? [map.bet] : Array.isArray(r.bets) ? r.bets.map(String) : [],
    ownBets: Array.isArray(r.bets) ? r.bets.map(String) : [],
    stories: (Array.isArray(r.stories) ? r.stories : []).map((s: unknown) => story(String(s))),
  }));
  const placed = new Set(releases.flatMap((r) => r.stories.map((s) => s.id)));
  return {
    project: String(map.project ?? ""),
    key: String(map.key ?? ""),
    ...(typeof map.owner === "string" ? { owner: map.owner } : {}),
    ...(typeof map.bet === "string" ? { bet: map.bet } : {}),
    personas: (Array.isArray(map.personas) ? map.personas : []).map((p: any) => ({ id: String(p.id), title: String(p.title ?? p.id), description: String(p.description ?? "") })),
    activities: (Array.isArray(map.activities) ? map.activities : []).map((a: any) => ({
      id: String(a.id),
      title: String(a.title ?? a.id),
      steps: (Array.isArray(a.steps) ? a.steps : []).map((st: any) => ({ id: String(st.id), title: String(st.title ?? st.id) })),
    })),
    releases,
    unreleased: [...features.values()].filter((s) => !placed.has(s.id)),
  };
}

/**
 * Each status's tint class and the word shown on its card. Blocked wins over the status, and a
 * changed spec wins over done or approved: what was proved is no longer what the feature says.
 */
const STATUS: Record<string, { cls: string; word: string }> = {
  todo: { cls: "todo", word: "to do" },
  in_progress: { cls: "doing", word: "in progress" },
  needs_rework: { cls: "rework", word: "rework" },
  done: { cls: "done", word: "done" },
  approved: { cls: "approved", word: "approved" },
  cancelled: { cls: "cancelled", word: "cancelled" },
};
const statusOf = (s: MapStory) =>
  s.blocked ? { cls: "blocked", word: "blocked" } : s.specChanged ? { cls: "changed", word: "spec changed" } : STATUS[s.status] ?? STATUS.todo;
const TYPE_WORD: Record<string, string> = { technical: "Technical", bug_risk: "Bug risk" };
const pad = (n: number) => String(n).padStart(2, "0");

/** Each status's colour on the progress bar and its legend, from the shared tokens. */
const BAR: [cls: string, word: string, colour: string][] = [
  ["approved", "approved", "var(--good)"],
  ["done", "done", "color-mix(in srgb, var(--good) 45%, var(--surface-2))"],
  ["changed", "spec changed", "var(--warn)"],
  ["doing", "in progress", "var(--accent)"],
  ["rework", "rework", "var(--bad)"],
  ["blocked", "blocked", "color-mix(in srgb, var(--bad) 60%, var(--surface-2))"],
  ["todo", "to do", "var(--line-strong)"],
];

/** A stacked bar of the stories by status, with its legend. Cancelled stories are left out. */
export function progressBar(stories: MapStory[], legend = true): string {
  const live = stories.filter((s) => s.status !== "cancelled");
  const n = (cls: string) => live.filter((s) => statusOf(s).cls === cls).length;
  const parts = BAR.map(([cls, word, colour]) => ({ cls, word, colour, k: n(cls) })).filter((p) => p.k);
  const label = parts.map((p) => `${p.k} ${p.word}`).join(", ") || "no stories";
  const bar = `<div class="stack" role="img" aria-label="${esc(label)}">${parts.map((p) => `<i style="width:${((100 * p.k) / (live.length || 1)).toFixed(1)}%;background:${p.colour}"></i>`).join("")}</div>`;
  return legend ? `${bar}<div class="legend">${parts.map((p) => `<span><span class="sw" style="background:${p.colour}"></span>${p.k} ${esc(p.word)}</span>`).join("")}</div>` : bar;
}

/** The brand at the top of each page, with the repo it is for. */
export function brand(repo: string): string {
  return `<span class="brand"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="4" rx="1"/><path d="M6 12h4M6 16h4M14 12h4M14 16h4"/></svg></span><span class="brand-t">nikOS Spec<small>${esc(repo)}</small></span></span>`;
}

/** The commands that move a story on, by where it stands. */
function nextCommands(s: MapStory): string[] {
  if (!s.criteria.length || s.criteria.every((c) => /^<.*>$/.test(c.title.trim()))) return [`nikos clear ${s.id}`];
  if (s.specChanged) return [`nikos verify ${s.id}`];
  if (s.status === "done") return [`nikos approve ${s.id}`];
  if (["todo", "in_progress", "needs_rework"].includes(s.status)) return [`nikos clear ${s.id}`, `nikos verify ${s.id}`];
  return [`nikos show ${s.id}`];
}

/**
 * The whole story map as one standalone HTML page. live adds the filter bar, the Share dialog and their script,
 * for nikos serve. back: a link to the list of the repo's maps, for the live page of a repo with more than one.
 * token (with live, from nikos serve) makes the page editable: its save bar, and the edit forms of map-edit.ts.
 */
export function renderMap(dir: string, opts: { live?: boolean; map?: string; back?: string; token?: string } = {}): string {
  const m = storyMapOf(dir, opts.map);
  const ref = opts.token === undefined ? undefined : resolveStoryMap(dir, { map: opts.map });
  const edit: EditData | undefined = ref && editDataOf(ref);
  const repo = basename(resolve(dir));
  const several = mapDirs(dir).length > 1;
  // One column per step; an activity with no steps (or the "Other" bucket) gets one column.
  const known = new Set(m.activities.map((a) => a.id));
  const everything = [...m.releases.flatMap((r) => r.stories), ...m.unreleased];
  const groups = [
    ...m.activities,
    ...(everything.some((s) => !known.has(s.activity)) ? [{ id: "", title: "Other", steps: [] as { id: string; title: string }[] }] : []),
  ].map((a) => ({
    ...a,
    columns: a.steps.length
      ? a.steps.map((st) => ({ key: `${a.id}/${st.id}`, label: `${a.title} · ${st.title}`, activity: a.id, step: st.id }))
      : [{ key: `${a.id}/`, label: a.title, activity: a.id, step: "" }],
  }));
  const columns = groups.flatMap((g) => g.columns);
  const columnOf = (s: MapStory) => {
    const g = groups.find((x) => x.id === (known.has(s.activity) ? s.activity : ""))!;
    return g.columns.find((c) => c.key === `${g.id}/${s.step}`)?.key ?? g.columns[0].key;
  };
  const hasSteps = m.activities.some((a) => a.steps.length);
  let upNext: { story?: string; open: { id: string; status: string }[] } = { open: [] };
  try {
    if (m.releases.length) upNext = next(dir, opts.map);
  } catch {
    // A map next can't read shows no "Next to build".
  }
  const card = (s: MapStory, release?: number) => {
    const st = statusOf(s);
    const musts = s.criteria.filter((c) => c.priority === "must").length;
    const foot = s.waitingOn.length
      ? `<span class="wait">Waits on ${esc(s.waitingOn.join(", "))}</span>`
      : s.criteria.length
        ? `<span>${s.criteria.length} ${s.criteria.length === 1 ? "criterion" : "criteria"}${musts ? ` · ${musts} must` : ""}</span>`
        : `<span class="warn">No criteria</span>`;
    const type = TYPE_WORD[s.type] ? `<span class="stype">${TYPE_WORD[s.type]}</span>` : "";
    const nextTag = upNext.story === s.id ? `<span class="next-tag">Next to build</span>` : "";
    // data- attributes let the live dashboard filter cards; the exported page ignores them.
    const data = `data-story="${esc(s.id)}" data-status="${esc(st.cls)}" data-type="${esc(s.type)}" data-personas="${esc(s.personas.join(" "))}" data-search="${esc(`${s.id} ${s.title} ${s.narrative}`.toLowerCase())}"`;
    const drag = edit && release !== undefined ? ' draggable="true"' : "";
    return `<a class="card ${st.cls}" ${data}${upNext.story === s.id ? " data-next" : ""}${drag} href="#story-${esc(s.id)}"><span class="crow"><span class="sid">${esc(s.id)}</span>${type}<span class="sword">${esc(st.word)}</span></span><span class="stitle">${esc(s.title)}</span><span class="cfoot">${foot}${nextTag}</span></a>`;
  };
  const tally = (stories: MapStory[]) => {
    const live = stories.filter((s) => s.status !== "cancelled");
    const n = (f: (s: MapStory) => boolean) => live.filter(f).length;
    const approved = n((s) => s.status === "approved");
    const parts = [
      `${n((s) => isDone(s.status))} of ${live.length} done`,
      ...(approved ? [`${approved} approved`] : []),
      `${n((s) => s.status === "in_progress")} in progress`,
      `${n((s) => s.status === "todo")} to do`,
    ];
    const warn = [[n((s) => s.blocked), "blocked"], [n((s) => s.specChanged), "spec changed"]] as const;
    return parts.join(" · ") + warn.map(([k, w]) => (k ? ` · <span class="warn">${k} ${w}</span>` : "")).join("");
  };
  // release is the band's release: a story added from its cells goes into that release. The unreleased band has none.
  const band = (id: string, code: string, heading: string, goal: string, bets: string[], stories: MapStory[], release?: MapRelease) => {
    const live = stories.filter((s) => s.status !== "cancelled");
    const shipped = live.length > 0 && live.every((s) => isDone(s.status) && !s.specChanged);
    const chips = bets.map((b) => `<span class="bet">${esc(b)}</span>`).join("");
    const cells = columns
      .map((c) => {
        const add = edit && c.activity ? addStoryBox({ activity: c.activity, step: c.step, where: `${c.label}${release ? `, release ${release.number}` : ", not in a release"}`, release: release?.number, releases: m.releases, storymap: edit.storymap }) : "";
        return `<div class="cell" data-activity="${esc(c.label)}" data-activity-id="${esc(c.activity)}" data-step-id="${esc(c.step)}">${stories.filter((s) => columnOf(s) === c.key).map((s) => card(s, release?.number)).join("")}${add}</div>`;
      })
      .join("");
    const tools = edit && release ? releaseTools(release, m.releases.length, edit.storymap) : "";
    return `<section class="band" id="${esc(id)}" data-release="${esc(id)}"${release ? ` data-number="${release.number}"` : ""}><div class="divider"><span class="rnum">${esc(code)}</span><h2>${esc(heading)}</h2>${
      shipped ? `<span class="stamp">Shipped</span>` : ""
    }${tools}<span class="tally">${stories.length ? tally(stories) : "no stories"}</span><span class="rule"></span></div>${
      goal ? `<p class="goal">${esc(goal)}</p>` : ""
    }${
      chips ? `<div class="bets"><span class="eyebrow">Delivers</span>${chips}</div>` : ""
    }${stories.length ? "" : `<p class="empty">No stories yet.</p>`}${stories.length || edit ? `<div class="lane">${cells}</div>` : ""}</section>`;
  };
  const bands = m.releases.map((r) => band(`release-${r.number}`, pad(r.number), `Release ${r.number} · ${r.title}`, r.goal, r.bets, r.stories, r)).join("");
  const unreleased = m.unreleased.length ? band("unreleased", "--", "Not in a release", "", [], m.unreleased) : "";
  // The activities row ends with "+ Activity"; each activity's box has its "+ Step".
  const spine = `<div class="spine"><div class="activities">${groups
    .map((g) => `<div class="activity" style="--span:${g.columns.length}"><span class="eyebrow">Activity</span><strong>${esc(g.title)}</strong>${edit && g.id ? addStepBox({ id: g.id, title: g.title }, edit.storymap) : ""}</div>`)
    .join("")}${edit ? addActivityBox(edit.storymap) : ""}</div>${
    hasSteps ? `<div class="steps">${groups.map((g) => (g.steps.length ? g.steps.map((st) => `<div class="step">${esc(st.title)}</div>`).join("") : `<div class="step none"></div>`)).join("")}</div>` : ""
  }</div>`;
  const jumps = [
    ...m.releases.map((r) => `<a class="jump" href="#release-${r.number}"><span class="rcode">R${r.number}</span>${esc(r.title)}<span class="count">${r.stories.length}</span></a>`),
    ...(m.unreleased.length ? [`<a class="jump" href="#unreleased">Not in a release<span class="count">${m.unreleased.length}</span></a>`] : []),
  ].join("");
  const copy = (text: string) => (opts.live ? `<button type="button" class="copy" data-copy="${esc(text)}" aria-label="Copy: ${esc(text)}">Copy</button>` : "");
  const panel = (s: MapStory) => {
    const st = statusOf(s);
    const facts = [s.id, TYPE_WORD[s.type], s.priority, s.effort && `effort ${s.effort}`].filter(Boolean).map((f) => esc(f)).join(" · ");
    const persona = (id: string) => m.personas.find((p) => p.id === id)?.title ?? id;
    const release = m.releases.find((r) => r.stories.some((x) => x.id === s.id));
    const notes = [
      s.personas.length && `For ${s.personas.map(persona).join(", ")}`,
      s.dependsOn.length && `Depends on ${s.dependsOn.map((d) => (s.waitingOn.includes(d) ? `${d} (not done)` : d)).join(", ")}`,
      s.status === "approved" && `Approved by ${s.approvedBy || "someone"}`,
    ].filter(Boolean).map((n) => `<li>${esc(n)}</li>`).join("");
    const alerts = [
      s.specChanged && ["warn", `The feature changed after it was done, so its scenarios no longer prove it. Run them again: nikos verify ${s.id}`],
      s.blocked && ["bad", "Blocked. Its blockers are listed in state.yaml."],
      s.waitingOn.length && ["warn", `Waits on ${s.waitingOn.join(", ")}, which isn't done yet.`],
      s.status === "cancelled" && ["warn", `Cancelled: ${s.cancelledReason}`],
    ].filter(Boolean).map((a) => `<p class="alert ${(a as string[])[0]}">${esc((a as string[])[1])}</p>`).join("");
    const prompt = `Write the scenarios for ${s.id} "${s.title}" in maps/${m.key.toLowerCase() || "<key>"}, then run nikos clear ${s.id} and show me what it says.`;
    // A new story's feature file has a starter scenario in angle brackets until someone writes the real ones.
    const starter = s.criteria.length > 0 && s.criteria.every((c) => /^<.*>$/.test(c.title.trim()));
    const ask = `<p class="alert warn">No scenarios yet. Each scenario in the story's feature file is one criterion. Ask your agent to write them:</p><div class="code"><span>${esc(prompt)}</span>${copy(prompt)}</div>`;
    const criteria = starter
      ? ask
      : s.criteria.length
      ? `<ol class="criteria">${s.criteria.map((c) => `<li><span class="sid">${esc(c.id)}</span>${esc(c.title)}${c.priority ? ` <span class="prio">${esc(c.priority)}</span>` : ""}</li>`).join("")}</ol>`
      : ask;
    const moveOn = nextCommands(s).map((c) => `<div class="code"><span>${esc(c)}</span>${copy(c)}</div>`).join("");
    return `<div class="sheet-wrap" id="story-${esc(s.id)}"><a class="scrim" href="#" aria-label="Close"></a><aside class="sheet" aria-label="${esc(s.id)}"><div class="sheet-head"><span class="sid">${esc(s.id)}</span><a class="close" href="#" aria-label="Close">×</a></div><div class="status-card ${st.cls}"><span class="sword">${esc(st.word)}</span><div class="sc-title">${esc(s.title)}</div><div class="facts">${facts}${release ? ` · R${release.number} ${esc(release.title)}` : ""}</div>${
      // The starter sentence of a new feature file, with its <placeholders>, isn't shown as the story.
      s.narrative && !/<[^>]+>/.test(s.narrative) ? `<p class="narrative">${esc(s.narrative)}</p>` : ""
    }${notes ? `<ul class="notes">${notes}</ul>` : ""}</div>${alerts}<div class="eyebrow">Acceptance criteria</div>${criteria}<div class="eyebrow">To move it on</div><p class="where">Status changes come from running its scenarios, not from this page. In this repo, run:</p>${moveOn}${
      edit ? storyEditArea(s, edit, m) : ""
    }</aside></div>`;
  };
  const title = m.project ? `${m.project} · Story map` : "Story map";
  const filters = opts.live ? filterBar(m, everything) : "";
  // The "+ Release" follows the last release band, and the unreleased band (when it has stories) comes after it.
  const releaseAdd = edit ? addReleaseBox(edit.storymap) : "";
  const host = opts.live
    ? `<span class="host"><span class="host-k">On this computer</span><span class="host-v" data-host>127.0.0.1</span></span>`
    : `<span class="host"><span class="host-k">Exported page</span><span class="host-v">read-only file</span></span>`;
  const meta = [m.owner && `Owned by <b>${esc(m.owner)}</b>`, m.bet && `Delivers <span class="bet">${esc(m.bet)}</span>`].filter(Boolean).join("");
  const nextStory = upNext.story ? everything.find((s) => s.id === upNext.story) : undefined;
  const overview = everything.length
    ? `<section class="overview" aria-label="Progress"><div class="ov-progress"><div class="ov-head"><span class="eyebrow">Progress</span><span class="num"><b>${everything.filter((s) => s.status !== "cancelled" && isDone(s.status)).length}</b> of ${everything.filter((s) => s.status !== "cancelled").length} stories done</span></div>${progressBar(everything)}</div>${
        nextStory || upNext.open.length
          ? `<div class="ov-next"><span class="eyebrow">Next to build</span>${nextStory ? `<a href="#story-${esc(nextStory.id)}"><span class="sid">${esc(nextStory.id)}</span> ${esc(nextStory.title)}</a>` : `<span class="muted">Nothing new is ready.</span>`}${
              upNext.open.length ? `<span class="muted">Finish first: ${upNext.open.map((o) => `<a href="#story-${esc(o.id)}">${esc(o.id)}</a>`).join(", ")}</span>` : ""
            }<span class="where">As nikos next picks it.</span></div>`
          : ""
      }</section>`
    : "";
  const share = opts.live
    ? `<dialog id="share" class="sheet-dialog" aria-labelledby="share-title"><div class="dialog-body"><div class="dialog-head"><h2 id="share-title">Share the story map</h2><button type="button" class="close" data-close-dialog aria-label="Close">×</button></div>
<p>This page runs on your computer, so its link only works here while nikos serve runs.${edit ? " Because the page can save to the repo, its link has a private key in it. Don't send it to anyone." : ""}</p>
<div class="opt"><h3>Send the map as one page</h3><p class="where">One read-only file that works offline${several ? ". It holds one map, so name it with --map" : ""}.</p><div class="code"><span>${esc(`nikos serve${several ? ` --map ${m.key.toLowerCase()}` : ""} --export storymap.html`)}</span>${copy(`nikos serve${several ? ` --map ${m.key.toLowerCase()}` : ""} --export storymap.html`)}</div></div>
<div class="opt"><h3>Publish it on your internal site</h3><p class="where">Export the page in CI on each merge to main, and copy the file to an internal web host your company already uses.</p></div>
<div class="opt"><h3>Anyone with the repo</h3><p class="where">They see the same map by running this in their copy.</p><div class="code"><span>nikos serve</span>${copy("nikos serve")}</div></div></div></dialog>`
    : "";
  const actions = edit && m.releases.length && m.activities.length ? `<button type="button" class="btn primary" data-open-dialog="add-story">Add a story</button>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${edit ? `<meta name="nikos-token" content="${esc(opts.token)}">\n` : ""}<title>${esc(title)}</title>
<style>${DESIGN_CSS}\n${CSS}${edit ? `${SAVE_BAR_CSS}\n${EDIT_CSS}` : ""}</style>
${opts.live ? `${THEME_HEAD}\n` : ""}</head>
<body${edit ? ` class="editing" data-map="${esc(ref!.id)}" data-storymap="${esc(edit.storymap)}"${several ? " data-several" : ""}` : ""}>
${opts.live ? `<a class="skip" href="#board">Skip to the story map</a>\n` : ""}<header class="top"><div class="bar">${brand(repo)}<span class="spacer"></span>${host}${opts.live ? `<button type="button" class="btn" data-open-dialog="share">Share…</button>${THEME_BUTTON}` : ""}</div><div class="title">${opts.back ? `<a class="back" href="${esc(opts.back)}">← All story maps</a>` : ""}<h1>${esc(title)}</h1>${meta ? `<span class="meta">${meta}</span>` : ""}${actions}</div><nav class="jumps" aria-label="Releases">${jumps}</nav></header>
${edit ? `<div id="pending" class="pending" role="status" hidden></div>\n` : ""}${overview}${filters}<main id="board" tabindex="-1">
${everything.length || edit ? `<div class="board" style="--cols:${Math.max(1, columns.length)}">
${spine}
${bands}
${releaseAdd}
${unreleased}
</div>` : `<div class="board"><div class="blank"><h2>No stories yet</h2><p>A story map lists what people do with the product, step by step, and the stories that deliver each step. Add the first one with <code>nikos story add "&lt;title&gt;" --activity &lt;id&gt;</code>, or ask your coding agent to plan the product with you.</p></div></div>`}
</main>
${everything.map(panel).join("\n")}
${share}${edit ? addStoryDialog(m, edit.storymap) : ""}
${opts.live ? `<script>${FILTER_JS}\n${LIVE_JS}</script>` : ""}${edit ? `<script>${EDIT_JS}</script>` : ""}
</body>
</html>
`;
}

// The live page's own small script: the host it runs on, the dialogs, and the copy buttons.
const LIVE_JS = `
(function () {
  var hosts = document.querySelectorAll('[data-host]');
  for (var i = 0; i < hosts.length; i++) hosts[i].textContent = location.host;
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-open-dialog],[data-close-dialog],[data-copy]') : null;
    if (!t) return;
    if (t.hasAttribute('data-open-dialog')) {
      var d = document.getElementById(t.getAttribute('data-open-dialog'));
      if (d && d.showModal) { d.showModal(); var first = d.querySelector('input:not([type=hidden]), select'); if (first) first.focus(); }
    } else if (t.hasAttribute('data-close-dialog')) {
      var open = t.closest('dialog');
      if (open) open.close();
    } else {
      var text = t.getAttribute('data-copy');
      var done = function (word) { t.textContent = word; setTimeout(function () { t.textContent = 'Copy'; }, 1600); };
      try {
        navigator.clipboard.writeText(text).then(function () { done('Copied'); }, function () { done('Select and copy'); });
      } catch (err) { done('Select and copy'); }
    }
  });
})();
`;

/** Search, release, status, type and persona filters, and the release-rows switch. Live page only. */
function filterBar(m: StoryMap, stories: MapStory[]): string {
  const option = (value: string, text: string) => `<option value="${esc(value)}">${esc(text)}</option>`;
  const statuses = [...new Set(stories.map((s) => statusOf(s)))].map((st) => st.cls);
  const words = Object.fromEntries([...Object.values(STATUS), { cls: "blocked", word: "blocked" }, { cls: "changed", word: "spec changed" }].map((x) => [x.cls, x.word]));
  const chips = [...new Set(statuses)]
    .map((cls) => `<label class="chip ${esc(cls)}"><input type="checkbox" name="status" value="${esc(cls)}">${esc(words[cls] ?? cls)}</label>`)
    .join("");
  const types = [...new Set(stories.map((s) => s.type))].filter((t) => t !== "user_story");
  return `<div class="filters" role="search">
<input type="search" id="f-q" placeholder="Search stories" aria-label="Search stories">
<select id="f-release" aria-label="Release">${option("", "All releases")}${m.releases.map((r) => option(`release-${r.number}`, `R${r.number} · ${r.title}`)).join("")}${
    m.unreleased.length ? option("unreleased", "Not in a release") : ""
  }</select>
${types.length ? `<select id="f-type" aria-label="Story type">${option("", "All types")}${option("user_story", "User stories")}${types.map((t) => option(t, TYPE_WORD[t] ?? t)).join("")}</select>` : ""}
${m.personas.length ? `<select id="f-persona" aria-label="Persona">${option("", "Everyone")}${m.personas.map((p) => option(p.id, p.title)).join("")}</select>` : ""}
<fieldset class="chips"><legend>Status</legend>${chips}</fieldset>
<label class="switch"><input type="checkbox" id="f-rows" checked>Release rows</label>
<span id="f-count" class="count" aria-live="polite"></span>
</div>
`;
}

// Runs only on the dashboard's live map. Filters hide cards; with release rows off, every
// release's cards are shown together in one band, column by column.
const FILTER_JS = `
(function () {
  var board = document.querySelector('.board');
  var bands = Array.prototype.slice.call(board.querySelectorAll('.band'));
  var $ = function (id) { return document.getElementById(id); };
  var merged = document.createElement('section');
  merged.className = 'band';
  merged.hidden = true;
  merged.setAttribute('data-release', 'all');
  var lane = document.createElement('div');
  lane.className = 'lane';
  var first = board.querySelector('.lane');
  if (first) {
    Array.prototype.forEach.call(first.children, function (cell, i) {
      var c = document.createElement('div');
      c.className = 'cell';
      c.setAttribute('data-activity', cell.getAttribute('data-activity'));
      bands.forEach(function (b) {
        var cells = b.querySelectorAll('.lane > .cell');
        // Only the cards: the add forms of a cell stay in their own band.
        if (cells[i]) Array.prototype.forEach.call(cells[i].children, function (card) { if (card.classList.contains('card')) c.appendChild(card.cloneNode(true)); });
      });
      lane.appendChild(c);
    });
  }
  merged.appendChild(lane);
  board.appendChild(merged);

  function value(id) { var el = $(id); return el ? el.value : ''; }
  function apply() {
    var q = value('f-q').trim().toLowerCase();
    var release = value('f-release');
    var type = value('f-type');
    var persona = value('f-persona');
    var rows = $('f-rows').checked;
    var statuses = Array.prototype.map.call(document.querySelectorAll('input[name=status]:checked'), function (i) { return i.value; });
    var filtering = q || type || persona || statuses.length;
    var shown = 0, total = 0;
    var match = function (card) {
      return (!release || rows ? true : card.getAttribute('data-release-of') === release) &&
        (!q || card.getAttribute('data-search').indexOf(q) >= 0) &&
        (!type || card.getAttribute('data-type') === type) &&
        (!persona || (' ' + card.getAttribute('data-personas') + ' ').indexOf(' ' + persona + ' ') >= 0) &&
        (!statuses.length || statuses.indexOf(card.getAttribute('data-status')) >= 0);
    };
    bands.forEach(function (b) {
      b.hidden = !rows || (release && b.getAttribute('data-release') !== release);
    });
    merged.hidden = rows;
    var active = rows ? bands.filter(function (b) { return !b.hidden; }) : [merged];
    active.forEach(function (b) {
      var visible = 0;
      Array.prototype.forEach.call(b.querySelectorAll('.card'), function (card) {
        var ok = match(card);
        card.hidden = !ok;
        total++;
        if (ok) { shown++; visible++; }
      });
      if (rows && filtering && !visible) b.hidden = true;
    });
    $('f-count').textContent = filtering || release ? shown + ' of ' + total + ' stories' : '';
  }
  // Remember which release each card came from, so the release filter works with rows off.
  bands.forEach(function (b) {
    Array.prototype.forEach.call(b.querySelectorAll('.card'), function (card) {
      Array.prototype.forEach.call(merged.querySelectorAll('.card[data-story="' + card.getAttribute('data-story') + '"]'), function (copy) {
        copy.setAttribute('data-release-of', b.getAttribute('data-release'));
      });
    });
  });
  document.querySelector('.filters').addEventListener('input', apply);
  document.querySelector('.filters').addEventListener('change', apply);
  apply();
})();
`;

// The page's own parts, on the shared tokens of DESIGN_CSS. Each status sets the edge and word colour of its
// card, chip and panel; the tokens carry light and dark, so the statuses need no dark rules of their own.
const CSS = `
${THEME_CSS}
:root { --col: 230px; --gap: 14px; }
body { margin: 0; height: 100vh; display: flex; flex-direction: column; }
.title { display: flex; align-items: center; gap: 8px 14px; flex-wrap: wrap; }
.blank { margin: 32px 0; max-width: 560px; padding: 24px; border: 1.5px dashed var(--line-strong); border-radius: var(--r); background: var(--surface); }
.blank h2 { margin: 0 0 6px; font-size: 18px; }
.blank p { margin: 0; color: var(--muted); }
.sid, .rnum, .rcode, .count, .facts { font-family: var(--f-mono); }
.warn { color: var(--warn); font-weight: 600; }
.top { padding: 12px 24px; display: grid; gap: 10px; border-bottom: 1px solid var(--line); background: var(--bg); }
.top .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.spacer { flex: 1; }
.brand { display: inline-flex; align-items: center; gap: 10px; font-family: var(--f-display); font-weight: 700; font-size: 16px; }
.brand-mark { width: 28px; height: 28px; border-radius: 8px; background: var(--accent); display: grid; place-items: center; }
.brand-mark svg { width: 18px; height: 18px; }
:root[data-theme="dark"] .brand-mark svg, .brand-mark svg { stroke: var(--accent-fg); }
.brand-t small { display: block; font-family: var(--f-mono); font-weight: 400; font-size: 12px; color: var(--muted); line-height: 1.2; }
h1 { font-size: 24px; margin: 0; line-height: 1.2; }
.meta { display: inline-flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; font-size: 13px; color: var(--muted); }
.meta b { color: var(--fg); }
.back { display: block; flex-basis: 100%; font-size: 14px; font-weight: 500; text-decoration: none; }
.jumps { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: thin; }
.jump { display: inline-flex; align-items: center; gap: 8px; min-height: 28px; padding: 0 12px; border: 1px solid var(--line); border-radius: 99px; background: var(--surface); color: var(--fg); text-decoration: none; font-size: 13px; white-space: nowrap; }
.jump:hover { border-color: var(--line-strong); }
.rcode { font-size: 12px; color: var(--accent); font-weight: 600; }
.count { font-size: 12px; color: var(--muted); }
.overview { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 12px; padding: 12px 24px; border-bottom: 1px solid var(--line); }
.overview > div { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); padding: 10px 14px; display: grid; gap: 6px; align-content: start; min-width: 0; }
.ov-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap; font-size: 14px; }
.ov-next { font-size: 14px; }
.ov-next a { font-weight: 600; color: var(--fg); }
.stack { display: flex; height: 10px; border-radius: 99px; overflow: hidden; background: var(--surface-2); }
.stack i { display: block; height: 100%; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: var(--muted); }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.sw { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.where { margin: 4px 0 0; font-size: 12px; color: var(--muted); }
main { flex: 1; min-height: 0; overflow: auto; background: var(--bg); }
.board { width: max-content; min-width: 100%; padding: 0 24px 48px; }
.spine { position: sticky; top: 0; z-index: 3; padding: 20px 0 6px; background: var(--bg); }
.activities, .steps { display: flex; gap: var(--gap); }
.steps { margin-top: 8px; }
.step { width: var(--col); min-height: 32px; border-radius: 8px; background: var(--accent-weak); padding: 7px 12px; font-size: 13px; font-weight: 600; color: var(--accent); }
.step.none { background: none; }
.activity { width: calc(var(--span, 1) * var(--col) + (var(--span, 1) - 1) * var(--gap)); display: grid; gap: 0; background: var(--accent); color: var(--accent-fg); border-radius: 8px; padding: 8px 12px; }
.activity .eyebrow { color: inherit; opacity: .8; font-size: 11px; }
.activity strong { font-size: 14px; }
.band { scroll-margin-top: 110px; border-top: 2px dashed var(--line-strong); margin-top: 14px; padding-top: 10px; }
.divider, .band .goal, .band .bets { position: sticky; left: 24px; width: max-content; max-width: min(100%, calc(100vw - 72px)); }
.divider { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; margin: 0 0 6px; }
.rnum { color: var(--accent); font-size: 13px; font-weight: 600; }
.divider h2 { margin: 0; font-size: 17px; }
.tally { font-size: 12px; color: var(--muted); }
.rule { display: none; }
.stamp { display: inline-block; transform: rotate(-3deg); color: var(--good); border: 2px solid var(--good); border-radius: 5px; padding: 0 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; }
.goal { margin: 0 0 8px; color: var(--muted); font-size: 14px; }
.bets { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0 0 10px; }
.bet { font-size: 12px; padding: 1px 9px; border-radius: 6px; border: 1px solid var(--line); background: var(--surface); color: var(--fg); font-family: var(--f-mono); }
.lane { display: flex; gap: var(--gap); }
.cell { width: var(--col); min-height: 48px; display: flex; flex-direction: column; gap: 8px; }
.empty { color: var(--muted); margin: 0 0 8px; }
.card { --edge: var(--line-strong); --word: var(--muted); display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border: 1px solid var(--line); border-left: 4px solid var(--edge); border-radius: 7px; background: var(--surface); color: var(--fg); text-decoration: none; box-shadow: var(--shadow); }
.card:hover { border-color: var(--line-strong); border-left-color: var(--edge); }
.card[data-next] { box-shadow: 0 0 0 2px var(--accent), var(--shadow); }
.crow { display: flex; align-items: baseline; gap: 6px; }
.card .sid { font-size: 11px; color: var(--muted); }
.sword { margin-left: auto; font-size: 12px; font-weight: 600; color: var(--word); }
.sword::first-letter { text-transform: uppercase; }
.stitle { font-size: 14px; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.cfoot { display: flex; flex-wrap: wrap; gap: 2px 8px; font-size: 12px; color: var(--muted); }
.next-tag { color: var(--accent); font-weight: 600; }
.todo { --edge: var(--line-strong); --word: var(--muted); }
.doing { --edge: var(--accent); --word: var(--accent); }
.rework { --edge: var(--bad); --word: var(--bad); }
.done { --edge: color-mix(in srgb, var(--good) 55%, var(--line)); --word: var(--good); }
.approved { --edge: var(--good); --word: var(--good); }
.card.done .stitle, .card.approved .stitle { text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--fg) 35%, transparent); }
.changed { --edge: var(--warn); --word: var(--warn); }
.blocked { --edge: var(--bad); --word: var(--bad); }
.cancelled { --edge: var(--line); --word: var(--muted); }
.card.cancelled { border-style: dashed; box-shadow: none; opacity: .75; }
.card.cancelled .stitle { text-decoration: line-through; }
.stype { font-size: 11px; padding: 0 6px; border-radius: 99px; background: var(--surface-2); color: var(--fg); }
.wait { color: var(--warn); font-weight: 600; }
.notes { margin: 10px 0 0; padding-left: 18px; color: var(--fg); }
[hidden] { display: none !important; }
.filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 24px; border-bottom: 1px solid var(--line); background: var(--surface); }
.filters input[type=search], .filters select { min-height: 34px; border: 1px solid var(--line-strong); border-radius: 7px; background: var(--bg); color: var(--fg); padding: 0 10px; }
.filters input[type=search] { width: 220px; max-width: 100%; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; border: 0; margin: 0; padding: 0; }
.chips legend { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.chips .chip { min-height: 28px; padding: 0 10px; border-radius: 99px; font-size: 13px; cursor: pointer; }
.chips .chip::before { content: ""; width: 9px; height: 9px; border-radius: 3px; background: var(--edge); }
.chips .chip input { position: absolute; opacity: 0; pointer-events: none; }
.chips .chip:has(input:checked) { background: var(--accent-weak); border-color: var(--accent); color: var(--accent); }
.chips .chip:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.switch { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }
.switch input { accent-color: var(--accent); width: 16px; height: 16px; }
#f-count { margin-left: auto; font-size: 13px; color: var(--muted); }
.sheet-wrap { display: none; }
.sheet-wrap:target { display: block; position: fixed; inset: 0; z-index: 10; }
.scrim { position: absolute; inset: 0; background: rgb(10 8 20 / .35); }
.sheet { position: absolute; top: 0; right: 0; bottom: 0; width: 620px; max-width: 100%; overflow-y: auto; background: var(--bg); box-shadow: -8px 0 32px rgb(0 0 0 / .18); padding: 16px 20px 32px; display: grid; gap: 14px; align-content: start; animation: slide .24s cubic-bezier(.2,.8,.3,1); }
@keyframes slide { from { transform: translateX(40px); opacity: 0; } }
.sheet-head { display: flex; align-items: center; justify-content: space-between; }
.close { display: inline-grid; place-items: center; width: 34px; height: 34px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); font-size: 20px; line-height: 1; color: var(--fg); text-decoration: none; cursor: pointer; }
.status-card { border: 1px solid var(--line); border-left: 5px solid var(--edge, var(--line)); background: var(--surface); border-radius: var(--r); padding: 14px 16px; }
.status-card .sword { display: block; margin: 0 0 4px; }
.sc-title { font-family: var(--f-display); font-size: 20px; font-weight: 700; line-height: 1.25; margin-bottom: 6px; }
.facts { font-size: 12px; color: var(--muted); }
.narrative { margin: 10px 0 0; color: var(--muted); font-style: italic; }
.alert { margin: 0; border-radius: 8px; padding: 9px 12px; font-size: 14px; }
.alert.warn { background: var(--warn-bg); color: var(--warn); }
.alert.bad { background: var(--bad-bg); color: var(--bad); }
.criteria { margin: 0; padding: 0; list-style: none; display: grid; border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); }
.criteria li { padding: 9px 12px; border-top: 1px solid var(--line); font-size: 14px; }
.criteria li:first-child { border-top: 0; }
.criteria .sid { font-size: 11px; color: var(--muted); margin-right: 8px; }
.prio { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
.code { display: flex; justify-content: space-between; align-items: center; gap: 10px; font-family: var(--f-mono); font-size: 12px; background: var(--surface-2); border-radius: 6px; padding: 7px 10px; overflow-wrap: anywhere; }
.copy { flex: none; font-family: var(--f-body); font-size: 12px; border: 1px solid var(--line-strong); background: var(--surface); border-radius: 6px; padding: 2px 8px; cursor: pointer; }
.opt { border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); padding: 12px 14px; display: grid; gap: 6px; }
.opt h3 { margin: 0; font-family: var(--f-body); font-size: 15px; }
@media (prefers-reduced-motion: reduce) { .sheet { animation: none; } }
@media (max-width: 767px) {
  body { height: auto; display: block; }
  .top, .overview, .filters { padding-left: 16px; padding-right: 16px; }
  .overview { grid-template-columns: minmax(0, 1fr); }
  h1 { font-size: 21px; }
  .filters input[type=search] { width: 100%; }
  #f-count { margin-left: 0; }
  .board { width: auto; padding: 0 16px 32px; }
  .spine { display: none; }
  .divider, .band .goal, .band .bets { position: static; width: auto; max-width: none; }
  .lane { display: block; }
  .cell { width: auto; min-height: 0; }
  .cell:empty { display: none; }
  .cell::before { content: attr(data-activity); display: block; margin: 12px 0 6px; padding-bottom: 4px; border-bottom: 1px solid var(--line); font-size: 12px; font-weight: 600; color: var(--accent); }
  .band { scroll-margin-top: 12px; }
}
`;

/** A map key: uppercase letters and digits, e.g. CHK. Its folder is the key, lowercased. */
const MAP_KEY = KEY;

/**
 * A story map, as maps/<key lowercased>/: its storymap, state, approvals and features. Its story ids
 * take the owner (--owner, e.g. WEB), else just the key. A bet (--bet) is optional and must be a bet
 * id: its card isn't looked up, since a code repo can't read a planning repo.
 * Refuses with the same messages the command line gives.
 */
export function newMap(input: { bet?: string; key?: string; owner?: string }, dir: string): { id: string; key: string; ids: string; dir: string } {
  if (isPlanRepo(dir)) throw new Error("This is the company's planning repo. Story maps live in code repos: run nikos map new in one of those.");
  const old = oldLayoutProblem(dir);
  if (old) throw new Error(old);
  const bet = input.bet;
  const key = input.key;
  const owner = input.owner;
  if (!key) throw new Error("nikos map new needs --key <KEY>");
  if (store().isDir(join(dir, "intent"))) throw new Error("this repo has intent/: move intent/ to maps/<key>/ by hand, as the release notes describe");
  if (bet !== undefined) {
    if (!BET_ID.test(bet)) {
      if (CROSS_REF.test(bet)) throw new Error("a map names one bet by its id, not another repo's bet");
      throw new Error(`'${bet}' is not a bet id`);
    }
  }
  if (!MAP_KEY.test(key)) throw new Error("map key must be uppercase letters and digits, up to 10 (e.g. CHK)");
  if (owner !== undefined && !OWNER.test(owner)) throw new Error("owner must be uppercase letters and digits, up to 10 (e.g. WEB)");
  const taken = mapDirs(dir).find((d) => (parse(read(join(d, "storymap.yaml"))) as { key?: string })?.key === key);
  if (taken) throw new Error(`map key ${key} is already used by maps/${basename(taken)}`);
  const id = key.toLowerCase();
  const mapDir = join(dir, "maps", id);
  if (store().exists(mapDir)) throw new Error(`maps/${id} already exists`);
  const storymap = stringify({ format_version: 1, project: id, key, ...(owner ? { owner } : {}), ...(bet ? { bet } : {}), activities: [{ id: "getting-started", title: "Getting started" }], releases: [{ number: 1, title: "Release 1", stories: [] }] });
  store().write(join(mapDir, "storymap.yaml"), storymap, { create: true });
  store().write(join(mapDir, "state.yaml"), "format_version: 1\nstories: {}\n", { create: true });
  for (const sub of ["features", "plans", "approvals"]) store().write(join(mapDir, sub, ".gitkeep"), "", { create: true });
  writeMapSummary(dir, mapDir);
  return { id, key, ids: storyPrefix({ root: dir, dir: mapDir, id }, key), dir: mapDir };
}

/**
 * `nikos map new --bet <bet-id> --key <KEY>`: the command line over newMap, which prints the
 * folder it made and the story ids it will give.
 */
export function runMapNew(args: string[]): number {
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const bet = flag("--bet");
  const dir = resolve(flag("--dir") ?? process.cwd());
  try {
    const r = newMap({ bet, key: flag("--key"), owner: flag("--owner") }, dir);
    console.log(`Created maps/${r.id}${bet ? ` for bet ${bet}` : ""}, story ids ${r.ids}-n`);
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}

/** `nikos map`: write the story map as a standalone page. `nikos map new` makes a map in this repo. */
export function runMap(args: string[]): number {
  if (args[0] === "new") return runMapNew(args.slice(1));
  if (args[0] === "status") return runMapStatus(args.slice(1));
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const out = resolve(flag("--out") ?? "storymap.html");
  const dir = resolve(flag("--dir") ?? process.cwd());
  try {
    const ref = resolveStoryMap(dir, { map: flag("--map") });
    if (!store().exists(join(ref.dir, "storymap.yaml"))) throw new Error(`No storymap.yaml in ${ref.dir}: run nikos init first`);
    writeFileSync(out, renderMap(dir, { map: flag("--map") }));
    const shown = relative(process.cwd(), out);
    console.log(`Wrote ${shown && !shown.startsWith("..") ? shown : out}`);
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
