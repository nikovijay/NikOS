// The story map: activities as columns, releases as numbered bands, stories as cards tinted
// by state.yaml. Read-only and script-free: the page has nothing to edit and runs no code, so
// it can be shared as a file. Selecting a story opens its panel with :target, in CSS alone.
import { existsSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parse } from "yaml";
import { featureStoryIds, findIntentDir, read, walk } from "../lib/project.js";

export interface MapCriterion {
  id: string;
  title: string;
  priority: string;
}
export interface MapStory {
  id: string;
  title: string;
  activity: string;
  status: string;
  blocked: boolean;
  priority: string;
  effort: string;
  /** The user story sentence: As a…, I want…, So that…. */
  narrative: string;
  criteria: MapCriterion[];
}
export interface MapRelease {
  number: number;
  title: string;
  bets: string[];
  stories: MapStory[];
}
export interface StoryMap {
  project: string;
  activities: { id: string; title: string }[];
  releases: MapRelease[];
  /** Stories with a feature file that no release names. */
  unreleased: MapStory[];
}

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const yamlAt = (path: string) => (existsSync(path) ? parse(read(path)) : undefined);
const PRIORITY = /@(must|should|could|wont)\b/;

/** One story's details from its feature file: title, tags, narrative and criteria. */
function featureStory(text: string, id: string): Omit<MapStory, "status" | "blocked"> {
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
    priority: PRIORITY.exec(head)?.[1] ?? "",
    effort: /@effort-([A-Za-z0-9]+)/.exec(head)?.[1] ?? "",
    narrative: narrative.map((l, i) => (i ? l.replace(/^So that\b/, "so that") : l)).join(", "),
    criteria,
  };
}

/** The story map as data: activities, releases with their bets, and every story's status. */
export function storyMapOf(dir: string): StoryMap {
  const intent = findIntentDir(dir);
  const map = yamlAt(join(intent, "storymap.yaml")) ?? {};
  const states: Record<string, { status?: string; blockers?: string[] }> = yamlAt(join(intent, "state.yaml"))?.stories ?? {};
  const stateOf = (id: string) => ({ status: states[id]?.status ?? "todo", blocked: (states[id]?.blockers ?? []).length > 0 });
  const features = new Map<string, MapStory>();
  for (const file of walk(join(intent, "features"), ".feature")) {
    const text = read(file);
    const id = featureStoryIds(text)[0];
    if (!id) continue;
    features.set(id, { ...featureStory(text, id), ...stateOf(id) });
  }
  const story = (id: string): MapStory =>
    features.get(id) ?? { id, title: id, activity: "", priority: "", effort: "", narrative: "", criteria: [], ...stateOf(id) };
  const releases: MapRelease[] = (Array.isArray(map.releases) ? map.releases : []).map((r: any) => ({
    number: Number(r.number),
    title: String(r.title ?? `Release ${r.number}`),
    bets: Array.isArray(r.bets) ? r.bets.map(String) : [],
    stories: (Array.isArray(r.stories) ? r.stories : []).map((s: unknown) => story(String(s))),
  }));
  const placed = new Set(releases.flatMap((r) => r.stories.map((s) => s.id)));
  return {
    project: String(map.project ?? ""),
    activities: (Array.isArray(map.activities) ? map.activities : []).map((a: any) => ({ id: String(a.id), title: String(a.title ?? a.id) })),
    releases,
    unreleased: [...features.values()].filter((s) => !placed.has(s.id)),
  };
}

/** Each status's tint class and the word shown on its card. Blocked wins over the status. */
const STATUS: Record<string, { cls: string; word: string }> = {
  todo: { cls: "todo", word: "to do" },
  in_progress: { cls: "doing", word: "in progress" },
  needs_rework: { cls: "rework", word: "rework" },
  done: { cls: "done", word: "done" },
};
const statusOf = (s: MapStory) => (s.blocked ? { cls: "blocked", word: "blocked" } : STATUS[s.status] ?? STATUS.todo);
const pad = (n: number) => String(n).padStart(2, "0");

/** The whole story map as one standalone HTML page. */
export function renderMap(dir: string): string {
  const m = storyMapOf(dir);
  const known = new Set(m.activities.map((a) => a.id));
  const everything = [...m.releases.flatMap((r) => r.stories), ...m.unreleased];
  // Stories whose activity isn't on the map share one "Other" column.
  const columns = [...m.activities, ...(everything.some((s) => !known.has(s.activity)) ? [{ id: "", title: "Other" }] : [])];
  const columnOf = (s: MapStory) => (known.has(s.activity) ? s.activity : "");
  const card = (s: MapStory) => {
    const st = statusOf(s);
    const musts = s.criteria.filter((c) => c.priority === "must").length;
    const foot = s.criteria.length
      ? `<span>${s.criteria.length} ${s.criteria.length === 1 ? "criterion" : "criteria"}${musts ? ` · ${musts} must` : ""}</span>`
      : `<span class="warn">No criteria</span>`;
    return `<a class="card ${st.cls}" data-story="${esc(s.id)}" href="#story-${esc(s.id)}"><span class="crow"><span class="sid">${esc(s.id)}</span><span class="sword">${esc(st.word)}</span></span><span class="stitle">${esc(s.title)}</span><span class="cfoot">${foot}</span></a>`;
  };
  const tally = (stories: MapStory[]) => {
    const n = (f: (s: MapStory) => boolean) => stories.filter(f).length;
    const parts = [`${n((s) => s.status === "done")} done`, `${n((s) => s.status === "in_progress")} in progress`, `${n((s) => s.status === "todo")} to do`];
    const blocked = n((s) => s.blocked);
    return parts.join(" · ") + (blocked ? ` · <span class="warn">${blocked} blocked</span>` : "");
  };
  const band = (id: string, code: string, heading: string, bets: string[], stories: MapStory[]) => {
    const shipped = stories.length > 0 && stories.every((s) => s.status === "done");
    const chips = bets.map((b) => `<span class="bet">${esc(b)}</span>`).join("");
    const cells = columns
      .map((c) => `<div class="cell" data-activity="${esc(c.title)}">${stories.filter((s) => columnOf(s) === c.id).map(card).join("")}</div>`)
      .join("");
    return `<section class="band" id="${esc(id)}"><div class="divider"><span class="rnum">${esc(code)}</span><h2>${esc(heading)}</h2>${
      shipped ? `<span class="stamp">Shipped</span>` : ""
    }<span class="tally">${stories.length ? tally(stories) : "no stories"}</span><span class="rule"></span></div>${
      chips ? `<div class="bets"><span class="eyebrow">Delivers</span>${chips}</div>` : ""
    }${stories.length ? `<div class="lane">${cells}</div>` : `<p class="empty">No stories yet.</p>`}</section>`;
  };
  const bands = m.releases.map((r) => band(`release-${r.number}`, pad(r.number), `Release ${r.number} · ${r.title}`, r.bets, r.stories)).join("");
  const unreleased = m.unreleased.length ? band("unreleased", "--", "Not in a release", [], m.unreleased) : "";
  const spine = `<div class="spine">${columns.map((c) => `<div class="activity"><span class="eyebrow">Activity</span><strong>${esc(c.title)}</strong></div>`).join("")}</div>`;
  const jumps = [
    ...m.releases.map((r) => `<a class="jump" href="#release-${r.number}"><span class="rcode">R${r.number}</span>${esc(r.title)}<span class="count">${r.stories.length}</span></a>`),
    ...(m.unreleased.length ? [`<a class="jump" href="#unreleased">Not in a release<span class="count">${m.unreleased.length}</span></a>`] : []),
  ].join("");
  const panel = (s: MapStory) => {
    const st = statusOf(s);
    const facts = [s.id, s.priority, s.effort && `effort ${s.effort}`].filter(Boolean).map((f) => esc(f)).join(" · ");
    const criteria = s.criteria.length
      ? `<ol class="criteria">${s.criteria.map((c) => `<li><span class="sid">${esc(c.id)}</span>${esc(c.title)}${c.priority ? ` <span class="prio">${esc(c.priority)}</span>` : ""}</li>`).join("")}</ol>`
      : `<p class="warn">No criteria yet.</p>`;
    return `<div class="sheet-wrap" id="story-${esc(s.id)}"><a class="scrim" href="#" aria-label="Close"></a><aside class="sheet" aria-label="${esc(s.id)}"><div class="sheet-head"><span class="sid">${esc(s.id)}</span><a class="close" href="#" aria-label="Close">×</a></div><div class="status-card ${st.cls}"><span class="sword">${esc(st.word)}</span><div class="sc-title">${esc(s.title)}</div><div class="facts">${facts}</div>${
      s.narrative ? `<p class="narrative">${esc(s.narrative)}</p>` : ""
    }</div><div class="eyebrow">Acceptance criteria</div>${criteria}</aside></div>`;
  };
  const title = m.project ? `${m.project} · Story map` : "Story map";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<header class="top"><h1>${esc(title)}</h1><nav class="jumps" aria-label="Releases">${jumps}</nav></header>
<main>
<div class="board" style="--cols:${Math.max(1, columns.length)}">
${spine}
${bands}
${unreleased}
</div>
</main>
${everything.map(panel).join("\n")}
</body>
</html>
`;
}

const CSS = `
:root { --paper: #FAFAF7; --surface: #FFFFFF; --elevated: #F2F0E9; --line: #E8E6DF; --line-2: #D6D3C8; --ink: #1A1A18; --ink-2: #57534E; --muted: #6E695F; --brand: #1B4FD8; --brand-subtle: rgba(27,79,216,.07); --stamp: #DC2626; --warn: #B45309; --col: 240px; --gap: 16px; }
* { box-sizing: border-box; }
body { margin: 0; height: 100vh; display: flex; flex-direction: column; background: var(--paper); color: var(--ink); font: 13px/1.45 Inter, system-ui, -apple-system, "Segoe UI", sans-serif; }
.sid, .rnum, .rcode, .count, .tally, .cfoot, .facts, .stamp { font-family: "JetBrains Mono", ui-monospace, Menlo, monospace; }
.eyebrow { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-2); }
.warn { color: var(--warn); font-weight: 600; }
.top { padding: 16px 24px 12px; display: flex; flex-wrap: wrap; gap: 10px 24px; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line); background: var(--paper); }
h1 { font-size: 15px; margin: 0; }
.jumps { display: flex; flex-wrap: wrap; gap: 6px; }
.jump { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border: 1px solid var(--line); border-radius: 99px; background: var(--surface); color: var(--ink); text-decoration: none; font-size: 12px; }
.jump:hover { border-color: var(--line-2); }
.rcode, .count { font-size: 11px; color: var(--muted); }
main { flex: 1; min-height: 0; overflow: auto; background-color: var(--paper); background-image: linear-gradient(rgba(26,26,24,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(26,26,24,.06) 1px, transparent 1px); background-size: 24px 24px; background-attachment: local; }
.board { width: max-content; min-width: 100%; padding: 0 24px 48px; }
.spine { position: sticky; top: 0; z-index: 3; display: flex; gap: var(--gap); padding: 24px 0 4px; background: var(--paper); }
.activity { width: var(--col); display: grid; gap: 2px; background: var(--surface); border: 1px solid var(--line); border-top: 2px solid var(--brand); border-radius: 4px; padding: 10px 14px; box-shadow: 0 1px 2px rgba(60,50,30,.06); }
.activity strong { font-size: 13px; }
.band { scroll-margin-top: 90px; }
.divider { display: flex; align-items: center; gap: 12px; margin: 20px 0 10px; }
.rnum { color: var(--brand); font-size: 13px; font-weight: 600; }
.divider h2 { margin: 0; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-2); white-space: nowrap; }
.tally { font-size: 11px; color: var(--muted); white-space: nowrap; }
.rule { flex: 1; border-top: 1px solid var(--line); min-width: 24px; }
.stamp { display: inline-block; transform: rotate(-3deg); color: var(--stamp); border: 2px solid var(--stamp); box-shadow: inset 0 0 0 1px rgba(220,38,38,.45); padding: .15rem .5rem; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; opacity: .85; mix-blend-mode: multiply; }
.bets { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: -4px 0 10px; }
.bet { font-size: 12px; padding: 2px 9px; border-radius: 99px; background: var(--brand-subtle); color: var(--brand); }
.lane { display: flex; gap: var(--gap); }
.cell { width: var(--col); min-height: 48px; display: flex; flex-direction: column; gap: 4px; }
.empty { color: var(--muted); margin: 0 0 8px; }
.card { --fill: #F4F3EE; --edge: #E3E1D9; --word: #7D786E; display: flex; flex-direction: column; min-height: 32px; border: 1px solid var(--edge); border-radius: 4px; background: var(--fill); color: var(--ink); text-decoration: none; box-shadow: 0 1px 2px rgba(60,50,30,.06); }
.card:hover { border-color: var(--line-2); }
.card:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; box-shadow: 0 0 0 5px rgba(27,79,216,.15); }
.crow { display: flex; align-items: baseline; gap: 6px; padding: 4px 8px 0; }
.card .sid { font-size: 11px; letter-spacing: .06em; color: var(--muted); }
.sword { margin-left: auto; font-size: 11px; font-weight: 500; color: var(--word); }
.sword::first-letter { text-transform: uppercase; }
.stitle { padding: 2px 8px; font-size: 13px; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.cfoot { display: flex; justify-content: space-between; padding: 0 8px 4px; font-size: 11px; letter-spacing: .04em; color: var(--muted); }
.doing { --fill: #EDF3FD; --edge: #CFDDF8; --word: #1E7A50; }
.card.doing { border-left: 4px solid #1E9E5C; }
.rework { --fill: #F1EEFB; --edge: #DCD5F3; --word: #C2680F; }
.card.rework { border-left: 4px solid #E8892B; }
.done { --fill: #F1EEFB; --edge: #DCD5F3; --word: #6D5BB8; }
.card.done .stitle { text-decoration: line-through; text-decoration-color: rgba(26,26,24,.35); }
.blocked { --fill: #FDECEC; --edge: #F3C2C2; --word: #B83232; }
.card.blocked { border-left: 4px solid #D64545; }
.sheet-wrap { display: none; }
.sheet-wrap:target { display: block; position: fixed; inset: 0; z-index: 10; }
.scrim { position: absolute; inset: 0; background: rgba(0,0,0,.4); }
.sheet { position: absolute; top: 0; right: 0; bottom: 0; width: 700px; max-width: 95vw; overflow-y: auto; background: var(--surface); border-left: 1px solid var(--line); box-shadow: 0 25px 50px -12px rgba(0,0,0,.25); padding: 16px 20px 32px; animation: slide .28s cubic-bezier(.2,.8,.3,1); }
@keyframes slide { from { transform: translateX(40px); opacity: 0; } }
.sheet-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.close { font-size: 22px; line-height: 1; color: var(--muted); text-decoration: none; padding: 0 4px; }
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

/** `nikos map`: write the story map as a standalone page. */
export function runMap(args: string[]): number {
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const out = resolve(flag("--out") ?? "storymap.html");
  const dir = resolve(flag("--dir") ?? process.cwd());
  try {
    if (!existsSync(join(findIntentDir(dir), "storymap.yaml"))) throw new Error(`No storymap.yaml in ${findIntentDir(dir)}: run nikos init first`);
    writeFileSync(out, renderMap(dir));
    const shown = relative(process.cwd(), out);
    console.log(`Wrote ${shown && !shown.startsWith("..") ? shown : out}`);
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
