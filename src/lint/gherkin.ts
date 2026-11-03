import { AstBuilder, GherkinClassicTokenMatcher, Parser } from "@cucumber/gherkin";
import { IdGenerator } from "@cucumber/messages";
import { STORY_ID } from "../lib/project.js";

export interface LintIssue {
  level: "error" | "warning";
  message: string;
  hint?: string;
}

/** Tags that describe progress, which belongs in state.yaml, not the spec. */
const STATUS_TAGS = /^@(todo|done|wip|in[-_]?progress|doing|blocked|needs[-_]?rework|ready|review|approved|complete[d]?|skip|pending)$/i;
const PRIORITY = /^@(must|should|could)$/;
const AC_TAG = /^@AC\d+$/;
const KNOWN_FEATURE_TAG = [STORY_ID, /^release-\d+$/, /^(must|should|could)$/, /^activity-[a-z0-9-]+$/, /^effort-(XS|S|M|L|XL)$/];

function parser() {
  return new Parser(new AstBuilder(IdGenerator.uuid()), new GherkinClassicTokenMatcher());
}

/** Parse a feature file. Throws on invalid Gherkin. */
export function parseFeature(text: string) {
  return parser().parse(text).feature;
}

type Feature = NonNullable<ReturnType<typeof parseFeature>>;

/** Every scenario in a feature, including those inside Rules. */
export function scenariosOf(feature: Feature) {
  return feature.children.flatMap((c) => (c.scenario ? [c.scenario] : c.rule ? c.rule.children.flatMap((rc) => (rc.scenario ? [rc.scenario] : [])) : []));
}

export function lintFeature(text: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const featureLines = text.split("\n").filter((l) => /^\s*Feature:/.test(l)).length;
  if (featureLines > 1) {
    issues.push({ level: "error", message: `has ${featureLines} Features`, hint: "one Feature per file, one file per story" });
  }

  let doc;
  try {
    doc = parser().parse(text);
  } catch (err) {
    issues.push({ level: "error", message: `isn't valid Gherkin: ${(err as Error).message.split("\n")[0]}` });
    return issues;
  }
  const feature = doc.feature;
  if (!feature) {
    issues.push({ level: "error", message: "has no Feature", hint: "start the file with a story id tag and `Feature: <title>`" });
    return issues;
  }

  const tags = feature.tags.map((t) => t.name);
  for (const tag of tags) {
    if (STATUS_TAGS.test(tag)) {
      issues.push({ level: "error", message: `uses status tag ${tag}`, hint: "status lives in state.yaml, not in the feature" });
    } else if (!KNOWN_FEATURE_TAG.some((re) => re.test(tag.slice(1)))) {
      issues.push({ level: "warning", message: `has unrecognised tag ${tag}`, hint: "allowed: story id, @release-N, @must/@should/@could, @activity-<id>, @effort-<size>" });
    }
  }
  if (tags.filter((t) => PRIORITY.test(t)).length !== 1) {
    issues.push({ level: "error", message: "needs exactly one priority tag on the Feature", hint: "add @must, @should or @could" });
  }
  if (!tags.some((t) => /^@release-\d+$/.test(t))) {
    issues.push({ level: "error", message: "has no @release-N tag" });
  }

  const desc = feature.description ?? "";
  // "As a", "As an" and "As the" all name a role; I want and So that are fixed.
  const parts: [string, RegExp][] = [["As a", /^\s*As (?:an?|the)\s+\S/im], ["I want", /^\s*I want\b/im], ["So that", /^\s*So that\b/im]];
  const missing = parts.filter(([, re]) => !re.test(desc)).map(([label]) => label);
  if (missing.length) {
    issues.push({
      level: "error",
      message: `user story is missing ${missing.map((m) => `"${m}"`).join(", ")}`,
      hint: "put As a … / I want … / So that … on separate lines under Feature:",
    });
  }

  const scenarios = scenariosOf(feature);
  if (scenarios.length === 0) {
    issues.push({ level: "warning", message: "has no scenarios yet", hint: "add one Scenario per acceptance criterion" });
  }
  const labels = new Set<string>();
  for (const s of scenarios) {
    const sTags = s.tags.map((t) => t.name);
    const ac = sTags.find((t) => AC_TAG.test(t));
    for (const tag of sTags) {
      if (STATUS_TAGS.test(tag)) {
        issues.push({ level: "error", message: `scenario "${s.name}" uses status tag ${tag}`, hint: "status lives in state.yaml, not in the feature" });
      }
    }
    if (!ac) {
      issues.push({ level: "error", message: `scenario "${s.name}" has no @AC<n> tag`, hint: "tag each scenario with its criterion label, e.g. @AC1" });
      continue;
    }
    if (labels.has(ac)) issues.push({ level: "error", message: `${ac} is used by more than one scenario` });
    labels.add(ac);
    if (!s.name.startsWith(`${ac.slice(1)} `)) {
      issues.push({ level: "warning", message: `scenario "${s.name}" should start with its label`, hint: `e.g. "${ac.slice(1)} — ${s.name}"` });
    }
    if (sTags.filter((t) => PRIORITY.test(t)).length > 1) {
      issues.push({ level: "error", message: `scenario "${s.name}" has more than one priority tag` });
    }
    // Given is optional (a scenario can start from nothing); When and Then are not.
    const keywords = new Set(s.steps.map((st) => st.keyword.trim()));
    for (const k of ["When", "Then"]) {
      if (!keywords.has(k)) issues.push({ level: "error", message: `scenario "${s.name}" has no ${k} step` });
    }
  }
  return issues;
}
