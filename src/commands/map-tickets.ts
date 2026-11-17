// Ticketing mode on the live story map: how the map becomes tracker issues and epics, as tickets.yaml and the
// rules make it. The map stays as it is; cards show their issue, a click picks a card instead of opening it, and
// a panel lists the issues under their epics, the export for the agent, and the tracker fields. Each change is
// one of the tickets.* edits, sent like the page's other forms.
import type { StoryMapRef } from "../lib/maps.js";
import { exportTickets, ticketsHash, ticketsOf, type TicketIssue, type Tickets } from "./tickets.js";
import { hidden, opForm, pop, select, text, type Opt } from "./map-edit.js";
import type { StoryMap } from "./map.js";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const TINTS = 8;
const TRACKER: Record<string, string> = { jira: "Jira", linear: "Linear", github: "GitHub", gitlab: "GitLab", none: "Tracker" };
const trackerName = (system: string) => TRACKER[system] ?? system;

export interface TicketView {
  /** tickets.yaml's hash, the expect of each edit. */
  hash: string;
  t?: Tickets;
  /** Why the issues can't be shown: tickets.yaml doesn't read. */
  error?: string;
  /** Each story's issue, its number and its tint. */
  issueOf: Map<string, { issue: TicketIssue; num: number; tint: number }>;
}

/** The map's issues as the page shows them. A tickets.yaml that doesn't read is shown as its error. */
export function ticketViewOf(ref: StoryMapRef): TicketView {
  const issueOf = new Map<string, { issue: TicketIssue; num: number; tint: number }>();
  let t: Tickets | undefined;
  let error: string | undefined;
  try {
    t = ticketsOf(ref.root, ref.id);
    t.issues.forEach((issue, i) => {
      for (const s of issue.stories) issueOf.set(s.id, { issue, num: i + 1, tint: i % TINTS });
    });
  } catch (err) {
    error = (err as Error).message;
  }
  return { hash: ticketsHash(ref), t, error, issueOf };
}

/** A card's issue: its number and tint, a New mark before it has a key, and how many stories share it. Shown in Ticketing mode only. */
export function cardTicket(v: TicketView, storyId: string): { attrs: string; badge: string } {
  const at = v.issueOf.get(storyId);
  if (!at) return { attrs: "", badge: "" };
  const shared = at.issue.stories.length > 1;
  const label = `Issue ${at.num}${at.issue.key ? `, ${at.issue.key}` : ", not in the tracker yet"}${shared ? `, with ${at.issue.stories.length - 1} more ${at.issue.stories.length === 2 ? "story" : "stories"}` : ""}`;
  return {
    attrs: ` data-issue="${esc(at.issue.ref)}" style="--tk: var(--tk-${at.tint})"${shared ? " data-shared" : ""}`,
    badge: `<span class="tk-badge" title="${esc(label)}">#${at.num}${shared ? ` · ${at.issue.stories.length}` : ""}</span>${at.issue.key ? "" : `<span class="tk-new">New</span>`}`,
  };
}

/** The Story map | Ticketing switch for the top bar. */
export function modeSwitch(): string {
  return `<div class="seg tk-mode" role="group" aria-label="Mode"><button type="button" data-mode="map" aria-pressed="true">Story map</button><button type="button" data-mode="tickets" aria-pressed="false">Ticketing</button></div>`;
}

/** One rule's choices, each a small form that sets it. The one in force is marked. */
function ruleChoice(v: TicketView, name: "issues" | "epics", label: string, choices: [string, string][], now: string): string {
  const forms = choices
    .map(([value, word]) => opForm({ op: "tickets.rules", expect: v.hash, cls: `tool tk-opt${value === now ? " on" : ""}`, fields: hidden(name, value), submit: word, label: `${label}: ${word}${value === now ? " (now)" : ""}` }))
    .join("");
  return `<div class="tk-rule"><span class="tk-rule-k">${esc(label)}</span><span class="tk-seg">${forms}</span></div>`;
}

/** The bar over the map in Ticketing mode: the tracker project and the two rules. */
export function ticketBar(v: TicketView): string {
  if (!v.t) return `<div class="tk-bar tk-only"><p class="alert bad">${esc(v.error)}. Fix the file, then reload the page.</p></div>`;
  const t = v.t;
  const project = t.project
    ? `<span class="tk-project"><span class="tk-rule-k">${esc(trackerName(t.system))}</span><b class="mono">${esc(t.project)}</b></span>`
    : `<span class="tk-project warn">No tracker project yet: <code>nikos settings set tracker.project PAY</code></span>`;
  return `<div class="tk-bar tk-only" role="region" aria-label="Ticketing"><strong>Ticketing</strong>${project}${ruleChoice(v, "issues", "Each issue is", [["story", "One story"], ["step", "A step's stories, per release"]], t.rules.issues)}${ruleChoice(
    v,
    "epics",
    "Epics are",
    [["activity", "Activities"], ["release", "Releases"], ["none", "None"]],
    t.rules.epics,
  )}<span class="where">Click cards to pick them, then combine them into one issue. Saved in <code>maps/${esc(t.ref.id)}/tickets.yaml</code>.</span></div>`;
}

/** The epics an issue can go under: every activity or release the rules make epics of, the hand-made ones, and none. */
function epicOptions(t: Tickets, m: StoryMap, now?: string): Opt[] {
  const ids = [
    ...(t.rules.epics === "activity" ? m.activities.map((a) => `activity:${a.id}`) : []),
    ...(t.rules.epics === "release" ? m.releases.map((r) => `release:${r.number}`) : []),
    ...t.epics.map((e) => e.id),
  ];
  const title = (id: string) =>
    t.epics.find((e) => e.id === id)?.title ??
    (id.startsWith("activity:") ? (m.activities.find((a) => `activity:${a.id}` === id)?.title ?? id) : `Release ${id.slice(8)} · ${m.releases.find((r) => `release:${r.number}` === id)?.title ?? ""}`);
  return [...new Set(ids)].map((id) => ({ value: id, label: title(id), selected: id === now })).concat([{ value: "none", label: "No epic", selected: !now }]);
}

function issueBox(v: TicketView, m: StoryMap, issue: TicketIssue): string {
  const t = v.t!;
  const at = v.issueOf.get(issue.ref)!;
  const target = { story: issue.ref };
  const rename = opForm({ op: "tickets.rename", expect: v.hash, target, edit: true, cls: "tk-rename", fields: text("summary", "Summary", issue.summary, { hint: "Blank goes back to the summary the rules give it." }), submit: "Save" });
  const move = opForm({ op: "tickets.epic", expect: v.hash, target, cls: "tk-move", fields: select("epic", "Epic", epicOptions(t, m, issue.epic)), submit: "Move" });
  const split =
    issue.stories.length > 1 ? opForm({ op: "tickets.split", expect: v.hash, target, cls: "tool", fields: "", submit: `Split into ${issue.stories.length}`, label: `Split ${issue.summary} into one issue per story` }) : "";
  const stories = issue.stories.map((s) => `<a class="tk-story" href="#story-${esc(s.id)}"><span class="sid">${esc(s.id)}</span> ${esc(s.title)}</a>`).join("");
  const flags = [
    issue.key ? `<span class="tk-key mono">${esc(issue.key)}</span>` : `<span class="tk-new">New: not in the tracker yet</span>`,
    issue.releases.length > 1 ? `<span class="tk-warn">Spans ${issue.releases.map((n) => `R${n}`).join(" and ")}</span>` : "",
    issue.otherKeys.length ? `<span class="tk-warn">Also linked to ${esc(issue.otherKeys.join(", "))}</span>` : "",
  ].join("");
  return `<article class="tk-issue" id="tk-issue-${esc(issue.ref)}" style="--tk: var(--tk-${at.tint})"><div class="tk-issue-h"><span class="tk-badge">#${at.num}</span><span class="where">${esc(t.fields.issueType)}</span>${flags}</div>${rename}<div class="tk-stories">${stories}</div><div class="tk-issue-f">${move}${split}</div></article>`;
}

function issuesPane(v: TicketView, m: StoryMap): string {
  const t = v.t!;
  const stories = t.issues.reduce((n, i) => n + i.stories.length, 0);
  const sections = [...t.epics.map((e) => e as { id?: string; title: string; key?: string }), { id: undefined, title: "No epic" }]
    .map((e) => {
      const own = t.issues.filter((i) => i.epic === e.id);
      if (!own.length && !e.id) return "";
      const head = `<div class="tk-epic-h"><span class="tk-kind">${e.id ? esc(t.fields.epicType) : "—"}</span><strong>${esc(e.title)}</strong>${e.key ? `<span class="tk-key mono">${esc(e.key)}</span>` : e.id ? `<span class="tk-new">New</span>` : ""}<span class="where">${own.length} ${own.length === 1 ? "issue" : "issues"}</span></div>`;
      return `<section class="tk-epic">${head}${own.length ? own.map((i) => issueBox(v, m, i)).join("") : `<p class="where">No issues yet. Move one here with its Epic menu.</p>`}</section>`;
    })
    .join("");
  const warnings = t.warnings.map((w) => `<p class="alert warn">${esc(w)}</p>`).join("");
  const newEpic = pop("+ New epic", opForm({ op: "tickets.epic_new", expect: v.hash, fields: text("title", "Title", "", { required: true, placeholder: "e.g. Payments v2" }), submit: "Add epic" }), "tk-add", "Add an epic");
  return `<div class="tk-pane" data-tk-pane="issues"><div class="tk-sum"><span>${stories} ${stories === 1 ? "story" : "stories"} → ${t.issues.length} ${t.issues.length === 1 ? "issue" : "issues"} in ${t.epics.length} ${t.epics.length === 1 ? "epic" : "epics"}</span>${newEpic}</div>${warnings}${sections}</div>`;
}

function exportPane(v: TicketView): string {
  const t = v.t!;
  const head = `<p class="where">The file your agent reads. Epics come first, then issues, each to <b>create</b> (no key yet) or <b>update</b>. <code>nikos tickets export --out tickets.json</code> writes the same file.</p>`;
  if (!t.project) return `<div class="tk-pane" data-tk-pane="export" hidden>${head}<p class="alert warn">Say which tracker project the issues go in first: <code>nikos settings set tracker.project PAY</code></p></div>`;
  const out = exportTickets(t.ref.root, t.ref.id);
  const create = out.issues.filter((i) => i.action === "create").length + out.epics.filter((e) => e.action === "create").length;
  const update = out.issues.length + out.epics.length - create;
  const prompt =
    `Read the nikOS tickets file for maps/${t.ref.id} (nikos tickets export, or the tickets_export tool). Using the ${t.system === "none" ? "tracker's" : trackerName(t.system)} MCP, in project ${t.project}: ` +
    `${create ? `create the ${create} marked create, epics first, each issue under its epic` : "nothing needs creating"}${update ? `, and update the ${update} that have a key so their summary, description, epic and labels match` : ""}. ` +
    `Show me the list and ask before you change anything. Then record the new keys with nikos tickets keys (or tickets_keys).`;
  const keys = opForm({
    op: "tickets.keys",
    expect: "",
    cls: "tk-keys",
    fields: `<label class="fld wide"><span>Keys the tracker gave</span><textarea name="keys" rows="3" placeholder='{ "${esc(out.issues[0]?.ref ?? "PAY-CHK-1")}": "${esc(t.project)}-101" }'></textarea><small class="hint">As your agent reports them, or the exported file with each key filled in.</small></label>`,
    submit: "Record keys",
  });
  return `<div class="tk-pane" data-tk-pane="export" hidden>${head}<div class="tk-actions"><button type="button" class="btn small primary" data-tk-download="tickets-${esc(t.ref.id)}.json">Download tickets.json</button><button type="button" class="btn small" data-copy="${esc(prompt)}">Copy the agent prompt</button></div><p class="tk-prompt">${esc(prompt)}</p><pre class="tk-json" data-tk-json>${esc(JSON.stringify(out, null, 2))}</pre><div class="tk-after"><h4>After your agent runs</h4>${keys}</div></div>`;
}

function fieldsPane(v: TicketView): string {
  const f = v.t!.fields;
  const form = opForm({
    op: "tickets.fields",
    expect: v.hash,
    edit: true,
    submit: "Save fields",
    fields:
      text("issue_type", "Issue type", f.issueType, { required: true, changed: true }) +
      text("epic_type", "Epic type", f.epicType, { required: true, changed: true }) +
      text("label", "Label on everything", f.label, { changed: true, hint: "Blank for none. Story ids become labels too, unless they go in a custom field." }) +
      text("component", "Component", f.component, { changed: true, placeholder: "None" }) +
      text("story_ids", "Story ids go in", f.storyIds, { required: true, changed: true, hint: "labels, or a custom field's id, e.g. customfield_10042." }),
  });
  return `<div class="tk-pane" data-tk-pane="fields" hidden><p class="where">What the export fills in, for this map.</p>${form}</div>`;
}

/** The panel beside the map in Ticketing mode: Issues, Export and Fields. */
export function ticketPanel(v: TicketView, m: StoryMap): string {
  if (!v.t) return `<aside class="tk-panel tk-only" aria-label="Tickets"><p class="alert bad">${esc(v.error)}. Fix the file, then reload the page.</p></aside>`;
  const tab = (id: string, word: string, on = false) => `<button type="button" role="tab" data-tk-tab="${id}" aria-selected="${on}">${word}</button>`;
  return `<aside class="tk-panel tk-only" aria-label="Tickets"><div class="tk-tabs" role="tablist">${tab("issues", `Issues · ${v.t.issues.length}`, true)}${tab("export", "Export")}${tab("fields", "Fields")}</div>${issuesPane(v, m)}${exportPane(v)}${fieldsPane(v)}</aside>
<div class="tk-selbar" role="status" hidden><strong data-tk-count></strong><span class="tk-selnote" data-tk-note></span><button type="button" class="btn small primary" data-tk-combine>Combine into one issue</button><button type="button" class="btn small" data-tk-clear>Clear</button></div>`;
}

export const TICKETS_CSS = `
:root { --tk-0: #2f5fb3; --tk-1: #a94f17; --tk-2: #237a4b; --tk-3: #a3337f; --tk-4: #5b3fb0; --tk-5: #7f6200; --tk-6: #1f7480; --tk-7: #a63a3a; }
body:not(.ticketing) .tk-only, body:not(.ticketing) .tk-badge, body:not(.ticketing) .tk-new { display: none !important; }
.ticketing main .add, .ticketing .side-tools, .ticketing .band-tools, .ticketing .card .next-tag { display: none !important; }
.tk-mode button { min-height: 30px; }
.seg { display: inline-flex; border: 1px solid var(--line-strong); border-radius: 9px; padding: 2px; gap: 2px; background: var(--surface-2); }
.seg button { font: inherit; font-size: 13px; font-weight: 500; border: 0; border-radius: 7px; padding: 0 12px; background: transparent; color: var(--muted); cursor: pointer; }
.seg button[aria-pressed="true"] { background: var(--surface); color: var(--fg); box-shadow: 0 1px 2px rgba(20,16,40,.14); }
.work { flex: 1; min-height: 0; display: flex; }
.work > main { min-width: 0; }
.tk-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 18px; padding: 8px 24px; background: var(--accent-weak); border-bottom: 1px solid var(--line); font-size: 13px; }
.tk-rule { display: inline-flex; align-items: center; gap: 8px; }
.tk-rule-k { color: var(--muted); font-weight: 600; font-size: 12px; }
.tk-seg { display: inline-flex; border: 1px solid var(--line-strong); border-radius: 8px; padding: 2px; gap: 2px; background: var(--surface); }
.tk-seg .op.tool button { border: 0; background: transparent; color: var(--muted); }
.tk-seg .op.tool.on button { background: var(--accent); color: var(--accent-fg); pointer-events: none; }
.tk-seg .save-msg:empty { display: none; }
.tk-project { display: inline-flex; gap: 6px; align-items: baseline; }
.mono { font-family: var(--f-mono); }
.tk-badge { display: inline-flex; align-items: center; border-radius: 99px; padding: 0 7px; font-size: 11px; font-weight: 700; line-height: 18px; background: var(--tk, var(--accent)); color: #fff; white-space: nowrap; }
.tk-new { display: inline-flex; border-radius: 6px; padding: 0 6px; font-size: 11px; font-weight: 600; background: var(--warn-bg, #fcefd1); color: var(--warn); }
.tk-warn { font-size: 11px; font-weight: 600; color: var(--warn); }
.tk-key { font-size: 11px; border: 1px solid var(--line); border-radius: 99px; padding: 0 7px; background: var(--surface); }
.ticketing .card { cursor: pointer; }
.ticketing .card[data-shared] { background: color-mix(in srgb, var(--tk) 12%, var(--surface)); border-color: color-mix(in srgb, var(--tk) 45%, var(--line)); }
.ticketing .card.tk-sel { outline: 3px solid var(--accent); outline-offset: 1px; }
.tk-panel { flex: 0 0 400px; max-width: 46vw; min-height: 0; overflow: auto; border-left: 1px solid var(--line); background: var(--surface); padding: 0 16px 120px; }
.tk-tabs { position: sticky; top: 0; z-index: 2; display: flex; gap: 4px; background: var(--surface); border-bottom: 1px solid var(--line); margin: 0 -16px 12px; padding: 0 12px; }
.tk-tabs button { font: inherit; font-size: 14px; font-weight: 600; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--muted); padding: 10px 10px 8px; cursor: pointer; }
.tk-tabs button[aria-selected="true"] { color: var(--accent); border-bottom-color: var(--accent); }
.tk-pane { display: grid; gap: 12px; }
.tk-pane[hidden] { display: none; }
.tk-sum { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; color: var(--muted); }
.tk-epic { display: grid; gap: 8px; }
.tk-epic-h { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; padding-bottom: 4px; border-bottom: 1px solid var(--line); }
.tk-epic-h .where { margin: 0 0 0 auto; }
.tk-kind { font-size: 11px; font-weight: 700; border-radius: 6px; padding: 0 6px; background: var(--fg); color: var(--bg); }
.tk-issue { border: 1px solid var(--line); border-left: 0; box-shadow: inset 3px 0 0 var(--tk); border-radius: 10px; padding: 10px 12px; display: grid; gap: 8px; background: var(--bg); }
.tk-issue-h { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.tk-issue-h .where { margin: 0; }
form.op.tk-rename, form.op.tk-move { display: flex; align-items: end; gap: 6px; }
.tk-rename .op-fields, .tk-move .op-fields, .tk-keys .op-fields, .tk-add .op-fields { flex: 1; min-width: 0; grid-template-columns: minmax(0, 1fr); }
.tk-rename .fld > span, .tk-move .fld > span { font-size: 11px; color: var(--muted); }
.tk-rename .hint { display: none; }
.tk-issue .fld input, .tk-issue .fld select { padding: 4px 8px; font-size: 13px; }
.tk-issue .op button, .tk-panel .tk-keys button, .tk-panel .tk-add .op button { padding: 4px 10px; font-size: 13px; }
.tk-issue .op .actions { flex-wrap: nowrap; }
/* The Epic menu moves the issue as soon as it changes. */
.tk-move .actions button { display: none; }
.tk-issue .op.tool button { background: var(--surface); color: var(--fg); border-color: var(--line-strong); }
.tk-stories { display: flex; flex-wrap: wrap; gap: 4px; }
.tk-story { font-size: 12px; border: 1px solid var(--line); border-radius: 99px; padding: 1px 8px; color: var(--fg); text-decoration: none; background: var(--surface); }
.tk-issue-f { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; justify-content: space-between; }
.tk-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.tk-prompt { margin: 0; font-size: 13px; background: var(--surface-2); border-radius: 8px; padding: 10px 12px; }
.tk-json { margin: 0; max-height: 420px; overflow: auto; background: #1c1a26; color: #e9e6f5; border-radius: 10px; padding: 12px; font-family: var(--f-mono); font-size: 12px; line-height: 1.5; }
.tk-after h4 { margin: 4px 0 6px; }
.tk-selbar { position: fixed; z-index: 45; left: 50%; bottom: 76px; transform: translateX(-50%); display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; background: var(--fg); color: var(--bg); border-radius: 12px; padding: 10px 14px; box-shadow: 0 10px 28px rgba(20,16,40,.3); max-width: calc(100vw - 32px); }
.tk-selbar[hidden] { display: none; }
.tk-selnote { font-size: 13px; opacity: .8; }
@media (max-width: 900px) {
  .work { flex-direction: column; }
  .tk-panel { flex: 0 0 auto; max-width: none; max-height: 55vh; border-left: 0; border-top: 1px solid var(--line); }
  .tk-bar { padding-left: 16px; padding-right: 16px; }
}
`;

/** The mode switch, the panel's tabs, picking cards, Combine, the Epic menus and the download. Remembered: the mode and the tab. */
export const TICKETS_JS = `(function () {
var body = document.body;
var token = (document.querySelector('meta[name="nikos-token"]') || {}).content || "";
var picked = [];
function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
function cards(id) { return document.querySelectorAll('.card[data-story="' + id + '"]'); }
function paint() {
  var all = document.querySelectorAll(".card.tk-sel");
  for (var i = 0; i < all.length; i++) all[i].classList.remove("tk-sel");
  picked.forEach(function (id) { var c = cards(id); for (var j = 0; j < c.length; j++) c[j].classList.add("tk-sel"); });
  var bar = document.querySelector(".tk-selbar");
  if (!bar) return;
  bar.hidden = !picked.length;
  bar.querySelector("[data-tk-count]").textContent = picked.length + (picked.length === 1 ? " story picked" : " stories picked");
  bar.querySelector("[data-tk-note]").textContent = picked.length < 2 ? "Pick one more to combine them." : "They become one issue. Each story stays on the map.";
  bar.querySelector("[data-tk-combine]").disabled = picked.length < 2;
}
function setMode(mode) {
  body.classList.toggle("ticketing", mode === "tickets");
  var b = document.querySelectorAll("[data-mode]");
  for (var i = 0; i < b.length; i++) b[i].setAttribute("aria-pressed", String(b[i].getAttribute("data-mode") === mode));
  store("nikos-map-mode", mode);
  if (mode !== "tickets") { picked = []; paint(); }
}
function setTab(tab) {
  var tabs = document.querySelectorAll("[data-tk-tab]");
  if (!document.querySelector('[data-tk-tab="' + tab + '"]')) tab = "issues";
  for (var i = 0; i < tabs.length; i++) tabs[i].setAttribute("aria-selected", String(tabs[i].getAttribute("data-tk-tab") === tab));
  var panes = document.querySelectorAll("[data-tk-pane]");
  for (var j = 0; j < panes.length; j++) panes[j].hidden = panes[j].getAttribute("data-tk-pane") !== tab;
  store("nikos-map-tk-tab", tab);
}
document.addEventListener("click", function (e) {
  var t = e.target && e.target.closest ? e.target : null;
  if (!t) return;
  var mode = t.closest("[data-mode]");
  if (mode) { setMode(mode.getAttribute("data-mode")); return; }
  var tab = t.closest("[data-tk-tab]");
  if (tab) { setTab(tab.getAttribute("data-tk-tab")); return; }
  if (t.closest("[data-tk-clear]")) { picked = []; paint(); return; }
  if (t.closest("[data-tk-combine]")) { combine(); return; }
  var dl = t.closest("[data-tk-download]");
  if (dl) {
    var pre = document.querySelector("[data-tk-json]");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([pre ? pre.textContent : ""], { type: "application/json" }));
    a.download = dl.getAttribute("data-tk-download");
    document.body.appendChild(a); a.click(); a.remove();
    return;
  }
  if (!body.classList.contains("ticketing")) return;
  var card = t.closest(".card[data-issue]");
  if (!card) return;
  // In Ticketing mode a click picks the card; its story still opens from the panel's list.
  e.preventDefault();
  var id = card.getAttribute("data-story");
  var at = picked.indexOf(id);
  if (at >= 0) picked.splice(at, 1); else picked.push(id);
  paint();
}, true);
function combine() {
  var bar = document.querySelector(".tk-selbar");
  var note = bar.querySelector("[data-tk-note]");
  note.textContent = "Saving…";
  fetch("/api/op", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-nikos-token": token },
    body: JSON.stringify({ op: "tickets.combine", map: body.getAttribute("data-map"), args: { stories: picked }, expect: body.getAttribute("data-tickets") || "" }) })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); })
    .then(function (res) {
      if (res.ok) { note.textContent = res.body.message; setTimeout(function () { location.reload(); }, 600); return; }
      note.textContent = res.status === 409 ? "The tickets changed since the page loaded. Reload, then try again." : (res.body && res.body.error) || "Something went wrong.";
    }, function () { note.textContent = "Couldn't reach the story map. Is nikos serve still running?"; });
}
// An issue's Epic menu moves it as soon as another epic is picked.
document.addEventListener("change", function (e) {
  var s = e.target;
  if (s && s.name === "epic" && s.form && s.form.classList.contains("tk-move") && s.form.requestSubmit) s.form.requestSubmit();
});
if (store("nikos-map-mode") === "tickets") setMode("tickets");
setTab(store("nikos-map-tk-tab") || "issues");
})();`;
