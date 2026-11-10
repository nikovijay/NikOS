import Ajv2020Module, { type ErrorObject } from "ajv/dist/2020.js";
const Ajv2020 = (Ajv2020Module as any).default ?? Ajv2020Module;
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { lintFeature } from "../lint/gherkin.js";
import { lintConstitution } from "../lint/constitution.js";
import { BET_ID, CROSS_REF, planningDirOf } from "../lib/bets.js";
import { groupKeyOf, mapDirs, mapOwnerOf, repoRootOf, resolveStoryMap, storyIdsOf, type StoryMapRef } from "../lib/maps.js";
import { summaryBody, summaryDrift } from "../lib/map-summary.js";
import { DELIVERY_SUMMARY } from "../lib/delivery-summary.js";
import { approvalLapse, type Approval } from "../lib/approvals.js";
import { store } from "../lib/store.js";
import { approvalsDir, storyFiles } from "../lib/state-files.js";
import { STORY_ID, featureStoryIds, featureTag, featureTags, isDone, read, rel, specHash, walk } from "../lib/project.js";
import { loadMapData } from "../lib/map-data.js";
import { schemaProblems } from "../lib/schema.js";
import { codeChangedSince } from "../lib/git.js";
import { upstreamEntries } from "../planning/upstream.js";

export interface Issue {
  file: string;
  message: string;
  hint?: string;
  /** An approval that no longer holds: `state set` reports it as a warning, since the move itself worked. */
  lapse?: boolean;
}

export interface ValidationResult {
  dir: string;
  errors: Issue[];
  warnings: Issue[];
  stories: number;
  releases: number;
  /** What the result is about, for the "is valid" line: maps/<key>/, or maps/ for a repo. */
  label?: string;
}

const here = dirname(fileURLToPath(import.meta.url));
// Works from src/ (tests) and dist/ (published): schemas sit at the package root.
const schemaDir = [join(here, "../../schemas"), join(here, "../schemas")].find((d) => existsSync(d))!;
const ajv = new Ajv2020({ allErrors: true, strict: false });
// The schemas ship with nikOS, so they're read from disk whatever store is in use.
const schemaFile = (name: string) => JSON.parse(readFileSync(join(schemaDir, name), "utf8"));
const checkStorymap = ajv.compile(schemaFile("storymap.schema.json"));
const checkState = ajv.compile(schemaFile("state.schema.json"));
const checkApprovals = ajv.compile(schemaFile("approvals.schema.json"));

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
  if (!store().exists(path)) {
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

/**
 * Check one story map: maps/<key>, chosen with --map, or the repo's only map.
 */
export function validate(start: string, map?: string): ValidationResult {
  const ref = resolveStoryMap(start, { map });
  const r = validateMap(ref);
  lintRootConstitution(ref.root, r.errors, r.warnings);
  return r;
}

/** The repo's constitution.md, at its root: linted once, whatever the number of maps. */
function lintRootConstitution(root: string, errors: Issue[], warnings: Issue[]): void {
  const path = join(root, "constitution.md");
  if (!store().exists(path)) return;
  for (const issue of lintConstitution(read(path))) {
    (issue.level === "error" ? errors : warnings).push({ file: "constitution.md", message: issue.message, hint: issue.hint });
  }
}

/**
 * A repo with maps/: each map is checked on its own, then the rules only the repo can see: one key
 * per map, each map's folder named for its key, and each story id in one map only.
 */
export function validateGroup(root: string): ValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  if (store().isDir(join(root, "intent"))) {
    errors.push({ file: "intent/", message: "this repo has intent/: run nikos migrate maps", hint: "run nikos migrate maps, then commit the result" });
  }
  const owner = new Map<string, string>();
  const featureOwner = new Map<string, string>();
  let stories = 0;
  let releases = 0;
  for (const dir of mapDirs(root)) {
    const id = basename(dir);
    let key: unknown;
    try {
      key = (parse(read(join(dir, "storymap.yaml"))) as { key?: unknown } | null)?.key;
    } catch {
      key = undefined; // validateMap reports the file's YAML error
    }
    if (typeof key === "string") {
      if (key.toLowerCase() !== id) errors.push({ file: `maps/${id}/storymap.yaml`, message: `maps/${id} has key '${key}', so its folder should be maps/${key.toLowerCase()}` });
      if (owner.has(key)) errors.push({ file: `maps/${id}/storymap.yaml`, message: `maps/${owner.get(key)} and maps/${id} both use key '${key}'`, hint: "give each map a key of its own" });
      else owner.set(key, id);
    }
    const r = validateMap({ root, dir, id });
    // A map's issues name its own files; say which map, since a repo can hold several.
    const inMap = (x: Issue): Issue => (x.file.startsWith("maps/") ? x : { ...x, file: `maps/${id}/${x.file}` });
    errors.push(...r.errors.map(inMap));
    warnings.push(...r.warnings.map(inMap));
    stories += r.stories;
    releases += r.releases;
    // A map that doesn't read is reported by validateMap; its stories can't be checked for clashes.
    let features: { id: string }[] = [];
    try {
      features = loadMapData(dir).features;
    } catch {
      features = [];
    }
    for (const f of features) {
      if (featureOwner.has(f.id)) errors.push({ file: `maps/${id}/features`, message: `${f.id} is in two maps (${featureOwner.get(f.id)} and maps/${id})`, hint: "keep each story in one map" });
      else featureOwner.set(f.id, `maps/${id}`);
    }
  }
  lintRootConstitution(root, errors, warnings);
  return { dir: root, errors, warnings, stories, releases, label: "maps/" };
}

/**
 * A map names a bet in a plan above it: that plan must be one this repo joins, and its bet must be in
 * the synced copy (a warning when the copy isn't synced yet).
 */
function crossBet(root: string, id: string | undefined, bet: string, errors: Issue[], warnings: Issue[]): void {
  const [repo, betId] = bet.split("#");
  const file = "storymap.yaml";
  let joined: string[] = [];
  try {
    joined = upstreamEntries(root).map((e) => e.repo);
  } catch {
    joined = []; // planning/upstream.yaml that doesn't read is reported by doctor
  }
  if (!joined.includes(repo)) {
    errors.push({ file, message: `maps/${id} names bet ${bet}, but this repo doesn't join ${repo}`, hint: `join it first (nikos join ${repo}), or name one of this repo's own bets` });
    return;
  }
  const copy = join(root, ".nikos", "upstream", ...repo.split("/"));
  if (!store().isDir(copy)) {
    warnings.push({ file, message: `bet ${bet} can't be checked yet: ${repo} isn't synced`, hint: "run nikos planning sync" });
    return;
  }
  if (!store().exists(join(copy, "planning", "bets", `${betId}.md`))) errors.push({ file, message: `maps/${id} names bet ${bet}, which ${repo} doesn't have`, hint: "check the bet's id in that plan" });
}

export function validateMap(ref: StoryMapRef): ValidationResult {
  const dir = ref.dir;
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const storymap = loadYaml(dir, "storymap.yaml", errors);
  const state = loadYaml(dir, "state.yaml", errors);
  // The 0.2 layouts are no longer read. Each is named, so its entries are never dropped without a word.
  if (store().isDir(join(dir, "state"))) {
    errors.push({ file: "state/", message: "is the 0.2 per-story state layout, which nikOS no longer reads", hint: "fold each state/<ID>.yaml into state.yaml under stories:" });
  }
  if (store().exists(join(dir, "approvals.yaml"))) {
    errors.push({ file: "approvals.yaml", message: "is the 0.2 single approvals file, which nikOS no longer reads", hint: "move each entry into approvals/<ID>.yaml" });
  }

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
  // A story id is [PREFIX-]KEY-n. The prefix is the map's owner, the repo's group key, or nothing,
  // and every story in one map uses the same one.
  const key: string | undefined = typeof storymap?.key === "string" ? storymap.key : undefined;
  const owner = mapOwnerOf(dir);
  const group = groupKeyOf(ref.root);
  const expected = owner ?? group;
  const idPrefixes = new Map<string, string>();
  const activityIds = new Set<string>();
  const personaIds = new Set<string>();
  // Each step id names its activity; ids are unique across the map so a @step tag is enough.
  const stepActivity = new Map<string, string>();
  if (storymap && typeof storymap === "object") {
    for (const p of storymap.personas ?? []) {
      if (personaIds.has(p?.id)) errors.push({ file: "storymap.yaml", message: `persona '${p.id}' appears more than once` });
      personaIds.add(p?.id);
    }
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
        if (key && typeof id === "string") {
          const m = new RegExp(`^(?:([A-Z][A-Z0-9]{0,9})-)?${key}-[0-9]+$`).exec(id);
          const prefix = m ? (m[1] ?? "") : undefined;
          if (prefix === undefined || (prefix && prefix !== owner && prefix !== group)) {
            errors.push({ file: "storymap.yaml", message: expected ? `story ${id} must start with ${expected}-${key}-` : `${id} doesn't use the project key '${key}'` });
          } else {
            idPrefixes.set(id, prefix);
          }
        }
      }
    }
    // Mixed prefixes: each story that doesn't use the map's own prefix is named.
    if (key && new Set(idPrefixes.values()).size > 1) {
      for (const [id, prefix] of idPrefixes) {
        if (prefix !== (expected ?? "")) errors.push({ file: "storymap.yaml", message: `story ${id} must start with ${expected}-${key}-`, hint: "use one prefix for every story in the map" });
      }
    }
    const sorted = [...numbers].filter((n) => typeof n === "number").sort((a, b) => a - b);
    if (sorted.some((n, i) => n !== i + 1)) {
      errors.push({ file: "storymap.yaml", message: `release numbers must start at 1 with no gaps (found ${sorted.join(", ")})` });
    }
  }

  // Features
  const featureIds = new Map<string, string>();
  const dependsOn = new Map<string, string[]>();
  const hashes = new Map<string, string>();
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
    for (const persona of featureTags(text, "persona")) {
      if (storymap && !personaIds.has(persona)) errors.push({ file, message: `@persona-${persona} is not a persona in storymap.yaml`, hint: "add it under personas:, or fix the tag" });
    }
    dependsOn.set(id, featureTags(text, "depends"));
    hashes.set(id, specHash(text));
    const release = featureTag(text, "release");
    if (release && mapStories.has(id) && Number(release) !== mapStories.get(id)) {
      warnings.push({ file, message: `is tagged @release-${release} but storymap.yaml puts ${id} in release ${mapStories.get(id)}`, hint: `move it with nikos release move ${id} <n>, which keeps both in step` });
    }
  }

  const stateStories: Record<string, unknown> = { ...((state && typeof state === "object" && state.stories) || {}) };
  if (storymap) {
    for (const id of mapStories.keys()) {
      if (!featureIds.has(id)) {
        errors.push({ file: "storymap.yaml", message: `${id} has no feature file`, hint: `add maps/${ref.id}/features/<activity>/<slug>.feature tagged @${id}` });
      }
      if (!(id in stateStories)) {
        errors.push({ file: "state.yaml", message: `${id} is in storymap.yaml but has no entry under stories`, hint: `add "${id}: { status: todo }"` });
      }
    }
    for (const id of Object.keys(stateStories)) {
      if (!mapStories.has(id)) errors.push({ file: "state.yaml", message: `stories.${id} is an unknown story id`, hint: "add it to a release in storymap.yaml or remove it" });
    }
    for (const id of state?.run?.queue ?? []) {
      if (!mapStories.has(id)) errors.push({ file: "state.yaml", message: `run.queue has unknown story id ${id}` });
    }
    for (const [id, entry] of Object.entries(stateStories) as [string, any][]) {
      if (!isDone(entry?.status) || !entry?.spec_hash || !hashes.has(id) || hashes.get(id) === entry.spec_hash) continue;
      warnings.push({
        file: featureIds.get(id)!,
        message: `${id} changed after it was ${entry.status}`,
        hint: `if the change matters, move it back: nikos state set ${id} needs_rework`,
      });
    }
  }

  // Approvals are optional: approvals/<ID>.yaml appears with the first sign-off.
  const signoffs: { id: string; a: Approval; file: string; key: string }[] = [];
  for (const f of storyFiles(approvalsDir(dir))) {
    const file = `approvals/${f.id}.yaml`;
    const a = loadYaml(dir, file, errors);
    if (a === undefined) continue;
    const wrapped = { format_version: 1, approvals: { [f.id]: a } };
    if (!checkApprovals(wrapped)) {
      for (const e of checkApprovals.errors ?? []) {
        if (e.keyword === "pattern" && e.propertyName) continue;
        errors.push({ file, message: describe(e, wrapped).replace(`approvals.${f.id}`, f.id) });
      }
      continue;
    }
    signoffs.push({ id: f.id, a, file, key: f.id });
  }
  for (const { id, a, file, key } of signoffs) {
    if (!mapStories.has(id) && !featureIds.has(id)) {
      errors.push({ file, message: `${key} is an unknown story id` });
      continue;
    }
    const lapse = approvalLapse(a, (stateStories as any)[id], hashes.get(id));
    if (lapse) warnings.push({ file, message: `${id}'s approval no longer holds: ${lapse}`, hint: `once it's done again, a person approves it again (nikos approve ${id}), or remove the entry`, lapse: true });
    // An approval names the commit it was tested at: code committed since is what approve refuses, so say so here too.
    if (a.tested_commit && codeChangedSince(ref.root, a.tested_commit)) {
      warnings.push({ file, message: `${id} was approved, but the code has changed since it was tested at ${a.tested_commit.slice(0, 7)}`, hint: `run its scenarios again: nikos state set ${id} needs_rework, then in_progress, then done, then approve`, lapse: true });
    }
  }

  // Dependencies: each @depends-<id> names a known story, never itself, never in a loop.
  const statusOf = (id: string): string => (stateStories as any)[id]?.status ?? "todo";
  for (const [id, deps] of dependsOn) {
    const file = featureIds.get(id)!;
    for (const dep of deps) {
      if (dep === id) errors.push({ file, message: `${id} depends on itself` });
      else if (!featureIds.has(dep) && !mapStories.has(dep)) errors.push({ file, message: `@depends-${dep} names a story that doesn't exist` });
      else if (statusOf(dep) === "cancelled" && !isDone(statusOf(id))) warnings.push({ file, message: `${id} depends on ${dep}, which is cancelled`, hint: `drop the @depends-${dep} tag, or bring ${dep} back with nikos state set ${dep} todo` });
      else if ((mapStories.get(dep) ?? 0) > (mapStories.get(id) ?? Infinity)) {
        warnings.push({ file, message: `${id} in release ${mapStories.get(id)} depends on ${dep}, which is in a later release (${mapStories.get(dep)})`, hint: `move one of them: nikos release move ${dep} ${mapStories.get(id)}` });
      }
    }
  }
  for (const loop of dependencyLoops(dependsOn)) {
    errors.push({ file: featureIds.get(loop[0])!, message: `stories depend on each other in a loop: ${[...loop, loop[0]].join(" → ")}`, hint: "remove one of the @depends tags" });
  }

  // Bet links: each names a bet in planning/bets/ or one in another repo (<repo path>#id).
  if (storymap && typeof storymap === "object") {
    const betsDir = join(planningDirOf(repoRootOf(dir)), "bets");
    // A bet is checked here only when the repo has a planning/ folder to check it against.
    const hasPlanning = store().isDir(join(repoRootOf(dir), "planning"));
    const check = (where: string, refs: unknown) => {
      for (const ref of Array.isArray(refs) ? refs : []) {
        if (typeof ref !== "string") continue;
        if (CROSS_REF.test(ref)) continue; // another repo's bet: checked for form only, never fetched
        if (!BET_ID.test(ref)) {
          errors.push({ file: "storymap.yaml", message: `${where} names bet '${ref}', which is neither a bet id nor <repo path>#id`, hint: "use a bet id like faster-checkout, or owner/repo#bet-id for another repo's bet" });
        } else if (hasPlanning && !store().exists(join(betsDir, `${ref}.md`))) {
          errors.push({ file: "storymap.yaml", message: `${where} names bet '${ref}', which has no planning/bets/${ref}.md`, hint: "create it with `nikos planning bet new`, or fix the name" });
        }
      }
    };
    // A map names its one bet in bet:, so its releases and stories don't name bets.
    for (const r of storymap.releases ?? []) if (r?.bets !== undefined) errors.push({ file: "storymap.yaml", message: `maps/${ref.id} names its bet in bet:, so releases and stories don't name bets: remove bets: from release ${r?.number}` });
    for (const id of Object.keys(storymap.story_bets ?? {})) errors.push({ file: "storymap.yaml", message: `maps/${ref.id} names its bet in bet:, so releases and stories don't name bets: remove story_bets from ${id}` });
    // The bet is optional (RFC rule 5): a map with none is valid, and counts toward no bet.
    if (typeof storymap.bet !== "string") {
      // nothing to check: the bet is optional
    } else if (CROSS_REF.test(storymap.bet)) {
      // A map can name a bet in a plan above it: it's checked against the plan this repo joins.
      crossBet(ref.root, ref.id, storymap.bet, errors, warnings);
    } else if (!BET_ID.test(storymap.bet)) {
      errors.push({ file: "storymap.yaml", message: `maps/${ref.id} names bet ${storymap.bet}, which is not a bet id`, hint: "use a bet id like faster-checkout" });
    } else if (hasPlanning && !store().exists(join(betsDir, `${storymap.bet}.md`))) {
      errors.push({ file: "storymap.yaml", message: `maps/${ref.id} names bet ${storymap.bet}, which has no planning/bets/${storymap.bet}.md`, hint: "create it with `nikos planning bet new`, or fix the name" });
    }
  }

  checkDeliverySummary(ref, errors);

  return { dir, errors, warnings, stories: mapStories.size, releases: storymap?.releases?.length ?? 0 };
}

/**
 * A map's delivery.yaml must say what the map's files say now. nikos map status, state set, approve
 * and map new write it, so a difference means a hand edit or a change that skipped nikOS. The plans
 * above read this file, so CI goes red until it is written again and committed.
 */
function checkDeliverySummary(ref: StoryMapRef, errors: Issue[]): void {
  const file = DELIVERY_SUMMARY;
  const hint = "run nikos map status, then commit it";
  if (!store().exists(join(ref.dir, "storymap.yaml"))) return; // validateMap reports the missing storymap
  let body;
  try {
    body = summaryBody(ref.root, ref.dir);
  } catch {
    return; // a storymap that doesn't read is reported above
  }
  if (!store().exists(join(ref.dir, file))) {
    errors.push({ file, message: "is missing", hint });
    return;
  }
  let onDisk: unknown;
  try {
    onDisk = parse(read(join(ref.dir, file)));
  } catch (err) {
    errors.push({ file, message: `is not valid YAML: ${(err as Error).message.split("\n")[0]}`, hint });
    return;
  }
  const problems = schemaProblems("delivery-summary.schema.json", onDisk);
  if (problems.length) {
    errors.push({ file, message: problems[0], hint });
    return;
  }
  const drift = summaryDrift(body, onDisk);
  if (drift) errors.push({ file, message: drift.message, hint });
}

/** Each dependency loop once, starting from its first story in file order. */
function dependencyLoops(deps: Map<string, string[]>): string[][] {
  const loops: string[][] = [];
  const seen = new Set<string>();
  const visit = (id: string, path: string[]) => {
    const at = path.indexOf(id);
    if (at >= 0) {
      const loop = path.slice(at);
      if (loop.length > 1 && !loops.some((l) => l.length === loop.length && l.every((x) => loop.includes(x)))) loops.push(loop);
      return;
    }
    if (seen.has(id)) return;
    for (const dep of deps.get(id) ?? []) if (dep !== id) visit(dep, [...path, id]);
    seen.add(id);
  };
  for (const id of deps.keys()) visit(id, []);
  return loops;
}

export function formatResult(r: ValidationResult): string {
  const lines: string[] = [];
  for (const e of r.errors) lines.push(`✗ ${e.file}: ${e.message}${e.hint ? `\n    → ${e.hint}` : ""}`);
  for (const w of r.warnings) lines.push(`! ${w.file}: ${w.message}${w.hint ? `\n    → ${w.hint}` : ""}`);
  if (r.errors.length === 0) {
    const label = r.label ?? `maps/${basename(r.dir)}/`;
    lines.push(`✓ ${label} is valid — ${r.stories} ${r.stories === 1 ? "story" : "stories"}, ${r.releases} ${r.releases === 1 ? "release" : "releases"}`);
  } else {
    lines.push(`\n${r.errors.length} ${r.errors.length === 1 ? "problem" : "problems"} found.`);
  }
  return lines.join("\n");
}

export function runValidate(args: string[]): number {
  const i = args.indexOf("--map");
  const start = args[0] && !args[0].startsWith("--") ? args[0] : process.cwd();
  try {
    // A repo with maps/ and no --map checks every map and the repo's own rules.
    const r = !(i >= 0) && mapDirs(start).length ? validateGroup(start) : validate(start, i >= 0 ? args[i + 1] : undefined);
    console.log(formatResult(r));
    return r.errors.length ? 1 : 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
