import Ajv2020Module, { type ErrorObject } from "ajv/dist/2020.js";
const Ajv2020 = (Ajv2020Module as any).default ?? Ajv2020Module;
import { existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { lintFeature } from "../lint/gherkin.js";
import { lintConstitution } from "../lint/constitution.js";
import { BET_ID, CROSS_REF, planningDir } from "../lib/bets.js";
import { featureStoryIds, featureTag, findIntentDir, read, rel, walk } from "../lib/project.js";

export interface Issue {
  file: string;
  message: string;
  hint?: string;
}

export interface ValidationResult {
  dir: string;
  errors: Issue[];
  warnings: Issue[];
  stories: number;
  releases: number;
}

const here = dirname(fileURLToPath(import.meta.url));
// Works from src/ (tests) and dist/ (published): schemas sit at the package root.
const schemaDir = [join(here, "../../schemas"), join(here, "../schemas")].find((d) => existsSync(d))!;
const ajv = new Ajv2020({ allErrors: true, strict: false });
const checkStorymap = ajv.compile(JSON.parse(read(join(schemaDir, "storymap.schema.json"))));
const checkState = ajv.compile(JSON.parse(read(join(schemaDir, "state.schema.json"))));

function pointer(e: ErrorObject): string {
  return e.instancePath.replace(/^\//, "").split("/").filter(Boolean).join(".") || "(root)";
}

function describe(e: ErrorObject, data: unknown): string {
  const at = pointer(e);
  const value = e.instancePath
    .split("/")
    .filter(Boolean)
    .reduce<any>((v, k) => (v == null ? v : v[k]), data);
  switch (e.keyword) {
    case "enum":
      return `${at} '${value}' is not one of ${(e.params as any).allowedValues.join(", ")}`;
    case "const":
      return `${at} must be ${JSON.stringify((e.params as any).allowedValue)}`;
    case "required":
      return `${at === "(root)" ? "" : at + ": "}missing required field '${(e.params as any).missingProperty}'`;
    case "additionalProperties":
      return `${at === "(root)" ? "" : at + ": "}unknown field '${(e.params as any).additionalProperty}'`;
    case "pattern":
      return `${at} '${value}' is not in the expected format`;
    case "propertyNames":
      return `${at}: '${(e.params as any).propertyName}' is not a valid story id (expected e.g. HT-1)`;
    default:
      return `${at} ${e.message}`;
  }
}

function loadYaml(dir: string, name: string, issues: Issue[]): any {
  const path = join(dir, name);
  if (!existsSync(path)) {
    issues.push({ file: name, message: "file is missing", hint: "run `nikos init` to create it" });
    return undefined;
  }
  try {
    return parse(read(path));
  } catch (err) {
    issues.push({ file: name, message: `is not valid YAML: ${(err as Error).message.split("\n")[0]}` });
    return undefined;
  }
}

export function validate(start: string): ValidationResult {
  const dir = findIntentDir(start);
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  const storymap = loadYaml(dir, "storymap.yaml", errors);
  const state = loadYaml(dir, "state.yaml", errors);

  if (storymap !== undefined && !checkStorymap(storymap)) {
    for (const e of checkStorymap.errors ?? []) {
      errors.push({ file: "storymap.yaml", message: describe(e, storymap) });
    }
  }
  if (state !== undefined && !checkState(state)) {
    for (const e of checkState.errors ?? []) {
      // propertyNames also reports the inner pattern failure; the propertyNames message covers it.
      if (e.keyword === "pattern" && e.propertyName) continue;
      errors.push({ file: "state.yaml", message: describe(e, state) });
    }
  }

  // Cross-file checks only when both files parsed into objects.
  const mapStories = new Map<string, number>();
  const activityIds = new Set<string>();
  // Each step id names its activity; ids are unique across the map so a @step tag is enough.
  const stepActivity = new Map<string, string>();
  if (storymap && typeof storymap === "object") {
    for (const a of storymap.activities ?? []) {
      activityIds.add(a?.id);
      for (const st of a?.steps ?? []) {
        if (stepActivity.has(st?.id)) {
          errors.push({ file: "storymap.yaml", message: `step '${st.id}' appears more than once`, hint: "give each step an id of its own across the map" });
        }
        stepActivity.set(st?.id, a?.id);
      }
    }
    const numbers: number[] = [];
    for (const r of storymap.releases ?? []) {
      numbers.push(r?.number);
      for (const id of r?.stories ?? []) {
        if (mapStories.has(id)) {
          errors.push({ file: "storymap.yaml", message: `${id} appears in more than one release`, hint: "keep each story in exactly one release" });
        }
        mapStories.set(id, r.number);
        if (storymap.key && typeof id === "string" && !id.startsWith(`${storymap.key}-`)) {
          errors.push({ file: "storymap.yaml", message: `${id} doesn't use the project key '${storymap.key}'` });
        }
      }
    }
    const sorted = [...numbers].filter((n) => typeof n === "number").sort((a, b) => a - b);
    if (sorted.some((n, i) => n !== i + 1)) {
      errors.push({ file: "storymap.yaml", message: `release numbers must start at 1 with no gaps (found ${sorted.join(", ")})` });
    }
  }

  const constitutionPath = join(dir, "constitution.md");
  if (existsSync(constitutionPath)) {
    for (const issue of lintConstitution(read(constitutionPath))) {
      (issue.level === "error" ? errors : warnings).push({ file: "constitution.md", message: issue.message, hint: issue.hint });
    }
  }

  // Features
  const featureIds = new Map<string, string>();
  for (const path of walk(join(dir, "features"), ".feature")) {
    const file = rel(dir, path);
    const text = read(path);
    for (const issue of lintFeature(text)) {
      (issue.level === "error" ? errors : warnings).push({ file, message: issue.message, hint: issue.hint });
    }
    const ids = featureStoryIds(text);
    if (ids.length === 0) {
      errors.push({ file, message: "has no story id tag", hint: "add a tag like @HT-1 above `Feature:`" });
      continue;
    }
    if (ids.length > 1) {
      errors.push({ file, message: `has more than one story id tag (${ids.join(", ")})`, hint: "one feature file per story" });
    }
    const id = ids[0];
    if (featureIds.has(id)) {
      errors.push({ file, message: `${id} already has a feature file (${featureIds.get(id)})` });
    }
    featureIds.set(id, file);
    const activity = basename(dirname(path));
    if (activityIds.size && !activityIds.has(activity)) {
      errors.push({ file, message: `is in folder '${activity}', which is not an activity in storymap.yaml` });
    }
    if (storymap && !mapStories.has(id)) {
      errors.push({ file, message: `${id} is not in any release in storymap.yaml` });
    }
    const step = featureTag(text, "step");
    if (step && storymap) {
      const owner = stepActivity.get(step);
      if (!owner) errors.push({ file, message: `@step-${step} is not a step in storymap.yaml`, hint: "add it under the activity's steps, or fix the tag" });
      else if (owner !== activity) errors.push({ file, message: `@step-${step} belongs to activity '${owner}', not '${activity}'` });
    }
    const release = featureTag(text, "release");
    if (release && mapStories.has(id) && Number(release) !== mapStories.get(id)) {
      warnings.push({ file, message: `is tagged @release-${release} but storymap.yaml puts ${id} in release ${mapStories.get(id)}`, hint: `move it with nikos release move ${id} <n>, which keeps both in step` });
    }
  }

  const stateStories: Record<string, unknown> = (state && typeof state === "object" && state.stories) || {};
  if (storymap && state) {
    for (const id of mapStories.keys()) {
      if (!featureIds.has(id)) {
        errors.push({ file: "storymap.yaml", message: `${id} has no feature file`, hint: `add intent/features/<activity>/<slug>.feature tagged @${id}` });
      }
      if (!(id in stateStories)) {
        errors.push({ file: "state.yaml", message: `${id} is in storymap.yaml but has no entry under stories`, hint: `add "${id}: { status: todo }"` });
      }
    }
    for (const id of Object.keys(stateStories)) {
      if (!mapStories.has(id)) {
        errors.push({ file: "state.yaml", message: `stories.${id} is an unknown story id`, hint: "add it to a release in storymap.yaml or remove it" });
      }
    }
    for (const id of state.run?.queue ?? []) {
      if (!mapStories.has(id)) errors.push({ file: "state.yaml", message: `run.queue has unknown story id ${id}` });
    }
  }

  // Bet links: each names a bet in planning/bets/ or one in another repo (<repo path>#id).
  if (storymap && typeof storymap === "object") {
    const betsDir = join(planningDir(dir), "bets");
    const check = (where: string, refs: unknown) => {
      for (const ref of Array.isArray(refs) ? refs : []) {
        if (typeof ref !== "string") continue;
        if (CROSS_REF.test(ref)) continue; // another repo's bet: checked for form only, never fetched
        if (!BET_ID.test(ref)) {
          errors.push({ file: "storymap.yaml", message: `${where} names bet '${ref}', which is neither a bet id nor <repo path>#id`, hint: "use a bet id like faster-checkout, or owner/repo#bet-id for another repo's bet" });
        } else if (!existsSync(join(betsDir, `${ref}.md`))) {
          errors.push({ file: "storymap.yaml", message: `${where} names bet '${ref}', which has no planning/bets/${ref}.md`, hint: "create it with `nikos planning bet new`, or fix the name" });
        }
      }
    };
    for (const r of storymap.releases ?? []) check(`release ${r?.number}`, r?.bets);
    for (const [id, refs] of Object.entries(storymap.story_bets ?? {})) {
      if (!mapStories.has(id)) errors.push({ file: "storymap.yaml", message: `story_bets names ${id}, which is not in any release` });
      check(id, refs);
    }
  }

  return { dir, errors, warnings, stories: mapStories.size, releases: storymap?.releases?.length ?? 0 };
}

export function formatResult(r: ValidationResult): string {
  const lines: string[] = [];
  for (const e of r.errors) lines.push(`✗ ${e.file}: ${e.message}${e.hint ? `\n    → ${e.hint}` : ""}`);
  for (const w of r.warnings) lines.push(`! ${w.file}: ${w.message}${w.hint ? `\n    → ${w.hint}` : ""}`);
  if (r.errors.length === 0) {
    lines.push(`✓ intent/ is valid — ${r.stories} ${r.stories === 1 ? "story" : "stories"}, ${r.releases} ${r.releases === 1 ? "release" : "releases"}`);
  } else {
    lines.push(`\n${r.errors.length} ${r.errors.length === 1 ? "problem" : "problems"} found.`);
  }
  return lines.join("\n");
}

export function runValidate(args: string[]): number {
  const r = validate(args[0] ?? process.cwd());
  console.log(formatResult(r));
  return r.errors.length ? 1 : 0;
}
