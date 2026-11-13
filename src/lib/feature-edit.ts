// Edits to a feature file's text, as pure functions: each takes the file's text and returns the new
// text. The story ops (commands/story.ts) write the result. Only the lines an edit names change: the
// tags, the comments, the rule headings and the other criteria stay as they were.
import { parseFeature, scenariosOf } from "../lint/gherkin.js";
import { featureStoryIds } from "./project.js";
import { titleProblem } from "../planning/rules.js";

export const PRIORITIES = ["must", "should", "could"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const STORY_TYPES = ["user_story", "technical", "bug_risk"] as const;
export type StoryType = (typeof STORY_TYPES)[number];

const AC_TAG = /^@AC(\d+)$/;
const PRIORITY_TAG = /^@(must|should|could)$/;
const TYPE_WORD: Record<StoryType, string | undefined> = { user_story: undefined, technical: "technical", bug_risk: "bug-risk" };

/** The fields a story edit may change. A field left undefined is kept as it is. */
export interface StoryFields {
  title?: string;
  asA?: string;
  iWant?: string;
  soThat?: string;
  type?: string;
  /** Persona ids. An empty list removes them all. */
  personas?: string[];
  priority?: string;
}

/** A criterion's content. A priority not given (or blank) keeps the criterion's own; one with none keeps none. */
export interface CriterionInput {
  title: string;
  priority?: string;
  given?: string[];
  when?: string[];
  then?: string[];
}

/** A criterion as the file has it: its label, title, priority, and its steps by group and in order. */
export interface Criterion {
  ac: string;
  title: string;
  priority?: Priority;
  given: string[];
  when: string[];
  then: string[];
  steps: { keyword: string; text: string }[];
  /** A Scenario Outline: its steps can be removed here, but not edited. */
  outline: boolean;
}

/** The lines of a file, whether its line breaks are LF or CRLF. */
const linesOf = (text: string) => text.split(/\r?\n/);
/** The line break a file uses: CRLF when it has one, else LF. Edits join lines with it, so a CRLF file stays CRLF. */
const eolOf = (text: string) => (text.includes("\r\n") ? "\r\n" : "\n");

/** The line index of the Feature: line, or -1. */
const featureAt = (lines: string[]) => lines.findIndex((l) => /^\s*Feature:/.test(l));

/** Where a feature's description is: the lines after Feature: up to its first tag or scenario, as [from, to). */
function descriptionRange(lines: string[], at: number): [number, number] {
  let to = at + 1;
  while (to < lines.length && !/^\s*(@|(Scenario( Outline)?|Background|Rule|Example)\s*:)/.test(lines[to])) to++;
  return [at + 1, to];
}

/**
 * Replace the tags above Feature: that match isOurs with next. The new tags go where the first
 * matching one stood; with none, after the tag `after` (e.g. the story id), else at the end of the
 * last tag line. A tag line left with no tags is dropped, and a tag line whose tags don't change keeps its text.
 */
function editHeadTags(text: string, isOurs: (tag: string) => boolean, next: string[], after?: string): string {
  const lines = linesOf(text);
  const at = featureAt(lines);
  if (at < 0) throw new Error("The feature has no Feature: line");
  const heads: number[] = [];
  for (let k = 0; k < at; k++) if (lines[k].trim().startsWith("@")) heads.push(k);
  if (!heads.length) throw new Error("The feature has no tag line above Feature:");
  const tagsOf = (k: number) => lines[k].trim().split(/\s+/).filter(Boolean);
  let where: { line: number; index: number } | undefined;
  for (const k of heads) {
    const i = tagsOf(k).findIndex(isOurs);
    if (i >= 0) {
      where = { line: k, index: i };
      break;
    }
  }
  if (!where) {
    const k = after ? heads.find((n) => tagsOf(n).includes(`@${after}`)) : undefined;
    const last = heads[heads.length - 1];
    where = k !== undefined ? { line: k, index: tagsOf(k).indexOf(`@${after}`) + 1 } : { line: last, index: tagsOf(last).length };
  }
  const out: string[] = [];
  lines.forEach((line, k) => {
    if (!heads.includes(k)) return void out.push(line);
    const before = tagsOf(k);
    const tags = before.filter((t) => !isOurs(t));
    if (k === where.line) tags.splice(where.index, 0, ...next);
    if (!tags.length) return;
    out.push(tags.join(" ") === before.join(" ") ? line : line.match(/^\s*/)![0] + tags.join(" "));
  });
  return out.join(eolOf(text));
}

/** The story id on the feature: the tags that place a new one go after it. */
const idOf = (text: string) => featureStoryIds(text)[0];

/** The priority the feature carries (must, should or could), or undefined. */
export function priorityOf(text: string): Priority | undefined {
  const head = text.split(/^\s*Feature:/m)[0];
  const m = /(?:^|\s)@(must|should|could)(?=\s|$)/m.exec(head);
  return m ? (m[1] as Priority) : undefined;
}

/** The title on the Feature: line, or "" when there is none. */
export function titleOf(text: string): string {
  return /^\s*Feature:[ \t]*([^\r\n]*)/m.exec(text)?.[1].trim() ?? "";
}

/**
 * The three narrative parts as the file has them, without their leading words: "a first user",
 * "pay for my basket", "I get my order". The page shows each one after its label.
 */
export function narrativeOf(text: string): { asA: string; iWant: string; soThat: string } {
  const lines = linesOf(text);
  const at = featureAt(lines);
  if (at < 0) return { asA: "", iWant: "", soThat: "" };
  const [from, to] = descriptionRange(lines, at);
  const find = (re: RegExp) => {
    for (let k = from; k < to; k++) {
      const m = re.exec(lines[k]);
      if (m) return m[1].trim();
    }
    return "";
  };
  return { asA: find(/^\s*As\s+(.*)$/), iWant: find(/^\s*I want\s+(.*)$/), soThat: find(/^\s*So that\s+(.*)$/) };
}

/** One line of text, or the message that says why it isn't one. */
function oneLine(label: string, v: string): string {
  if (/[\r\n]/.test(v)) throw new Error(`${label} is one line (no line breaks)`);
  const t = v.trim();
  if (!t) throw new Error(`The "${label}" line needs some words`);
  return t;
}

/** The "As a" part with its article: "first user" becomes "a first user"; "an admin" stays as it is. */
function asAPart(v: string): string {
  const t = oneLine("As a", v.replace(/^\s*As\s+/i, ""));
  return /^(an?|the)\s/i.test(t) ? t : `a ${t}`;
}

/**
 * Set the narrative parts that are given. A part the file already has is left as the file writes it, so a
 * save that changes nothing changes no text. A part the file lacks is added just after Feature:.
 */
export function setNarrative(text: string, parts: { asA?: string; iWant?: string; soThat?: string }): string {
  const lines = linesOf(text);
  const at = featureAt(lines);
  if (at < 0) throw new Error("The feature has no Feature: line");
  const [from, to] = descriptionRange(lines, at);
  const now = narrativeOf(text);
  const wanted: { re: RegExp; lead: RegExp; value?: string; current: string; line: (v: string) => string }[] = [
    { re: /^\s*As\s/, lead: /^\s*As\s+/i, value: parts.asA, current: now.asA, line: (v) => `  As ${asAPart(v)}` },
    { re: /^\s*I want\b/, lead: /^\s*I want\s+/i, value: parts.iWant, current: now.iWant, line: (v) => `  I want ${oneLine("I want", v)}` },
    { re: /^\s*So that\b/, lead: /^\s*So that\s+/i, value: parts.soThat, current: now.soThat, line: (v) => `  So that ${oneLine("So that", v)}` },
  ];
  const missing: string[] = [];
  for (const w of wanted) {
    if (w.value === undefined) continue;
    const v = w.value.replace(w.lead, "").trim();
    // Built first, so a blank or two-line value is refused even when it is the same as before.
    const next = w.line(v);
    if (v === w.current) continue;
    let k = from;
    while (k < to && !w.re.test(lines[k])) k++;
    if (k < to) lines[k] = next;
    else missing.push(next);
  }
  if (missing.length) lines.splice(from, 0, ...missing, "");
  return lines.join(eolOf(text));
}

/** Set the Feature line's title. Its tags and the rest of the file stay as they are. */
export function setTitle(text: string, title: string): string {
  const next = oneLine("A title", title);
  return text.replace(/^(\s*Feature:)[^\r\n]*/m, (_all, head: string) => `${head} ${next}`);
}

/** Set the story type. user_story removes the @type tag. */
export function setType(text: string, type: StoryType): string {
  if (!STORY_TYPES.includes(type)) throw new Error(`'${type}' is not a story type (user_story, technical or bug_risk)`);
  const word = TYPE_WORD[type];
  return editHeadTags(text, (t) => t.startsWith("@type-"), word ? [`@type-${word}`] : [], idOf(text));
}

/** Set the persona tags to exactly these ids, in the order given. */
export function setPersonas(text: string, ids: string[]): string {
  for (const id of ids) if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`'${id}' is not a persona id`);
  return editHeadTags(text, (t) => t.startsWith("@persona-"), [...new Set(ids)].map((id) => `@persona-${id}`), idOf(text));
}

/** Set the feature's priority tag: must, should or could. */
export function setPriority(text: string, priority: string): string {
  if (!PRIORITIES.includes(priority as Priority)) throw new Error(`'${priority}' is not a priority (must, should or could)`);
  return editHeadTags(text, (t) => PRIORITY_TAG.test(t), [`@${priority}`], idOf(text));
}

/**
 * Set the activity and step tags. A blank step removes the step tag. The step is not checked against
 * the activity here: the story op does that from storymap.yaml.
 */
export function setPlacement(text: string, placement: { activity: string; step?: string }): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(placement.activity)) throw new Error(`'${placement.activity}' is not an activity id`);
  const step = placement.step?.trim() ?? "";
  if (step && !/^[a-z0-9][a-z0-9-]*$/.test(step)) throw new Error(`'${step}' is not a step id`);
  const moved = editHeadTags(text, (t) => t.startsWith("@activity-"), [`@activity-${placement.activity}`], idOf(text));
  return editHeadTags(moved, (t) => t.startsWith("@step-"), step ? [`@step-${step}`] : [], `activity-${placement.activity}`);
}

/** Apply each field a story edit gives. A value that isn't allowed throws its message. */
export function editStoryText(text: string, f: StoryFields): string {
  let next = text;
  if (f.title !== undefined) {
    const problem = titleProblem("story", f.title);
    if (problem) throw new Error(problem);
    // The Feature line is written only when the title changes, so an unchanged title keeps the line as it is.
    if (f.title.trim() !== titleOf(next)) next = setTitle(next, f.title);
  }
  next = setNarrative(next, { asA: f.asA, iWant: f.iWant, soThat: f.soThat });
  if (f.type !== undefined) {
    if (!STORY_TYPES.includes(f.type as StoryType)) throw new Error(`'${f.type}' is not a story type (user_story, technical or bug_risk)`);
    next = setType(next, f.type as StoryType);
  }
  if (f.personas !== undefined) next = setPersonas(next, f.personas);
  if (f.priority !== undefined) next = setPriority(next, f.priority);
  return next;
}

/** A scenario with the lines it takes: [start, end), from its first tag to its last line, 0-based. */
interface Span {
  ac?: string;
  title: string;
  tags: string[];
  priority?: Priority;
  steps: { keyword: string; text: string }[];
  outline: boolean;
  start: number;
  end: number;
}

type ScenarioAst = ReturnType<typeof scenariosOf>[number];

/**
 * The 0-based line just after a scenario's last line: its steps, their tables and docstrings, and its Examples.
 * Comments and rule headings after it belong to no scenario, so they stay where they are.
 */
function endOf(s: ScenarioAst, lines: string[]): number {
  let last = s.location.line;
  for (const st of s.steps) {
    last = Math.max(last, st.location.line);
    for (const row of st.dataTable?.rows ?? []) last = Math.max(last, row.location.line);
    if (st.docString) {
      // The lines after the opening delimiter run to the closing one, which is the scenario's last line.
      let close = st.docString.location.line;
      while (close < lines.length && !lines[close].trim().startsWith(st.docString.delimiter)) close++;
      last = Math.max(last, close + 1);
    }
  }
  for (const ex of s.examples) {
    last = Math.max(last, ex.location.line);
    for (const row of [ex.tableHeader, ...(ex.tableBody ?? [])]) if (row) last = Math.max(last, row.location.line);
  }
  return last;
}

/** Every scenario in the file, in file order. */
function spansOf(text: string): { lines: string[]; spans: Span[] } {
  const lines = linesOf(text);
  const feature = parseFeature(text);
  if (!feature) throw new Error("The feature has no Feature: line");
  const found = scenariosOf(feature)
    .map((s) => ({
      name: s.name,
      tags: s.tags.map((t) => t.name),
      steps: s.steps.map((st) => ({ keyword: st.keyword.trim(), text: st.text })),
      outline: /outline/i.test(s.keyword),
      start: Math.min(s.location.line, ...s.tags.map((t) => t.location.line)) - 1,
      end: endOf(s, lines),
    }))
    .sort((a, b) => a.start - b.start);
  const spans = found.map((s): Span => {
    const ac = s.tags.map((t) => AC_TAG.exec(t)?.[0]).find(Boolean)?.slice(1);
    const title = ac ? s.name.replace(new RegExp(`^${ac}\\s*[—–:-]\\s*`), "").trim() : s.name.trim();
    const priority = s.tags.map((t) => PRIORITY_TAG.exec(t)?.[1]).find(Boolean) as Priority | undefined;
    return { ac, title, tags: s.tags, priority, steps: s.steps, outline: s.outline, start: s.start, end: s.end };
  });
  return { lines, spans };
}

/** Every criterion in the file (a scenario with an @AC tag), in file order, with its steps grouped. */
export function criteriaOf(text: string): Criterion[] {
  return spansOf(text).spans.flatMap((s): Criterion[] => {
    if (!s.ac) return [];
    const groups = { given: [] as string[], when: [] as string[], then: [] as string[] };
    let group: keyof typeof groups = "given";
    for (const st of s.steps) {
      if (st.keyword === "Given") group = "given";
      else if (st.keyword === "When") group = "when";
      else if (st.keyword === "Then") group = "then";
      groups[group].push(st.text);
    }
    return [{ ac: s.ac, title: s.title, priority: s.priority, ...groups, steps: s.steps, outline: s.outline }];
  });
}

/** The number a new criterion takes: one more than the highest @AC tag in the file. */
export function nextCriterion(text: string): string {
  const nums = spansOf(text).spans.flatMap((s) => s.tags.map((t) => Number(AC_TAG.exec(t)?.[1] ?? 0)));
  return `AC${Math.max(0, ...nums) + 1}`;
}

/** Strip a leading Given, When, Then, And or But, and split items that hold a line break. Blank items go. */
function stepTexts(items: string[] | undefined): string[] {
  return (items ?? [])
    .flatMap((s) => String(s).split(/\r?\n/))
    .map((s) => s.trim().replace(/^(Given|When|Then|And|But)\s+/, "").trim())
    .filter(Boolean);
}

/** A criterion's fields, checked. fallback is the priority used when the input gives none (or a blank one). */
function checkCriterion(input: CriterionInput, fallback: string | undefined) {
  const problem = titleProblem("criterion", input.title);
  if (problem) throw new Error(problem);
  const priority = input.priority || fallback;
  if (priority !== undefined && !PRIORITIES.includes(priority as Priority)) throw new Error(`'${priority}' is not a priority (must, should or could)`);
  const c = { title: input.title.trim(), priority: priority as Priority | undefined, given: stepTexts(input.given), when: stepTexts(input.when), then: stepTexts(input.then) };
  if (!c.when.length) throw new Error("A criterion needs a When step");
  if (!c.then.length) throw new Error("A criterion needs a Then step");
  return c;
}

/** The lines of one scenario, as the template writes them. A criterion with no priority gets no priority tag. */
function scenarioLines(ac: string, c: ReturnType<typeof checkCriterion>, extraTags: string[] = []): string[] {
  const steps = (keyword: string, items: string[]) => items.map((t, i) => `    ${i ? "And" : keyword} ${t}`);
  const tags = [`@${ac}`, ...extraTags, ...(c.priority ? [`@${c.priority}`] : [])];
  return [
    `  ${tags.join(" ")}`,
    `  Scenario: ${ac} — ${c.title}`,
    ...steps("Given", c.given),
    ...steps("When", c.when),
    ...steps("Then", c.then),
  ];
}

/** Add a criterion at the end of the feature, numbered one past the highest. Its priority defaults to the story's. */
export function addCriterion(text: string, input: CriterionInput): string {
  const ac = nextCriterion(text);
  const c = checkCriterion(input, priorityOf(text) ?? "must");
  const eol = eolOf(text);
  const lines = text.replace(/(\r?\n)+$/, "").split(/\r?\n/);
  lines.push("", ...scenarioLines(ac, c));
  return lines.join(eol) + eol;
}

/** The lines and the span of the criterion with this label, or a throw. count is the number of criteria. */
function spanOf(text: string, ac: string) {
  const { lines, spans } = spansOf(text);
  const span = spans.find((s) => s.ac === ac);
  if (!span) throw new Error(`${ac} is not a criterion of this story`);
  return { lines, span, count: spans.filter((s) => s.ac).length };
}

/**
 * Replace a criterion's title, priority and steps. Its label and its other tags stay. A priority not
 * given keeps the criterion's own. A Scenario Outline can't be edited here: its Examples would be lost.
 */
export function editCriterion(text: string, ac: string, input: CriterionInput): string {
  const { lines, span } = spanOf(text, ac);
  if (span.outline) throw new Error(`${ac} is a Scenario Outline, so its steps can't be edited here`);
  const c = checkCriterion(input, span.priority);
  const extra = span.tags.filter((t) => !AC_TAG.test(t) && !PRIORITY_TAG.test(t));
  lines.splice(span.start, span.end - span.start, ...scenarioLines(ac, c, extra));
  return lines.join(eolOf(text));
}

/** Remove a criterion. A story keeps at least one, so the last one can't go. Nothing is renumbered. */
export function removeCriterion(text: string, ac: string): string {
  const { lines, span, count } = spanOf(text, ac);
  if (count <= 1) throw new Error("A story keeps at least one criterion: add another before removing this one");
  lines.splice(span.start, span.end - span.start);
  // The blank line that came before it goes too, so one blank line still separates the rest.
  if (span.start > 0 && lines[span.start - 1].trim() === "" && (lines[span.start] ?? "").trim() === "") lines.splice(span.start, 1);
  const eol = eolOf(text);
  return lines.join(eol).replace(/(\r?\n)*$/, eol);
}
