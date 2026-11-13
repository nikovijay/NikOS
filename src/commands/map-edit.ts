// The edit forms of the live story map, served by nikos serve. The "+" buttons add an activity, a step,
// a story or a release, and a story's panel edits its details, placement and criteria. Each form posts one
// op through the save bar's call. Only the live page with a token gets any of this: the exported page
// stays read-only.
import { join } from "node:path";
import { criteriaOf, narrativeOf, PRIORITIES, STORY_TYPES, type Criterion } from "../lib/feature-edit.js";
import { featureStoryIds, isDone, read, walk } from "../lib/project.js";
import type { StoryMapRef } from "../lib/maps.js";
import { hash } from "../planning/model.js";
import { saveBarScript } from "../lib/save-bar.js";
import type { MapRelease, MapStory, StoryMap } from "./map.js";

/** What a story's forms need from its feature file: the file's hash (the expect of its changes) and its text parts. */
export interface EditStory {
  hash: string;
  asA: string;
  iWant: string;
  soThat: string;
  criteria: Criterion[];
  /** The file doesn't parse as Gherkin, so its criteria can't be read or changed here. */
  broken: boolean;
}
/** What the forms need from the map: the storymap.yaml hash (the expect of creates), and each story with a feature file. */
export interface EditData {
  storymap: string;
  stories: Map<string, EditStory>;
}

/** The edit data of a map, read from its files as they are now. */
export function editDataOf(ref: StoryMapRef): EditData {
  const stories = new Map<string, EditStory>();
  for (const file of walk(join(ref.dir, "features"), ".feature")) {
    const text = read(file);
    const id = featureStoryIds(text)[0];
    if (!id) continue;
    let criteria: Criterion[] = [];
    let broken = false;
    try {
      criteria = criteriaOf(text);
    } catch {
      broken = true;
    }
    stories.set(id, { hash: hash(text), ...narrativeOf(text), criteria, broken });
  }
  return { storymap: hash(read(join(ref.dir, "storymap.yaml"))), stories };
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const TYPE_LABEL: Record<string, string> = { user_story: "User story", technical: "Technical", bug_risk: "Bug risk" };
const PRIORITY_LABEL: Record<string, string> = { must: "Must", should: "Should", could: "Could" };
const KEYWORD: [keyof Pick<Criterion, "given" | "when" | "then">, string][] = [["given", "Given"], ["when", "When"], ["then", "Then"]];

interface Opt {
  value: string;
  label: string;
  selected?: boolean;
  attrs?: string;
}

/** A labelled control: its label, the control, and an optional hint under it. */
function field(label: string, control: string, o: { wide?: boolean; hint?: string } = {}): string {
  return `<label class="fld${o.wide ? " wide" : ""}"><span>${esc(label)}</span>${control}${o.hint ? `<small class="hint">${esc(o.hint)}</small>` : ""}</label>`;
}
function text(name: string, label: string, value: string, o: { required?: boolean; placeholder?: string; wide?: boolean; hint?: string; changed?: boolean } = {}): string {
  const attrs = `${o.required ? " required" : ""}${o.placeholder ? ` placeholder="${esc(o.placeholder)}"` : ""}${o.changed ? " data-changed" : ""}`;
  return field(label, `<input name="${esc(name)}" value="${esc(value)}"${attrs}>`, o);
}
/** One line per item, as the op takes them: the lines are split on the page and sent as a list. */
function lines(name: string, label: string, items: string[], o: { required?: boolean; wide?: boolean; hint?: string } = {}): string {
  const body = String.fromCharCode(10);
  return field(label, `<textarea name="${esc(name)}" data-list="lines" rows="3"${o.required ? " required" : ""}>${esc(items.join(body))}</textarea>`, o);
}
function select(name: string, label: string, options: Opt[], o: { multiple?: boolean; wide?: boolean; hint?: string; pick?: string; changed?: boolean } = {}): string {
  const attrs = `${o.multiple ? " multiple" : ""}${o.pick ? ` data-pick="${esc(o.pick)}"` : ""}${o.changed ? " data-changed" : ""}`;
  const opts = options.map((x) => `<option value="${esc(x.value)}"${x.selected ? " selected" : ""}${x.attrs ?? ""}>${esc(x.label)}</option>`).join("");
  return field(label, `<select name="${esc(name)}"${attrs}>${opts}</select>`, o);
}
const hidden = (name: string, value: string) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`;

interface OpForm {
  op: string;
  expect: string;
  target?: Record<string, string>;
  fields: string;
  submit: string;
  /** An edit sends a cleared field as blank, so the op can clear it. A create leaves blank fields out. */
  edit?: boolean;
  confirm?: string;
  danger?: boolean;
}

/** A form that posts one op. Its fields are read on submit, and the page's script posts them. */
function opForm(f: OpForm): string {
  const attrs = [
    `data-op="${esc(f.op)}"`,
    `data-target="${esc(JSON.stringify(f.target ?? {}))}"`,
    `data-expect="${esc(f.expect)}"`,
    f.edit ? "data-edit" : "",
    f.confirm ? `data-confirm="${esc(f.confirm)}"` : "",
  ].filter(Boolean).join(" ");
  return `<form class="op" ${attrs}><div class="op-fields">${f.fields}</div><div class="actions"><button type="submit"${f.danger ? ' class="danger"' : ""}>${esc(f.submit)}</button><span class="save-msg" role="status"></span></div></form>`;
}

/** A small "+" that opens its form. Quiet until hovered or focused; in the story panel it sits in the flow. label names it for a screen reader, with its place. */
function pop(summary: string, body: string, cls = "", label?: string): string {
  const aria = label ? ` aria-label="${esc(label)}"` : "";
  return `<details class="add${cls ? ` ${cls}` : ""}"><summary${aria}>${esc(summary)}</summary><div class="pop">${body}</div></details>`;
}

/** The "+ Activity" slot at the end of the activities row. */
export function addActivityBox(storymap: string): string {
  return pop("+ Activity", opForm({ op: "activity.new", expect: storymap, fields: text("title", "Title", "", { required: true, placeholder: "e.g. Plan the week" }), submit: "Add activity" }), "slot", "Add an activity");
}

/** The "+ Step" at the foot of an activity's box in the spine. */
export function addStepBox(activity: { id: string; title: string }, storymap: string): string {
  const fields = hidden("activity", activity.id) + text("title", "Title", "", { required: true, placeholder: "e.g. Focus on today" });
  return pop("+ Step", opForm({ op: "step.new", expect: storymap, fields, submit: "Add step" }), "", `Add a step to ${activity.title}`);
}

/**
 * The "+ Story" at the foot of a cell. In a release's band the story goes into that release. In the unreleased
 * band the form picks the release, since a story always lands in one; it starts at the last.
 */
export function addStoryBox(o: { activity: string; step: string; where: string; release?: number; releases: MapRelease[]; storymap: string }): string {
  const place =
    o.release !== undefined
      ? hidden("release", String(o.release))
      : select("release", "Release", o.releases.map((r, i) => ({ value: String(r.number), label: `R${r.number} · ${r.title}`, selected: i === o.releases.length - 1 })));
  const fields =
    text("title", "Title", "", { required: true, placeholder: "e.g. Save a draft" }) +
    place +
    hidden("activity", o.activity) +
    (o.step ? hidden("step", o.step) : "") +
    select("priority", "Priority", PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p], selected: p === "must" })));
  return pop("+ Story", opForm({ op: "story.new", expect: o.storymap, fields, submit: "Add story" }), "", `Add a story to ${o.where}`);
}

/** The "+ Release" after the last release band. */
export function addReleaseBox(storymap: string): string {
  const fields = text("title", "Title", "", { required: true, placeholder: "e.g. Sharing" }) + text("goal", "Goal", "", { wide: true, hint: "What the release is for. Optional." });
  return `<div class="add-row">${pop("+ Release", opForm({ op: "release.new", expect: storymap, fields, submit: "Add release" }), "release-add", "Add a release")}</div>`;
}

/** The "+ New persona" beside a story's personas. Its form is the map's, so it is checked against the storymap. */
function personaBox(storymap: string): string {
  const fields = text("title", "Name", "", { required: true, placeholder: "e.g. Weekly planner" }) + text("description", "Description", "", { wide: true, hint: "Who they are and what they need." });
  return pop("+ New persona", opForm({ op: "persona.new", expect: storymap, fields, submit: "Add persona" }), "", "Add a persona");
}

/** A criterion's Given, When and Then, as a short list. */
function steps(c: Criterion): string {
  const rows = KEYWORD.filter(([k]) => c[k].length).map(([k, word]) => `<div><dt>${word}</dt><dd>${c[k].map((t) => esc(t)).join("<br>")}</dd></div>`);
  return rows.length ? `<dl class="gwt">${rows.join("")}</dl>` : "";
}

/** One criterion: its steps, an edit form with its fields, and a remove button. */
function criterionBox(c: Criterion, s: MapStory, expect: string): string {
  const target = { story: s.id };
  // A criterion with no priority of its own keeps none until one is picked, so the blank choice is shown and can't be picked again.
  const priorities: Opt[] = c.priority
    ? PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p], selected: p === c.priority }))
    : [{ value: "", label: "No priority of its own", selected: true, attrs: " disabled" }, ...PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))];
  const remove = opForm({
    op: "scenario.remove",
    expect,
    target,
    submit: "Remove",
    danger: true,
    confirm: `Remove ${c.ac} from ${s.id}? Its steps go with it.`,
    fields: hidden("ac", c.ac),
  });
  const prio = c.priority ? ` <span class="prio">${esc(c.priority)}</span>` : "";
  const head = `<summary><span class="sid">${esc(c.ac)}</span>${esc(c.title)}${prio}</summary>`;
  // An edit would drop a Scenario Outline's Examples table, so its steps are changed in the feature file.
  if (c.outline) return `<details class="edit-ac">${head}${steps(c)}<p class="note">A Scenario Outline. Its steps are changed in the feature file; it can be removed here.</p>${remove}</details>`;
  const edit = opForm({
    op: "scenario.edit",
    expect,
    target,
    edit: true,
    submit: "Save criterion",
    fields:
      hidden("ac", c.ac) +
      text("title", "Title", c.title, { required: true, wide: true }) +
      select("priority", "Priority", priorities, { changed: true }) +
      lines("given", "Given", c.given, { hint: "One step per line." }) +
      lines("when", "When", c.when, { required: true }) +
      lines("then", "Then", c.then, { required: true }),
  });
  return `<details class="edit-ac">${head}${steps(c)}${edit}${remove}</details>`;
}

/**
 * The edit area under a story's read view: its details, its placement and its criteria. A story with no
 * feature file, or one that doesn't parse, says so instead.
 */
export function storyEditArea(s: MapStory, edit: EditData, m: StoryMap): string {
  const f = edit.stories.get(s.id);
  if (!f) return `<div class="edit-area"><p class="warn">This story has no feature file yet, so it can't be edited here.</p></div>`;
  if (f.broken) return `<div class="edit-area"><p class="warn">Its feature file has a Gherkin error, so it can't be edited here until that's fixed.</p></div>`;
  const target = { story: s.id };
  const release = m.releases.find((r) => r.stories.some((x) => x.id === s.id));
  // A field is sent only when the person changes it (data-changed), so saving the details can't rewrite what they didn't touch.
  const note = isDone(s.status) ? `<p class="note">Changing the title, the story or its criteria marks the spec as changed, and it needs signing off again.</p>` : "";
  const personas = m.personas.map((p) => ({ value: p.id, label: p.title, selected: s.personas.includes(p.id) }));
  // A story with no priority tag shows that, and the blank choice can't be picked again once another is.
  const priorities: Opt[] = s.priority
    ? PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p], selected: p === s.priority }))
    : [{ value: "", label: "No priority yet", selected: true, attrs: " disabled" }, ...PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))];
  const details = opForm({
    op: "story.edit",
    expect: f.hash,
    target,
    edit: true,
    submit: "Save details",
    fields:
      text("title", "Title", s.title, { required: true, wide: true, changed: true }) +
      text("as_a", "As a", f.asA, { placeholder: "a first user", changed: true }) +
      text("i_want", "I want", f.iWant, { changed: true }) +
      text("so_that", "So that", f.soThat, { changed: true }) +
      select("type", "Type", STORY_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t], selected: t === s.type })), { changed: true }) +
      select("priority", "Priority", priorities, { changed: true }) +
      select("personas", "Personas", personas, { multiple: true, wide: true, changed: true, hint: m.personas.length ? "Hold Ctrl or Cmd to pick more than one." : "No personas yet: add one below." }),
  });
  // Every activity's steps, each tagged with its activity: the page's script shows only the chosen activity's.
  const stepOpts: Opt[] = m.activities.flatMap((a) => a.steps.map((st) => ({ value: st.id, label: `${a.title} · ${st.title}`, selected: a.id === s.activity && st.id === s.step, attrs: ` data-activity="${esc(a.id)}"` })));
  const releases = m.releases.map((r) => ({ value: String(r.number), label: `R${r.number} · ${r.title}`, selected: r.number === release?.number }));
  const placement = opForm({
    op: "story.place",
    expect: f.hash,
    target,
    edit: true,
    submit: "Save placement",
    fields:
      // A story in no release can be put in one: the blank choice leaves it where it is.
      (release ? select("release", "Release", releases) : select("release", "Release", [{ value: "", label: "Not in a release yet", selected: true }, ...releases], { hint: "Pick a release to put it in one." })) +
      select("activity", "Activity", [{ value: "", label: "Choose an activity", selected: !m.activities.some((a) => a.id === s.activity) }, ...m.activities.map((a) => ({ value: a.id, label: a.title, selected: a.id === s.activity }))], { pick: "activity" }) +
      select("step", "Step", [{ value: "", label: "No step", selected: !s.step }, ...stepOpts], { hint: "The steps of the chosen activity." }),
  });
  const criteria = f.criteria.map((c) => criterionBox(c, s, f.hash)).join("");
  const addCriterion = pop(
    "Add a criterion",
    opForm({
      op: "scenario.add",
      expect: f.hash,
      target,
      submit: "Add criterion",
      fields:
        text("title", "Title", "", { required: true, wide: true }) +
        select("priority", "Priority", [{ value: "", label: "Same as the story", selected: true }, ...PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))]) +
        lines("given", "Given", [], { hint: "One step per line. Optional." }) +
        lines("when", "When", [], { required: true }) +
        lines("then", "Then", [], { required: true }),
    }),
  );
  return `<div class="edit-area"><h3 class="eyebrow">Edit this story</h3>${note}
<div class="sub"><h4>Details</h4>${details}${personaBox(edit.storymap)}</div>
<div class="sub"><h4>Placement</h4>${placement}</div>
<div class="sub"><h4>Acceptance criteria</h4>${criteria}${addCriterion}</div></div>`;
}

/** Edit-form styles. They use the page's tokens, so they follow the light and dark themes. */
export const EDIT_CSS = `
.add { position: relative; display: block; }
.add > summary { list-style: none; display: inline-flex; align-items: center; min-height: 24px; padding: 0 9px; border: 1px dashed var(--line-2); border-radius: 99px; color: var(--muted); font-size: 12px; cursor: pointer; }
.add > summary::-webkit-details-marker { display: none; }
.add:hover > summary, .add[open] > summary { color: var(--brand); border-color: var(--brand); }
.add > summary:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.add .pop { position: absolute; z-index: 6; top: calc(100% + 6px); left: 0; width: min(300px, 80vw); box-sizing: border-box; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); box-shadow: 0 16px 32px -12px rgba(0,0,0,.3); }
.cell .add { margin-top: 4px; }
.activity .add { margin-top: 6px; }
.slot { align-self: flex-start; }
.slot > summary { min-height: 40px; padding: 0 14px; }
.add-row { margin-top: 14px; }
form.op { display: grid; gap: 10px; margin: 0; }
.op-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; align-items: start; }
.op-fields .wide { grid-column: 1 / -1; }
.fld { display: flex; flex-direction: column; gap: 4px; min-width: 0; font-size: 12px; color: var(--ink-2); }
.fld input, .fld select, .fld textarea { font: inherit; font-size: 13px; width: 100%; box-sizing: border-box; padding: 6px 8px; border: 1px solid var(--line-2); border-radius: 6px; background: var(--surface); color: var(--ink); }
.fld select[multiple] { min-height: 96px; }
.fld textarea { resize: vertical; min-height: 64px; }
.fld .hint { color: var(--muted); }
.op .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.op button { font: inherit; font-weight: 600; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--brand); background: var(--brand); color: var(--surface); cursor: pointer; }
.op button:disabled { opacity: .6; cursor: default; }
.op button.danger { background: transparent; color: var(--stamp); border-color: var(--stamp); }
.op .save-msg { color: var(--muted); font-size: 12px; }
.op .save-msg.error { color: var(--stamp); }
.edit-area { display: grid; gap: 18px; margin-top: 22px; padding-top: 14px; border-top: 1px solid var(--line); }
.edit-area h4 { margin: 0 0 8px; font-size: 12px; font-weight: 600; color: var(--ink-2); }
.edit-area .sub { min-width: 0; }
.note { margin: 0; padding: 8px 10px; border-radius: 6px; background: var(--elevated); color: var(--warn); }
.edit-ac { margin-top: 6px; border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; }
.edit-ac > summary { cursor: pointer; }
.edit-ac[open] { padding-bottom: 10px; }
.edit-ac .op { margin-top: 10px; }
.gwt { margin: 8px 0 0; display: grid; gap: 4px; font-size: 13px; }
.gwt div { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 8px; }
.gwt dt { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); padding-top: 2px; }
.gwt dd { margin: 0; color: var(--ink-2); }
.sheet .add { display: block; margin-top: 8px; }
.sheet .add .pop { position: static; width: auto; box-shadow: none; margin-top: 8px; }
.sheet .add-row .pop { position: static; }
@media (max-width: 767px) {
  .editing .spine { display: block; position: static; padding-top: 12px; }
  .editing .activities { flex-direction: column; align-items: stretch; }
  .editing .activity { width: auto; }
  .editing .steps { display: none; }
  .editing .slot { align-self: stretch; }
  .op-fields { grid-template-columns: minmax(0, 1fr); }
  .add .pop { width: min(300px, calc(100vw - 48px)); }
}
`;

/** The page's edit script: the save bar, then the forms. Runs once; each form posts its op on submit. */
export const EDIT_JS = `(function () {
${saveBarScript("nikos serve", "story map")}
var NL = String.fromCharCode(10);
function showing(el) { return !el.closest("[hidden]"); }
// The activity picker of a placement form filters the step list to that activity's steps. Without a script
// every step shows, and the server refuses a step that isn't the activity's.
function pickSteps(select) {
  var steps = select.form ? select.form.elements.namedItem("step") : null;
  if (!steps || !steps.options) return;
  for (var i = 0; i < steps.options.length; i++) {
    var opt = steps.options[i];
    var mine = opt.value === "" || opt.getAttribute("data-activity") === select.value;
    opt.hidden = !mine;
    opt.disabled = !mine;
    if (!mine && opt.selected) steps.value = "";
  }
}
// A field marked data-changed is sent only when the person changed it, so a save keeps what it doesn't touch.
function changed(f) {
  if (f.tagName === "SELECT") {
    for (var k = 0; k < f.options.length; k++) if (f.options[k].selected !== f.options[k].defaultSelected) return true;
    return false;
  }
  return f.value !== f.defaultValue;
}
// What a field sends. An edit sends a cleared field as blank, so the op can clear it; a new thing sends only what has a value.
function readField(f, editing) {
  if (f.tagName === "SELECT" && f.multiple) {
    var picked = [];
    for (var j = 0; j < f.options.length; j++) if (f.options[j].selected && f.options[j].value !== "") picked.push(f.options[j].value);
    return picked.length || editing ? picked : undefined;
  }
  if (f.tagName === "TEXTAREA") {
    var items = f.value.split(NL).map(function (s) { return s.trim(); }).filter(function (s) { return s !== ""; });
    return items.length || editing ? items : undefined;
  }
  var value = f.value.trim();
  if (value === "") return editing ? "" : undefined;
  return value;
}
document.addEventListener("change", function (e) {
  var t = e.target;
  if (t && t.getAttribute && t.getAttribute("data-pick") === "activity") pickSteps(t);
});
document.addEventListener("submit", function (e) {
  var form = e.target;
  if (!form || !form.getAttribute || form.getAttribute("data-op") === null) return;
  e.preventDefault();
  var question = form.getAttribute("data-confirm");
  if (question && !window.confirm(question)) return;
  var out = form.querySelector(".save-msg");
  var sendBtn = form.querySelector('button[type="submit"]');
  var editing = form.hasAttribute("data-edit");
  var target = JSON.parse(form.getAttribute("data-target") || "{}");
  var args = {};
  var fields = form.querySelectorAll("input[name], select[name], textarea[name]");
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    if (!showing(f)) continue;
    if (f.hasAttribute("data-changed") && !changed(f)) continue;
    var value = readField(f, editing);
    if (value !== undefined) args[f.name] = value;
  }
  if (out) { out.className = "save-msg"; out.textContent = "Saving…"; }
  if (sendBtn) sendBtn.disabled = true;
  call("POST", "/api/op", { op: form.getAttribute("data-op"), map: document.body.getAttribute("data-map"), target: target, args: args, expect: form.getAttribute("data-expect") || "" }).then(function (res) {
    if (res.ok) {
      if (out) out.textContent = res.body.message;
      // Saved: load the page again. The story panel's hash stays in the address, so it opens where it was.
      setTimeout(function () { location.reload(); }, 800);
      return;
    }
    if (sendBtn) sendBtn.disabled = false;
    if (!out) return;
    out.className = "save-msg error";
    out.textContent = res.status === 409 ? "This changed since the page loaded. Reload to see the latest, then try again." : errorOf(res);
    if (res.status === 409) {
      var reload = document.createElement("button");
      reload.type = "button";
      reload.textContent = "Reload";
      reload.addEventListener("click", function () { location.reload(); });
      out.appendChild(document.createTextNode(" "));
      out.appendChild(reload);
    }
  }, function () {
    if (sendBtn) sendBtn.disabled = false;
    if (out) { out.className = "save-msg error"; out.textContent = gone(); }
  });
});
var picks = document.querySelectorAll("select[data-pick=activity]");
for (var k = 0; k < picks.length; k++) pickSteps(picks[k]);
pendingBar();
})();`;
