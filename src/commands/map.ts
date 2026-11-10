// The story map: activities as columns, releases as numbered bands, stories as cards tinted
// by state.yaml. Read-only and script-free: the page has nothing to edit and runs no code, so
// it can be shared as a file. Selecting a story opens its panel with :target, in CSS alone.
// Served live by nikos serve, it also gets a filter bar (see FILTER_JS).
import { loadStates } from "../lib/state-files.js";
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
  stories: MapStory[];
}
export interface StoryMap {
  project: string;
  key: string;
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
    stories: (Array.isArray(r.stories) ? r.stories : []).map((s: unknown) => story(String(s))),
  }));
  const placed = new Set(releases.flatMap((r) => r.stories.map((s) => s.id)));
  return {
    project: String(map.project ?? ""),
    key: String(map.key ?? ""),
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

/** The whole story map as one standalone HTML page. live adds the filter bar and its script for nikos serve. */
export function renderMap(dir: string, opts: { live?: boolean; map?: string } = {}): string {
  const m = storyMapOf(dir, opts.map);
  // One column per step; an activity with no steps (or the "Other" bucket) gets one column.
  const known = new Set(m.activities.map((a) => a.id));
  const everything = [...m.releases.flatMap((r) => r.stories), ...m.unreleased];
  const groups = [
    ...m.activities,
    ...(everything.some((s) => !known.has(s.activity)) ? [{ id: "", title: "Other", steps: [] as { id: string; title: string }[] }] : []),
  ].map((a) => ({ ...a, columns: a.steps.length ? a.steps.map((st) => ({ key: `${a.id}/${st.id}`, label: `${a.title} · ${st.title}` })) : [{ key: `${a.id}/`, label: a.title }] }));
  const columns = groups.flatMap((g) => g.columns);
  const columnOf = (s: MapStory) => {
    const g = groups.find((x) => x.id === (known.has(s.activity) ? s.activity : ""))!;
    return g.columns.find((c) => c.key === `${g.id}/${s.step}`)?.key ?? g.columns[0].key;
  };
  const hasSteps = m.activities.some((a) => a.steps.length);
  const card = (s: MapStory) => {
    const st = statusOf(s);
    const musts = s.criteria.filter((c) => c.priority === "must").length;
    const foot = s.waitingOn.length
      ? `<span class="wait">Waits on ${esc(s.waitingOn.join(", "))}</span>`
      : s.criteria.length
        ? `<span>${s.criteria.length} ${s.criteria.length === 1 ? "criterion" : "criteria"}${musts ? ` · ${musts} must` : ""}</span>`
        : `<span class="warn">No criteria</span>`;
    const type = TYPE_WORD[s.type] ? `<span class="stype">${TYPE_WORD[s.type]}</span>` : "";
    // data- attributes let the live dashboard filter cards; the exported page ignores them.
    const data = `data-story="${esc(s.id)}" data-status="${esc(st.cls)}" data-type="${esc(s.type)}" data-personas="${esc(s.personas.join(" "))}" data-search="${esc(`${s.id} ${s.title} ${s.narrative}`.toLowerCase())}"`;
    return `<a class="card ${st.cls}" ${data} href="#story-${esc(s.id)}"><span class="crow"><span class="sid">${esc(s.id)}</span>${type}<span class="sword">${esc(st.word)}</span></span><span class="stitle">${esc(s.title)}</span><span class="cfoot">${foot}</span></a>`;
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
  const band = (id: string, code: string, heading: string, goal: string, bets: string[], stories: MapStory[]) => {
    const live = stories.filter((s) => s.status !== "cancelled");
    const shipped = live.length > 0 && live.every((s) => isDone(s.status) && !s.specChanged);
    const chips = bets.map((b) => `<span class="bet">${esc(b)}</span>`).join("");
    const cells = columns
      .map((c) => `<div class="cell" data-activity="${esc(c.label)}">${stories.filter((s) => columnOf(s) === c.key).map(card).join("")}</div>`)
      .join("");
    return `<section class="band" id="${esc(id)}" data-release="${esc(id)}"><div class="divider"><span class="rnum">${esc(code)}</span><h2>${esc(heading)}</h2>${
      shipped ? `<span class="stamp">Shipped</span>` : ""
    }<span class="tally">${stories.length ? tally(stories) : "no stories"}</span><span class="rule"></span></div>${
      goal ? `<p class="goal">${esc(goal)}</p>` : ""
    }${
      chips ? `<div class="bets"><span class="eyebrow">Delivers</span>${chips}</div>` : ""
    }${stories.length ? `<div class="lane">${cells}</div>` : `<p class="empty">No stories yet.</p>`}</section>`;
  };
  const bands = m.releases.map((r) => band(`release-${r.number}`, pad(r.number), `Release ${r.number} · ${r.title}`, r.goal, r.bets, r.stories)).join("");
  const unreleased = m.unreleased.length ? band("unreleased", "--", "Not in a release", "", [], m.unreleased) : "";
  const spine = `<div class="spine"><div class="activities">${groups
    .map((g) => `<div class="activity" style="--span:${g.columns.length}"><span class="eyebrow">Activity</span><strong>${esc(g.title)}</strong></div>`)
    .join("")}</div>${
    hasSteps ? `<div class="steps">${groups.map((g) => (g.steps.length ? g.steps.map((st) => `<div class="step">${esc(st.title)}</div>`).join("") : `<div class="step none"></div>`)).join("")}</div>` : ""
  }</div>`;
  const jumps = [
    ...m.releases.map((r) => `<a class="jump" href="#release-${r.number}"><span class="rcode">R${r.number}</span>${esc(r.title)}<span class="count">${r.stories.length}</span></a>`),
    ...(m.unreleased.length ? [`<a class="jump" href="#unreleased">Not in a release<span class="count">${m.unreleased.length}</span></a>`] : []),
  ].join("");
  const panel = (s: MapStory) => {
    const st = statusOf(s);
    const facts = [s.id, TYPE_WORD[s.type], s.priority, s.effort && `effort ${s.effort}`].filter(Boolean).map((f) => esc(f)).join(" · ");
    const persona = (id: string) => m.personas.find((p) => p.id === id)?.title ?? id;
    const notes = [
      s.personas.length && `For ${s.personas.map(persona).join(", ")}`,
      s.dependsOn.length && `Depends on ${s.dependsOn.map((d) => (s.waitingOn.includes(d) ? `${d} (not done)` : d)).join(", ")}`,
      s.status === "approved" && `Approved by ${s.approvedBy || "someone"}`,
      s.status === "cancelled" && `Cancelled: ${s.cancelledReason}`,
      s.specChanged && "The feature changed after it was done, so its scenarios no longer prove it",
    ].filter(Boolean).map((n) => `<li>${esc(n)}</li>`).join("");
    const criteria = s.criteria.length
      ? `<ol class="criteria">${s.criteria.map((c) => `<li><span class="sid">${esc(c.id)}</span>${esc(c.title)}${c.priority ? ` <span class="prio">${esc(c.priority)}</span>` : ""}</li>`).join("")}</ol>`
      : `<p class="warn">No criteria yet.</p>`;
    return `<div class="sheet-wrap" id="story-${esc(s.id)}"><a class="scrim" href="#" aria-label="Close"></a><aside class="sheet" aria-label="${esc(s.id)}"><div class="sheet-head"><span class="sid">${esc(s.id)}</span><a class="close" href="#" aria-label="Close">×</a></div><div class="status-card ${st.cls}"><span class="sword">${esc(st.word)}</span><div class="sc-title">${esc(s.title)}</div><div class="facts">${facts}</div>${
      s.narrative ? `<p class="narrative">${esc(s.narrative)}</p>` : ""
    }${notes ? `<ul class="notes">${notes}</ul>` : ""}</div><div class="eyebrow">Acceptance criteria</div>${criteria}</aside></div>`;
  };
  const title = m.project ? `${m.project} · Story map` : "Story map";
  const filters = opts.live ? filterBar(m, everything) : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
${opts.live ? `<a class="skip" href="#board">Skip to the story map</a>\n` : ""}<header class="top"><div class="title"><h1>${esc(title)}</h1></div><nav class="jumps" aria-label="Releases">${jumps}</nav></header>
${filters}<main id="board" tabindex="-1">
${everything.length ? `<div class="board" style="--cols:${Math.max(1, columns.length)}">
${spine}
${bands}
${unreleased}
</div>` : `<div class="board"><div class="blank"><h2>No stories yet</h2><p>A story map lists what people do with the product, step by step, and the stories that deliver each step. Add the first one with <code>nikos story add "&lt;title&gt;" --activity &lt;id&gt;</code>, or ask your coding agent to plan the product with you.</p></div></div>`}
</main>
${everything.map(panel).join("\n")}
${opts.live ? `<script>${FILTER_JS}</script>` : ""}
</body>
</html>
`;
}

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
        if (cells[i]) Array.prototype.forEach.call(cells[i].children, function (card) { c.appendChild(card.cloneNode(true)); });
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

const CSS = `
:root { color-scheme: light dark; --paper: #F5F5F2; --surface: #FFFFFF; --elevated: #EFEFEB; --line: #E2E3DE; --line-2: #C9CBC5; --ink: #17191A; --ink-2: #3E4347; --muted: #5B6267; --brand: #1C5AA6; --brand-subtle: rgba(28,90,166,.08); --grid: rgba(23,25,26,.05); --stamp: #C42121; --warn: #8A5300; --focus: #1C5AA6; --col: 240px; --gap: 16px; }
@media (prefers-color-scheme: dark) {
  :root { --paper: #111315; --surface: #181B1E; --elevated: #212529; --line: #2A2F34; --line-2: #3B4147; --ink: #ECEEEF; --ink-2: #C9CED2; --muted: #9EA6AC; --brand: #8DB8F2; --brand-subtle: rgba(141,184,242,.1); --grid: rgba(236,238,239,.04); --stamp: #F28B82; --warn: #F0B657; --focus: #8DB8F2; }
  .card { --fill: #1C1F23; --edge: #2E3338; --word: #A9B0B6; }
  .doing { --fill: #15253A; --edge: #24405F; --word: #7FD9A6; }
  .rework { --fill: #2A1F34; --edge: #44325A; --word: #F3B37A; }
  .done { --fill: #221F3B; --edge: #3A3566; --word: #B6AEFF; }
  .approved { --fill: #15301F; --edge: #23502F; --word: #86DCAB; }
  .changed { --fill: #2F2513; --edge: #4E3D1C; --word: #F0B657; }
  .blocked { --fill: #351B16; --edge: #5A2B22; --word: #F29D8B; }
  .cancelled { --fill: transparent; --edge: #2E3338; --word: #9EA6AC; }
  .stamp { mix-blend-mode: normal; }
}
* { box-sizing: border-box; }
body { margin: 0; height: 100vh; display: flex; flex-direction: column; background: var(--paper); color: var(--ink); font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; -webkit-font-smoothing: antialiased; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.skip { position: absolute; left: 12px; top: -48px; z-index: 20; background: var(--ink); color: var(--paper); padding: 8px 14px; border-radius: 8px; text-decoration: none; font-weight: 600; }
.skip:focus { top: 12px; }
.title { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.blank { margin: 32px 0; max-width: 560px; padding: 24px; border: 1px dashed var(--line-2); border-radius: 12px; background: var(--surface); font-size: 14px; }
.blank h2 { margin: 0 0 6px; font-size: 16px; }
.blank p { margin: 0; color: var(--muted); }
.blank code { font-family: ui-monospace, Menlo, monospace; font-size: 12px; background: var(--elevated); padding: 1px 6px; border-radius: 5px; }
.sid, .rnum, .rcode, .count, .tally, .cfoot, .facts, .stamp { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
.eyebrow { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-2); }
.warn { color: var(--warn); font-weight: 600; }
.top { padding: 16px 24px 12px; display: flex; flex-wrap: wrap; gap: 10px 24px; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line); background: var(--paper); }
h1 { font-size: 17px; margin: 0; letter-spacing: -.01em; }
.jumps { display: flex; flex-wrap: wrap; gap: 6px; }
.jump { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border: 1px solid var(--line); border-radius: 99px; background: var(--surface); color: var(--ink); text-decoration: none; font-size: 12px; }
.jump:hover { border-color: var(--line-2); }
.rcode, .count { font-size: 11px; color: var(--muted); }
main { flex: 1; min-height: 0; overflow: auto; background-color: var(--paper); background-image: linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px); background-size: 24px 24px; background-attachment: local; }
.board { width: max-content; min-width: 100%; padding: 0 24px 48px; }
.spine { position: sticky; top: 0; z-index: 3; padding: 24px 0 4px; background: var(--paper); }
.activities, .steps { display: flex; gap: var(--gap); }
.steps { margin-top: 8px; }
.step { width: var(--col); min-height: 32px; border-radius: 4px; background: var(--brand-subtle); padding: 7px 10px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-2); }
.step.none { background: none; }
.activity { width: calc(var(--span, 1) * var(--col) + (var(--span, 1) - 1) * var(--gap)); display: grid; gap: 2px; background: var(--surface); border: 1px solid var(--line); border-top: 2px solid var(--brand); border-radius: 4px; padding: 10px 14px; box-shadow: 0 1px 2px rgba(60,50,30,.06); }
.activity strong { font-size: 13px; }
.band { scroll-margin-top: 90px; }
.divider { display: flex; align-items: center; gap: 12px; margin: 20px 0 10px; }
.rnum { color: var(--brand); font-size: 13px; font-weight: 600; }
.divider h2 { margin: 0; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-2); white-space: nowrap; }
.tally { font-size: 11px; color: var(--muted); white-space: nowrap; }
.rule { flex: 1; border-top: 1px solid var(--line); min-width: 24px; }
.stamp { display: inline-block; transform: rotate(-3deg); color: var(--stamp); border: 2px solid var(--stamp); box-shadow: inset 0 0 0 1px rgba(220,38,38,.45); padding: .15rem .5rem; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; opacity: .85; mix-blend-mode: multiply; }
.goal { margin: -4px 0 10px; color: var(--ink-2); max-width: 720px; }
.bets { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: -4px 0 10px; }
.bet { font-size: 12px; padding: 2px 9px; border-radius: 99px; background: var(--brand-subtle); color: var(--brand); }
.lane { display: flex; gap: var(--gap); }
.cell { width: var(--col); min-height: 48px; display: flex; flex-direction: column; gap: 4px; }
.empty { color: var(--muted); margin: 0 0 8px; }
.card { --fill: #F4F3EE; --edge: #E3E1D9; --word: #625D53; display: flex; flex-direction: column; min-height: 32px; border: 1px solid var(--edge); border-radius: 4px; background: var(--fill); color: var(--ink); text-decoration: none; box-shadow: 0 1px 2px rgba(60,50,30,.06); }
.card:hover { border-color: var(--line-2); }
.card:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.crow { display: flex; align-items: baseline; gap: 6px; padding: 4px 8px 0; }
.card .sid { font-size: 11px; letter-spacing: .06em; color: var(--muted); }
.sword { margin-left: auto; font-size: 11px; font-weight: 500; color: var(--word); }
.sword::first-letter { text-transform: uppercase; }
.stitle { padding: 2px 8px; font-size: 13px; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.cfoot { display: flex; justify-content: space-between; padding: 0 8px 4px; font-size: 11px; letter-spacing: .04em; color: var(--muted); }
.doing { --fill: #EDF3FD; --edge: #CFDDF8; --word: #1E7A50; }
.card.doing { border-left: 4px solid #1E9E5C; }
.rework { --fill: #F1EEFB; --edge: #DCD5F3; --word: #9A4E0A; }
.card.rework { border-left: 4px solid #E8892B; }
.done { --fill: #F1EEFB; --edge: #DCD5F3; --word: #6D5BB8; }
.card.done .stitle { text-decoration: line-through; text-decoration-color: rgba(26,26,24,.35); }
.approved { --fill: #EAF6EE; --edge: #C7E6D2; --word: #1E7A50; }
.card.approved .stitle { text-decoration: line-through; text-decoration-color: rgba(26,26,24,.35); }
.changed { --fill: #FFF6E5; --edge: #F2D9A6; --word: #B45309; }
.card.changed { border-left: 4px solid #D97706; }
.cancelled { --fill: transparent; --edge: #E3E1D9; --word: #625D53; }
.card.cancelled { border-style: dashed; box-shadow: none; opacity: .7; }
.card.cancelled .stitle { text-decoration: line-through; }
.stype { font-size: 11px; padding: 0 6px; border-radius: 99px; background: var(--elevated); color: var(--ink-2); }
.wait { color: var(--warn); }
.notes { margin: 10px 0 0; padding-left: 18px; color: var(--ink-2); }
.blocked { --fill: #FDECEC; --edge: #F3C2C2; --word: #B83232; }
.card.blocked { border-left: 4px solid #D64545; }
[hidden] { display: none !important; }
.filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 24px; border-bottom: 1px solid var(--line); background: var(--surface); }
.filters input[type=search], .filters select { height: 36px; border: 1px solid var(--line-2); border-radius: 6px; background: var(--surface); color: var(--ink); font: inherit; padding: 0 10px; }
.filters input[type=search] { width: 220px; max-width: 100%; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; border: 0; margin: 0; padding: 0; }
.chips legend { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.chip { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px; border: 1px solid var(--edge, var(--line)); border-radius: 99px; background: var(--fill, var(--surface)); color: var(--word, var(--ink)); font-size: 12px; cursor: pointer; }
.chip input { margin: 0; accent-color: var(--brand); }
.chip:has(input:checked) { outline: 2px solid var(--brand); outline-offset: -1px; }
.switch { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-2); }
.sheet-wrap { display: none; }
.sheet-wrap:target { display: block; position: fixed; inset: 0; z-index: 10; }
.scrim { position: absolute; inset: 0; background: rgba(0,0,0,.4); }
.sheet { position: absolute; top: 0; right: 0; bottom: 0; width: 700px; max-width: 95vw; overflow-y: auto; background: var(--surface); border-left: 1px solid var(--line); box-shadow: 0 25px 50px -12px rgba(0,0,0,.25); padding: 16px 20px 32px; animation: slide .28s cubic-bezier(.2,.8,.3,1); }
@keyframes slide { from { transform: translateX(40px); opacity: 0; } }
.sheet-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.close { display: inline-grid; place-items: center; width: 36px; height: 36px; border-radius: 8px; font-size: 22px; line-height: 1; color: var(--muted); text-decoration: none; }
.close:hover { background: var(--elevated); color: var(--ink); }
.status-card { border: 1px solid var(--edge, var(--line)); background: var(--fill, var(--surface)); border-radius: 8px; padding: 14px; margin-bottom: 20px; }
.status-card .sword { display: block; margin: 0 0 4px; }
.sc-title { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
.facts { font-size: 11px; color: var(--muted); }
.narrative { margin: 10px 0 0; color: var(--ink-2); }
.criteria { margin: 8px 0 0; padding-left: 0; list-style: none; display: grid; gap: 6px; }
.criteria li { border: 1px solid var(--line); border-radius: 4px; padding: 8px 10px; }
.criteria .sid { font-size: 11px; color: var(--muted); margin-right: 8px; }
.prio { font-size: 11px; color: var(--muted); }
@media (prefers-reduced-motion: reduce) { .sheet { animation: none; } }
@media (max-width: 767px) {
  body { height: auto; display: block; }
  .top { padding: 12px 16px; }
  .filters { padding: 10px 16px; }
  .filters input[type=search] { width: 100%; }
  main { background-image: none; }
  .board { width: auto; padding: 0 16px 32px; }
  .spine { display: none; }
  .lane { display: block; }
  .cell { width: auto; min-height: 0; }
  .cell:empty { display: none; }
  .cell::before { content: attr(data-activity); display: block; margin: 12px 0 6px; padding-bottom: 4px; border-bottom: 1px solid rgba(27,79,216,.3); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--brand); }
  .band { scroll-margin-top: 12px; }
  .divider { flex-wrap: wrap; gap: 4px 12px; }
  .rule { display: none; }
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
