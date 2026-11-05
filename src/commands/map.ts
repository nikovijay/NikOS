// The story map: activities as columns, releases as bands, stories as cards coloured by
// state.yaml. Read-only: the page has nothing to edit, so it can be shared as a file.
import { existsSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parse } from "yaml";
import { featureStoryIds, findIntentDir, read, walk } from "../lib/project.js";

export interface MapStory {
  id: string;
  title: string;
  activity: string;
  status: string;
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

/** The story map as data: activities, releases with their bets, and every story's status. */
export function storyMapOf(dir: string): StoryMap {
  const intent = findIntentDir(dir);
  const map = yamlAt(join(intent, "storymap.yaml")) ?? {};
  const states: Record<string, { status?: string }> = yamlAt(join(intent, "state.yaml"))?.stories ?? {};
  const features = new Map<string, MapStory>();
  for (const file of walk(join(intent, "features"), ".feature")) {
    const text = read(file);
    const id = featureStoryIds(text)[0];
    if (!id) continue;
    const title = /^\s*Feature:\s*(.+)$/m.exec(text)?.[1].trim() ?? id;
    const head = text.split(/^\s*Feature:/m)[0];
    const activity = /@activity-([a-z0-9-]+)/.exec(head)?.[1] ?? "";
    features.set(id, { id, title, activity, status: states[id]?.status ?? "todo" });
  }
  const story = (id: string): MapStory => features.get(id) ?? { id, title: id, activity: "", status: states[id]?.status ?? "todo" };
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

const STATUS_CLASS: Record<string, string> = { done: "done", in_progress: "doing", blocked: "blocked" };

/** The whole story map as one standalone HTML page. */
export function renderMap(dir: string): string {
  const m = storyMapOf(dir);
  const known = new Set(m.activities.map((a) => a.id));
  const everything = [...m.releases.flatMap((r) => r.stories), ...m.unreleased];
  // Stories whose activity isn't on the map share one "Other" column.
  const columns = [...m.activities, ...(everything.some((s) => !known.has(s.activity)) ? [{ id: "", title: "Other" }] : [])];
  const columnOf = (s: MapStory) => (known.has(s.activity) ? s.activity : "");
  const card = (s: MapStory) =>
    `<div class="card ${STATUS_CLASS[s.status] ?? "todo"}" data-story="${esc(s.id)}"><span class="sid">${esc(s.id)}</span><span class="stitle">${esc(s.title)}</span><span class="sstatus">${esc(s.status.replace(/_/g, " "))}</span></div>`;
  const band = (id: string, heading: string, bets: string[], stories: MapStory[]) => {
    const chips = bets.map((b) => `<span class="bet">${esc(b)}</span>`).join("");
    const cells = columns.map((c) => `<div class="cell">${stories.filter((s) => columnOf(s) === c.id).map(card).join("")}</div>`).join("");
    return `<section class="band" id="${esc(id)}"><h2>${esc(heading)}</h2>${chips ? `<div class="bets"><span class="muted">Delivers</span>${chips}</div>` : ""}${
      stories.length ? `<div class="grid" style="--cols:${Math.max(1, columns.length)}">${cells}</div>` : `<p class="muted">No stories yet.</p>`
    }</section>`;
  };
  const bands = m.releases.map((r) => band(`release-${r.number}`, `Release ${r.number} · ${r.title}`, r.bets, r.stories)).join("");
  const unreleased = m.unreleased.length ? band("unreleased", "Not in a release", [], m.unreleased) : "";
  const heads = `<div class="grid heads" style="--cols:${Math.max(1, columns.length)}">${columns.map((c) => `<div class="cell-head">${esc(c.title)}</div>`).join("")}</div>`;
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
<header class="top">
<h1>${esc(title)}</h1>
<div class="legend"><span><i class="done"></i>done</span><span><i class="doing"></i>in progress</span><span><i class="blocked"></i>blocked</span><span><i class="todo"></i>to do</span></div>
</header>
<main>
${heads}
${bands}
${unreleased}
</main>
</body>
</html>
`;
}

const CSS = `
:root { --ground: #F2F3EF; --surface: #FFFFFF; --ink: #111411; --ink-2: #3F453F; --muted: #5C625C; --line: #DCDFD8; --line-2: #B9BEB6; --accent: #14823E; --accent-soft: #E2EFE5; --amber: #A86A00; --amber-soft: #FBF1DC; --blue: #1F5FA8; --blue-soft: #E3ECF7; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--ground); color: var(--ink); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
.top { padding: 20px 24px 12px; display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: baseline; justify-content: space-between; }
h1 { font-size: 20px; margin: 0; }
h2 { font-size: 15px; margin: 0 0 8px; }
main { padding: 0 24px 48px; overflow-x: auto; }
.muted { color: var(--muted); font-size: 13px; }
.legend { display: flex; gap: 14px; font-size: 12px; color: var(--ink-2); }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; border: 1px solid var(--line-2); background: var(--surface); }
.legend i.done, .card.done { background: var(--accent-soft); border-color: var(--accent); }
.legend i.doing, .card.doing { background: var(--blue-soft); border-color: var(--blue); }
.legend i.blocked, .card.blocked { background: var(--amber-soft); border-color: var(--amber); }
.grid { display: grid; grid-template-columns: repeat(var(--cols), minmax(190px, 1fr)); gap: 10px; min-width: calc(var(--cols) * 200px); }
.grid.heads { margin-bottom: 14px; }
.cell-head { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); padding: 0 2px; }
.band { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 14px; margin-bottom: 14px; scroll-margin-top: 12px; }
.bets { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: -2px 0 10px; font-size: 12px; }
.bet { background: var(--blue-soft); color: var(--blue); border-radius: 99px; padding: 2px 9px; }
.cell { display: flex; flex-direction: column; gap: 8px; min-height: 40px; }
.card { background: var(--surface); border: 1px solid var(--line-2); border-left-width: 4px; border-radius: 7px; padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; }
.sid { font: 12px ui-monospace, Menlo, monospace; color: var(--muted); }
.stitle { font-weight: 600; }
.sstatus { font-size: 12px; color: var(--ink-2); }
@media (max-width: 720px) { main { padding: 0 12px 32px; } .top { padding: 16px 12px 8px; } }
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
