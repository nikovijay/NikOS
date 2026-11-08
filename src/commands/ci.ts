// `nikos ci setup`: run nikOS's checks on every pull request (GitHub) or merge request (GitLab).
// The pipeline runs `nikos validate` and every story's scenarios with `nikos verify`, using the
// nikos version that wrote it, so a red pipeline means the specs or the code broke, not nikos.
// A second, run-on-demand pipeline checks a release is ready to ship (nikos release check <n>
// --run): it fails while a story isn't done, its spec changed, or (when approval.policy is
// required-for-release) a story isn't approved. It's started by hand, with the release number,
// rather than on every change, because a release in progress is never ready.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectStack, type Stack } from "../verify/detect.js";
import { isTeamRepo } from "../lib/team.js";

import { hostOf, type Host } from "../lib/forge.js";

export type { Host };

const here = dirname(fileURLToPath(import.meta.url));
const version = (): string => {
  const pkg = [join(here, "../../package.json"), join(here, "../package.json")].find((p) => existsSync(p))!;
  return JSON.parse(readFileSync(pkg, "utf8")).version;
};

/** github or gitlab, from the origin remote's url; undefined when it's neither or there's no remote. */
export function detectHost(root: string): Host | undefined {
  const url = spawnSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8" }).stdout?.trim() ?? "";
  return hostOf(url);
}

/** The shell steps that install the project and its scenario runner, for a stack. */
const install = (stack: Stack, root: string): string[] =>
  stack === "python"
    ? [existsSync(join(root, "requirements.txt")) ? "pip install -r requirements.txt" : "", "pip install behave"].filter(Boolean)
    : [existsSync(join(root, "package-lock.json")) ? "npm ci" : "npm install"];

/**
 * The shell steps that install the runner and run the checks, for a stack. A team repo fetches its
 * assigned stories first: they're gitignored, so a fresh checkout has none to verify.
 */
function steps(stack: Stack, root: string, nikos: string): string[] {
  const sync = isTeamRepo(root) ? [`npx -y ${nikos} sync`] : [];
  return [...install(stack, root), ...sync, `npx -y ${nikos} validate`, `npx -y ${nikos} verify`];
}

/** The release check, run by hand with the release number. RELEASE comes in as an env var, never pasted into the script. */
const releaseSteps = (stack: Stack, root: string, nikos: string, variable: string) => [...install(stack, root), `npx -y ${nikos} release check "$${variable}" --run`];

export function githubReleaseWorkflow(stack: Stack, root: string): string {
  const nikos = `nikos@${version()}`;
  const python = stack === "python" ? `      - uses: actions/setup-python@v5\n        with:\n          python-version: "3.12"\n` : "";
  return `# Written by nikos ci setup: checks a release is ready to ship. Run it from the Actions tab
# (Run workflow) with the release number. It fails while a story isn't done, a spec changed
# after done, or a story needs an approval it doesn't have.
name: nikos release check
on:
  workflow_dispatch:
    inputs:
      release:
        description: The release number to check
        required: true
        type: number
jobs:
  release-check:
    runs-on: ubuntu-latest
    env:
      RELEASE: \${{ inputs.release }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
${python}${releaseSteps(stack, root, nikos, "RELEASE").map((s) => `      - run: ${s}`).join("\n")}
`;
}

export function githubWorkflow(stack: Stack, root: string): string {
  const nikos = `nikos@${version()}`;
  const python = stack === "python" ? `      - uses: actions/setup-python@v5\n        with:\n          python-version: "3.12"\n` : "";
  return `# Written by nikos ci setup: checks the specs in intent/ and runs every story's scenarios.
name: nikos
on:
  pull_request:
  push:
    branches: [main]
jobs:
  nikos:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
${python}${steps(stack, root, nikos).map((s) => `      - run: ${s}`).join("\n")}
`;
}

export function gitlabJob(stack: Stack, root: string): string {
  const nikos = `nikos@${version()}`;
  // Python stories need node for nikos itself, so that image installs it.
  const image = stack === "python" ? "python:3.12" : "node:22";
  const setup = stack === "python" ? ["apt-get update -qq && apt-get install -y -qq nodejs npm"] : [];
  return `# Written by nikos ci setup: checks the specs in intent/ and runs every story's scenarios.
nikos:
  image: ${image}
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  script:
${[...setup, ...steps(stack, root, nikos)].map((s) => `    - ${s}`).join("\n")}

# Checks a release is ready to ship. Run a pipeline by hand (Build > Pipelines > New pipeline)
# with the variable NIKOS_RELEASE set to the release number.
nikos-release:
  image: ${image}
  rules:
    - if: $NIKOS_RELEASE
  script:
${[...setup, ...releaseSteps(stack, root, nikos, "NIKOS_RELEASE")].map((s) => `    - ${s}`).join("\n")}
`;
}

export interface CiResult {
  host: Host;
  created: string[];
  skipped: string[];
  /** Something the person (or their agent) still has to do by hand. */
  todo?: string;
}

const GITLAB_JOB = ".gitlab/ci/nikos.yml";
const INCLUDE = `include:\n  - local: ${GITLAB_JOB}\n`;

/** Write the pipeline for the repo's host and stack. Never overwrites a file. */
export function setupCi(root: string, opts: { host?: Host } = {}): CiResult {
  const host = opts.host ?? detectHost(root);
  if (!host) throw new Error("Couldn't tell where this repo is hosted from its origin remote. Say which: --github or --gitlab");
  const stack = detectStack(root);
  if (!stack) throw new Error("Couldn't tell the stack: no package.json, pyproject.toml or requirements.txt. Run nikos verify setup first.");
  const created: string[] = [];
  const skipped: string[] = [];
  const write = (rel: string, text: string) => {
    const path = join(root, rel);
    if (existsSync(path)) return void skipped.push(rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    created.push(rel);
  };
  if (host === "github") {
    write(".github/workflows/nikos.yml", githubWorkflow(stack, root));
    write(".github/workflows/nikos-release.yml", githubReleaseWorkflow(stack, root));
    return { host, created, skipped };
  }
  // GitLab reads one .gitlab-ci.yml, so the job lives in its own file and is included from it.
  write(GITLAB_JOB, gitlabJob(stack, root));
  // A job file from before the release check: say what to add rather than rewrite it.
  const old = skipped.includes(GITLAB_JOB) && !readFileSync(join(root, GITLAB_JOB), "utf8").includes("nikos-release:");
  const releaseTodo = old ? `Add the release check job to ${GITLAB_JOB}:\n${gitlabJob(stack, root).slice(gitlabJob(stack, root).indexOf("# Checks a release"))}` : undefined;
  const main = join(root, ".gitlab-ci.yml");
  if (!existsSync(main)) {
    write(".gitlab-ci.yml", INCLUDE);
    return { host, created, skipped, ...(releaseTodo ? { todo: releaseTodo } : {}) };
  }
  const included = readFileSync(main, "utf8").includes(GITLAB_JOB);
  const todo = [included ? "" : `Add this to .gitlab-ci.yml:\n${INCLUDE}`, releaseTodo ?? ""].filter(Boolean).join("\n");
  return { host, created, skipped, ...(todo ? { todo } : {}) };
}

export function runCi(args: string[]): number {
  const [sub, ...rest] = args;
  if (sub !== "setup") {
    console.error("Usage: nikos ci setup [--github | --gitlab] [--dir <path>]");
    return 1;
  }
  const i = rest.indexOf("--dir");
  const root = i >= 0 ? rest[i + 1] : process.cwd();
  const host: Host | undefined = rest.includes("--github") ? "github" : rest.includes("--gitlab") ? "gitlab" : undefined;
  try {
    const r = setupCi(root, { host });
    if (r.created.length) console.log(`Created:\n${r.created.map((f) => `  + ${f}`).join("\n")}`);
    if (r.skipped.length) console.log(`Skipped (already there):\n${r.skipped.map((f) => `  = ${f}`).join("\n")}`);
    if (r.todo) console.log(`\n${r.todo}`);
    console.log(`\nEvery ${r.host === "github" ? "pull request" : "merge request"} now runs nikos validate and every story's scenarios.`);
    console.log(
      r.host === "github"
        ? "To check a release is ready to ship, run the \"nikos release check\" workflow from the Actions tab with its number."
        : "To check a release is ready to ship, run a pipeline by hand with NIKOS_RELEASE set to its number.",
    );
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
