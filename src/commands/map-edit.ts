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
  /** A screen reader name for the submit button, when its text is a symbol such as ↑. */
  label?: string;
  /** Extra classes: tool for the small buttons on a release's header. */
  cls?: string;
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
  const aria = f.label ? ` aria-label="${esc(f.label)}"` : "";
  return `<form class="op${f.cls ? ` ${f.cls}` : ""}" ${attrs}><div class="op-fields">${f.fields}</div><div class="actions"><button type="submit"${f.danger ? ' class="danger"' : ""}${aria}>${esc(f.submit)}</button><span class="save-msg" role="status"></span></div></form>`;
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

/**
 * The tools on a release's header: move it earlier or later, rename it, and remove it. Remove is offered only
 * for an empty release that names no bets of its own, as nikos release remove allows; otherwise it says why.
 */
export function releaseTools(r: MapRelease, count: number, storymap: string): string {
  const target = { release: String(r.number) };
  const move = (to: number, symbol: string, word: string) =>
    opForm({ op: "release.reorder", expect: storymap, target, cls: "tool", fields: hidden("to", String(to)), submit: symbol, label: `Move release ${r.number} ${word}` });
  const rename = pop(
    "Rename",
    opForm({
      op: "release.rename",
      expect: storymap,
      target,
      edit: true,
      submit: "Save",
      fields: text("title", "Title", r.title, { required: true }) + text("goal", "Goal", r.goal, { wide: true, hint: "What will be true when it ships. Optional." }),
    }),
    "tool-pop",
    `Rename release ${r.number}`,
  );
  const why = r.stories.length
    ? "Move its stories to another release first"
    : r.ownBets.length
      ? `It delivers ${r.ownBets.join(", ")}. Move ${r.ownBets.length === 1 ? "that" : "those"} to another release first`
      : "";
  const remove = why
    ? `<button type="button" class="tool" disabled title="${esc(why)}" aria-label="Remove release ${r.number}. ${esc(why)}">Remove</button>`
    : opForm({ op: "release.remove", expect: storymap, target, cls: "tool", danger: true, submit: "Remove", label: `Remove release ${r.number}`, confirm: `Remove release ${r.number}, ${r.title}? Later releases are renumbered.`, fields: "" });
  return `<span class="band-tools">${r.number > 1 ? move(r.number - 1, "↑", "earlier") : ""}${r.number < count ? move(r.number + 1, "↓", "later") : ""}${rename}${remove}</span>`;
}

/**
 * The "Add a story" dialog: its title, activity and step, release and priority, with the command it matches.
 * It opens from the button at the top of the page; each cell's "+ Story" still adds one in place.
 */
export function addStoryDialog(m: StoryMap, storymap: string): string {
  if (!m.releases.length || !m.activities.length) return "";
  const stepOpts: Opt[] = m.activities.flatMap((a) => a.steps.map((st) => ({ value: st.id, label: `${a.title} · ${st.title}`, attrs: ` data-activity="${esc(a.id)}"` })));
  const fields =
    text("title", "Title", "", { required: true, wide: true, placeholder: "What someone can do once it's built" }) +
    select("activity", "Activity", m.activities.map((a, i) => ({ value: a.id, label: a.title, selected: i === 0 })), { pick: "activity" }) +
    select("step", "Step", [{ value: "", label: "No step" }, ...stepOpts], { hint: "The steps of the chosen activity." }) +
    select("release", "Release", m.releases.map((r, i) => ({ value: String(r.number), label: `R${r.number} · ${r.title}`, selected: i === m.releases.length - 1 }))) +
    select("priority", "Priority", PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p], selected: p === "must" })));
  return `<dialog id="add-story" class="sheet-dialog" aria-labelledby="add-story-title"><div class="dialog-body"><div class="dialog-head"><h2 id="add-story-title">Add a story</h2><button type="button" class="close" data-close-dialog aria-label="Close">×</button></div>
${opForm({ op: "story.new", expect: storymap, fields, submit: "Add story" })}
<p class="where">It adds the story to storymap.yaml and writes a starter feature file with no scenarios yet. Your agent writes those next.</p></div></dialog>`;
}

/**
 * The "Move to" of a story's panel: another release, through the same move as nikos release move. Only a story
 * that is in a release, on a map with more than one, gets it.
 */
export function moveBox(s: MapStory, m: StoryMap, storymap: string): string {
  const now = m.releases.find((r) => r.stories.some((x) => x.id === s.id));
  if (!now || m.releases.length < 2) return "";
  const to = m.releases.filter((r) => r !== now).map((r) => ({ value: String(r.number), label: `R${r.number} · ${r.title}` }));
  const form = opForm({ op: "story.move", expect: storymap, target: { story: s.id }, fields: select("to", "Move to", to), submit: "Move" });
  const approval = s.status === "approved" ? `${s.approvedBy || "Its"}'s approval still holds` : "any approval still holds";
  return `<div class="sub move"><h4>Release</h4><p class="where">Now in R${now.number} · ${esc(now.title)}.</p>${form}<p class="where">It goes to the end of that release's build order. Only its release tag changes, so ${esc(approval)}.</p></div>`;
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
${moveBox(s, m, edit.storymap)}
<div class="sub"><h4>Details</h4>${details}${personaBox(edit.storymap)}</div>
<div class="sub"><h4>Placement</h4>${placement}</div>
<div class="sub"><h4>Acceptance criteria</h4>${criteria}${addCriterion}</div></div>`;
}

/** Edit-form styles. They use the shared tokens, so they follow the light and dark themes. */
export const EDIT_CSS = `
.add { position: relative; display: block; }
.add > summary { list-style: none; display: inline-flex; align-items: center; min-height: 26px; padding: 0 10px; border: 1.5px dashed var(--line-strong); border-radius: 7px; color: var(--muted); font-size: 12px; cursor: pointer; }
.add > summary::-webkit-details-marker { display: none; }
.add:hover > summary, .add[open] > summary { color: var(--accent); border-color: var(--accent); }
.add > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.add .pop { position: absolute; z-index: 6; top: calc(100% + 6px); left: 0; width: min(320px, 80vw); padding: 14px; border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); box-shadow: var(--shadow); }
.cell .add { margin-top: 4px; }
.activity .add { margin-top: 6px; }
.activity .add > summary { color: var(--accent-fg); border-color: color-mix(in srgb, var(--accent-fg) 60%, transparent); }
.slot { align-self: flex-start; }
.slot > summary { min-height: 40px; padding: 0 14px; }
.add-row { margin-top: 14px; }
form.op { display: grid; gap: 10px; margin: 0; }
.op-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; align-items: start; }
.op-fields .wide { grid-column: 1 / -1; }
.fld { display: flex; flex-direction: column; gap: 4px; min-width: 0; font-size: 12px; font-weight: 600; color: var(--fg); }
.fld input, .fld select, .fld textarea { font: inherit; font-weight: 400; font-size: 14px; width: 100%; padding: 7px 9px; border: 1px solid var(--line-strong); border-radius: 7px; background: var(--surface); color: var(--fg); }
.fld select[multiple] { min-height: 96px; }
.fld textarea { resize: vertical; min-height: 64px; }
.fld .hint { color: var(--muted); font-weight: 400; }
.op .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.op button { font: inherit; font-weight: 600; padding: 6px 14px; border-radius: 8px; border: 1px solid var(--accent); background: var(--accent); color: var(--accent-fg); cursor: pointer; }
.op button:disabled { opacity: .6; cursor: default; }
.op button.danger { background: transparent; color: var(--bad); border-color: var(--bad); }
.op .save-msg { color: var(--muted); font-size: 12px; }
.op .save-msg.error { color: var(--bad); }
.op.tool { display: inline-flex; }
.op.tool .op-fields { display: none; }
.op.tool .actions { gap: 4px; }
.tool, .op.tool button, .tool-pop > summary { font: inherit; font-size: 12px; font-weight: 500; min-height: 26px; padding: 0 9px; border: 1px solid var(--line); border-style: solid; border-radius: 6px; background: var(--surface); color: var(--fg); cursor: pointer; }
.op.tool button.danger { color: var(--bad); border-color: var(--line); background: var(--surface); }
.tool:disabled { opacity: .5; cursor: not-allowed; }
.band-tools { display: inline-flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.tool-pop { display: inline-block; }
.tool-pop > summary { display: inline-flex; align-items: center; }
.edit-area { display: grid; gap: 18px; margin-top: 22px; padding-top: 14px; border-top: 1px solid var(--line); }
.edit-area h4 { margin: 0 0 8px; font-size: 12px; font-weight: 600; color: var(--fg); }
.edit-area .sub { min-width: 0; }
.where { margin: 6px 0 0; font-size: 12px; color: var(--muted); }
.note { margin: 0; padding: 8px 10px; border-radius: 8px; background: var(--warn-bg); color: var(--warn); }
.edit-ac { margin-top: 6px; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; background: var(--surface); }
.edit-ac > summary { cursor: pointer; }
.edit-ac[open] { padding-bottom: 10px; }
.edit-ac .op { margin-top: 10px; }
.gwt { margin: 8px 0 0; display: grid; gap: 4px; font-size: 13px; }
.gwt div { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 8px; }
.gwt dt { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); padding-top: 2px; }
.gwt dd { margin: 0; color: var(--fg); }
.sheet .add { display: block; margin-top: 8px; }
.sheet .add .pop { position: static; width: auto; box-shadow: none; margin-top: 8px; }
.sheet .add-row .pop { position: static; }
.card[draggable="true"] { cursor: grab; }
.card.dragging { opacity: .4; }
.band.drop-ok .lane { background: var(--accent-weak); outline: 2px dashed var(--accent); outline-offset: 4px; border-radius: 8px; }
.band.drop-ok .divider h2 { color: var(--accent); }
.drag-msg { position: fixed; left: 50%; transform: translateX(-50%); bottom: 20px; z-index: 30; background: var(--fg); color: var(--bg); padding: 10px 16px; border-radius: 10px; font-size: 14px; max-width: calc(100% - 32px); }
.dialog-body { padding: 20px; display: grid; gap: 12px; }
.dialog-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.dialog-head h2 { margin: 0; font-size: 20px; }
.cmd { margin: 0; font-family: var(--f-mono); font-size: 12px; background: var(--surface-2); border-radius: 6px; padding: 8px 10px; white-space: pre-wrap; word-break: break-word; }
@media (max-width: 767px) {
  .editing .spine { display: block; position: static; padding-top: 12px; }
  .editing .activities { flex-direction: column; align-items: stretch; }
  .editing .activity { width: auto; }
  .editing .steps { display: none; }
  .editing .slot { align-self: stretch; }
  .op-fields { grid-template-columns: minmax(0, 1fr); }
  .add .pop { width: min(320px, calc(100vw - 48px)); }
  .divider { position: relative; left: 0; }
  .tool-pop { position: static; }
  .tool-pop .pop { left: 0; right: 0; width: auto; }
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
      // A new story opens in its panel after the reload, so its scenarios can be asked for next.
      var made = form.getAttribute("data-op") === "story.new" && /^Added (\\S+) to release/.exec(res.body.message || "");
      if (made) location.hash = "story-" + made[1];
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
// The command a story.new form matches, under the form, as the person types.
function quote(v) { return '"' + String(v).replace(/(["\\\\])/g, "\\\\$1") + '"'; }
function storyCommand(form) {
  var el = function (n) { var f = form.elements.namedItem(n); return f && showing(f) ? String(f.value || "").trim() : ""; };
  var parts = ["nikos story add", quote(el("title") || "<title>"), "--activity", el("activity")];
  if (el("step")) parts.push("--step", el("step"));
  if (el("release")) parts.push("--release", el("release"));
  if (el("priority")) parts.push("--priority", el("priority"));
  if (document.body.hasAttribute("data-several")) parts.push("--map", document.body.getAttribute("data-map"));
  return parts.join(" ");
}
var adds = document.querySelectorAll('form[data-op="story.new"]');
for (var a = 0; a < adds.length; a++) {
  (function (form) {
    var pre = document.createElement("pre");
    pre.className = "cmd";
    pre.setAttribute("aria-label", "The command this matches");
    form.insertBefore(pre, form.querySelector(".actions"));
    var update = function () { pre.textContent = storyCommand(form); };
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    update();
  })(adds[a]);
}
// Drag a story's card into another release's band to move it there. It keeps its activity and step.
var dragId = "", dragFrom = "";
var msg = document.createElement("div");
msg.className = "drag-msg";
msg.setAttribute("role", "status");
msg.hidden = true;
document.body.appendChild(msg);
function say(text) { msg.textContent = text; msg.hidden = false; }
function bandOf(e) {
  if (!dragId) return null;
  var band = e.target && e.target.closest ? e.target.closest(".band[data-number]") : null;
  if (!band || band.hidden || band.getAttribute("data-number") === dragFrom) return null;
  return band;
}
function clearDrop() { var on = document.querySelectorAll(".drop-ok, .dragging"); for (var i = 0; i < on.length; i++) on[i].classList.remove("drop-ok", "dragging"); }
document.addEventListener("dragstart", function (e) {
  var card = e.target && e.target.closest ? e.target.closest('.card[draggable="true"]') : null;
  if (!card) return;
  var band = card.closest(".band[data-number]");
  if (!band) return;
  dragId = card.getAttribute("data-story");
  dragFrom = band.getAttribute("data-number");
  card.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", dragId);
});
document.addEventListener("dragend", function () { dragId = ""; dragFrom = ""; clearDrop(); });
document.addEventListener("dragover", function (e) {
  var band = bandOf(e);
  var on = document.querySelectorAll(".band.drop-ok");
  for (var i = 0; i < on.length; i++) if (on[i] !== band) on[i].classList.remove("drop-ok");
  if (!band) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  band.classList.add("drop-ok");
});
document.addEventListener("drop", function (e) {
  var band = bandOf(e);
  if (!band) return;
  e.preventDefault();
  var id = dragId, to = band.getAttribute("data-number");
  clearDrop();
  say("Moving " + id + " to release " + to + "…");
  call("POST", "/api/op", { op: "story.move", map: document.body.getAttribute("data-map"), target: { story: id }, args: { to: Number(to) }, expect: document.body.getAttribute("data-storymap") || "" }).then(function (res) {
    if (res.ok) { say(res.body.message + ". It goes to the end of that release's build order."); setTimeout(function () { location.reload(); }, 900); return; }
    say(res.status === 409 ? "The map changed since the page loaded. Reload to see the latest, then try again." : errorOf(res));
  }, function () { say(gone()); });
});
var picks = document.querySelectorAll("select[data-pick=activity]");
for (var k = 0; k < picks.length; k++) pickSteps(picks[k]);
pendingBar();
})();`;
