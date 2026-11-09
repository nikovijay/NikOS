import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { walk } from "../lib/project.js";
import { mapDirs, mapFlag, ownMapsOf } from "../lib/maps.js";
import { isTeamRepo } from "../lib/team.js";
import { detectStack, type Stack } from "../verify/detect.js";
import { featureFor } from "./clear.js";

const here = dirname(fileURLToPath(import.meta.url));
const templateDir = [join(here, "../../templates/verify"), join(here, "../templates/verify")].find((d) => existsSync(d))!;

const INSTALL: Record<Stack, string> = {
  js: "npm install --save-dev @cucumber/cucumber@^12",
  ts: "npm install --save-dev @cucumber/cucumber@^12 tsx",
  python: "pip install behave",
};

/** A step only the untouched example story has. */
const EXAMPLE_STEP = "When I do the one thing this product is for";

const CONFIG: Record<Stack, string> = { js: "cucumber.mjs", ts: "cucumber.mjs", python: "behave.ini" };

export interface SetupResult {
  stack: Stack;
  created: string[];
  skipped: string[];
  install: string;
  /** Why the runner won't run on this Node, when it won't. */
  node?: string;
}

/** The Node versions Cucumber 12 runs on (its package.json engines: 20 || 22 || >=24). */
export const CUCUMBER_NODE = "20, 22, or 24 and later";
export const cucumberRunsOn = (version: string) => {
  const major = parseInt(version.replace(/^v/, ""), 10);
  return major === 20 || major === 22 || major >= 24;
};

/** For a JavaScript or TypeScript stack on a Node Cucumber doesn't run on: what to do first. */
export function nodeWarning(stack: Stack, version = process.version): string | undefined {
  if (stack === "python" || cucumberRunsOn(version)) return undefined;
  return `Cucumber 12 runs on Node ${CUCUMBER_NODE}, and this is Node ${version.replace(/^v/, "")}. Switch first, for example nvm install 22 && nvm use 22, and add a .nvmrc with 22 so everyone uses it. Then install the runner.`;
}

function stackOrThrow(root: string): Stack {
  const stack = detectStack(root);
  if (!stack) throw new Error("Couldn't tell the stack: no package.json, pyproject.toml or requirements.txt. Ask which runner to use.");
  return stack;
}

/**
 * The behave.ini text for this repo. behave takes folders, not globs, and fails on one that doesn't
 * exist, so a group repo lists the folder of each map that has features. A 0.2.x repo keeps the template's line.
 */
export function behavePaths(root: string, template: string): string {
  if (existsSync(join(root, "intent"))) return template;
  const folders = mapDirs(root).filter((m) => existsSync(join(m, "features")));
  if (!folders.length) return template;
  const lines = folders.map((m) => `    maps/${basename(m)}/features`);
  return template.replace(/^paths = intent\/features$/m, ["paths =", ...lines].join("\n"));
}

/** Write the runner config and step stubs for the repo's stack. Never overwrites a file. */
export function setupVerify(root: string): SetupResult {
  const stack = stackOrThrow(root);
  const src = join(templateDir, stack === "python" ? "python" : stack);
  const created: string[] = [];
  const skipped: string[] = [];
  // Step stubs are for the example story `nikos init` creates; skip them once
  // it's gone or rewritten into a real story, whose steps they wouldn't match.
  const example = join(root, "intent/features/getting-started/first-story.feature");
  const hasExample = existsSync(example) && readFileSync(example, "utf8").includes(EXAMPLE_STEP);
  for (const file of walk(src)) {
    const rel = relative(src, file);
    if (!hasExample && /first[-_]story/.test(rel)) continue;
    const dest = join(root, rel);
    if (existsSync(dest)) {
      skipped.push(rel);
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    if (rel === "behave.ini") writeFileSync(dest, behavePaths(root, readFileSync(file, "utf8")));
    else copyFileSync(file, dest);
    created.push(rel);
  }
  const node = nodeWarning(stack);
  return { stack, created, skipped, install: INSTALL[stack], ...(node ? { node } : {}) };
}

export interface VerifyResult {
  stack: Stack;
  command: string;
  status: number;
  output: string;
}

/**
 * The folders behave is given. A folder named on the command line replaces the paths in
 * behave.ini, so only a team repo passes one: its own maps' features. Every other repo keeps the
 * paths its behave.ini names, as it always has.
 */
const behaveDirs = (root: string) => {
  if (!isTeamRepo(root)) return [];
  return ownMapsOf(root).map((r) => join(relative(root, r.dir), "features")).filter((f) => existsSync(join(root, f)));
};

/** The runner's environment: tsx lets Node versions without built-in type stripping load .ts steps. */
function runnerEnv(stack: Stack): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (stack === "ts") env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --import tsx`.trim();
  return env;
}

/** A step with no step definition yet, and the story it's in. */
export interface UndefinedStep {
  story: string;
  text: string;
}

const STORY_TAG = /^([A-Z][A-Z0-9]{0,9}(?:-[A-Z][A-Z0-9]{0,9})?-[0-9]+)$/;

/**
 * The steps in a team's stories that no step definition matches yet. Read from the
 * runner's dry run, which matches steps without running them. undefined when the runner can't
 * be run or its JSON can't be read: the test run reports them then.
 */
export function undefinedSteps(root: string, stack: Stack, story?: string): UndefinedStep[] | undefined {
  let cmd: string;
  let args: string[];
  if (stack === "python") {
    cmd = process.env.PYTHON ?? "python3";
    args = ["-m", "behave", "--dry-run", "-f", "json", ...behaveDirs(root), ...(story ? [`--tags=@${story}`] : [])];
  } else {
    cmd = join(root, "node_modules/.bin/cucumber-js");
    if (!existsSync(cmd)) return undefined;
    args = ["--dry-run", "--format", "json", ...(story ? ["--tags", `@${story}`] : [])];
  }
  const r = spawnSync(cmd, args, { cwd: root, env: runnerEnv(stack), encoding: "utf8", stdio: "pipe" });
  // Cucumber's JSON is the whole output. behave prints a line before its JSON and a summary after it: the
  // JSON is the array from its first line to the bracket that closes it at the start of a line.
  const stdout = r.stdout ?? "";
  const block = stdout.match(/^\[(?:[\s\S]*?\n)?\]$/m)?.[0] ?? stdout;
  let data: any;
  try {
    data = JSON.parse(block);
  } catch {
    return undefined;
  }
  if (!Array.isArray(data)) return undefined;
  const tagOf = (tags: unknown[] = []) =>
    tags
      .map((t: any) => String(typeof t === "string" ? t : t?.name ?? "").replace(/^@/, ""))
      .find((t) => STORY_TAG.test(t));
  const out: UndefinedStep[] = [];
  for (const feature of data) {
    for (const el of feature?.elements ?? []) {
      for (const step of el?.steps ?? []) {
        if (step?.result?.status !== "undefined") continue;
        out.push({ story: tagOf([...(feature.tags ?? []), ...(el.tags ?? [])]) ?? "", text: String(step.name ?? "") });
      }
    }
  }
  return out;
}

/** Run the story's scenarios (or all of them) with the repo's Cucumber runner. */
export function verify(root: string, story?: string, opts: { inherit?: boolean; map?: string } = {}): VerifyResult {
  const stack = stackOrThrow(root);
  if (!existsSync(join(root, CONFIG[stack]))) throw new Error(`No ${CONFIG[stack]} yet. Run \`nikos verify setup\` first.`);
  // cucumber-js and behave both run zero scenarios and exit 0 for a tag that matches nothing.
  if (story && !featureFor(story, root, opts.map)) throw new Error(`No feature file is tagged @${story}`);

  let cmd: string;
  let args: string[];
  if (stack === "python") {
    cmd = process.env.PYTHON ?? "python3";
    args = ["-m", "behave", ...behaveDirs(root), ...(story ? [`--tags=@${story}`] : [])];
  } else {
    cmd = join(root, "node_modules/.bin/cucumber-js");
    if (!existsSync(cmd)) throw new Error(`cucumber-js isn't installed. Run: ${INSTALL[stack]}`);
    args = story ? ["--tags", `@${story}`] : [];
  }
  const r = spawnSync(cmd, args, { cwd: root, env: runnerEnv(stack), encoding: "utf8", stdio: "pipe" });
  if (r.error) throw new Error(`Couldn't run ${cmd}: ${r.error.message}. Run: ${INSTALL[stack]}`);
  // With inherit the output still goes to the terminal, after the run.
  if (opts.inherit) {
    process.stdout.write(r.stdout ?? "");
    process.stderr.write(r.stderr ?? "");
  }
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (story && r.status === 0 && /^0 scenarios\b/m.test(output)) {
    throw new Error(`No scenarios ran for @${story}: the runner's paths don't reach its feature file. Check ${CONFIG[stack]}`);
  }
  const node = r.status !== 0 ? nodeWarning(stack) : undefined;
  if (node && opts.inherit) console.error(`\n! ${node}`);
  return { stack, command: [cmd, ...args].join(" "), status: r.status ?? 1, output: `${output}${node ? `\n${node}\n` : ""}` };
}

/** Say which steps in the team's stories have no definition yet, as a warning. */
export function printUndefined(steps: UndefinedStep[] | undefined): void {
  if (steps === undefined) {
    console.log("! could not list undefined steps: the test run will report them");
    return;
  }
  if (!steps.length) return;
  console.log(`! ${steps.length} ${steps.length === 1 ? "step" : "steps"} in the team's stories ${steps.length === 1 ? "has" : "have"} no step definition yet:`);
  for (const s of steps) console.log(`    "${s.text}"${s.story ? ` (${s.story})` : ""}`);
}

export function runVerify(args: string[]): number {
  const i = args.indexOf("--dir");
  const root = i >= 0 ? args[i + 1] : process.cwd();
  const positional = args.filter((a, n) => !["--dir", "--map"].includes(a) && !["--dir", "--map"].includes(args[n - 1]));
  try {
    if (positional[0] === "setup") {
      const r = setupVerify(root);
      console.log(`Stack: ${r.stack}`);
      if (r.created.length) console.log(`Created:\n${r.created.map((f) => `  + ${f}`).join("\n")}`);
      if (r.skipped.length) console.log(`Skipped (already there):\n${r.skipped.map((f) => `  = ${f}`).join("\n")}`);
      if (r.node) console.log(`\n! ${r.node}`);
      console.log(`\nNext: ${r.install}\nThen: nikos verify <story-id>`);
      return 0;
    }
    // A team's whole-suite run with no map of its own runs no stories: say so before it does.
    if (isTeamRepo(root) && !positional[0] && !ownMapsOf(root).length) console.log("! this team has no story map yet: nikos map new, then its stories run here");
    const r = verify(root, positional[0], { inherit: true, map: mapFlag(args) });
    if (isTeamRepo(root)) printUndefined(undefinedSteps(root, r.stack, positional[0]));
    return r.status;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
