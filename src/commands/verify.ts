import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { walk } from "../lib/project.js";
import { detectStack, type Stack } from "../verify/detect.js";
import { featureFor } from "./clear.js";

const here = dirname(fileURLToPath(import.meta.url));
const templateDir = [join(here, "../../templates/verify"), join(here, "../templates/verify")].find((d) => existsSync(d))!;

const INSTALL: Record<Stack, string> = {
  js: "npm install --save-dev @cucumber/cucumber@^12",
  ts: "npm install --save-dev @cucumber/cucumber@^12 tsx",
  python: "pip install behave",
};

const CONFIG: Record<Stack, string> = { js: "cucumber.mjs", ts: "cucumber.mjs", python: "behave.ini" };

export interface SetupResult {
  stack: Stack;
  created: string[];
  skipped: string[];
  install: string;
}

function stackOrThrow(root: string): Stack {
  const stack = detectStack(root);
  if (!stack) throw new Error("Couldn't tell the stack: no package.json, pyproject.toml or requirements.txt. Ask which runner to use.");
  return stack;
}

/** Write the runner config and step stubs for the repo's stack. Never overwrites a file. */
export function setupVerify(root: string): SetupResult {
  const stack = stackOrThrow(root);
  const src = join(templateDir, stack === "python" ? "python" : stack);
  const created: string[] = [];
  const skipped: string[] = [];
  // Step stubs are for the example story `nikos init` creates; skip them once it's gone.
  const hasExample = existsSync(join(root, "intent/features/getting-started/first-story.feature"));
  for (const file of walk(src)) {
    const rel = relative(src, file);
    if (!hasExample && /first[-_]story/.test(rel)) continue;
    const dest = join(root, rel);
    if (existsSync(dest)) {
      skipped.push(rel);
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(file, dest);
    created.push(rel);
  }
  return { stack, created, skipped, install: INSTALL[stack] };
}

export interface VerifyResult {
  stack: Stack;
  command: string;
  status: number;
  output: string;
}

/** Run the story's scenarios (or all of them) with the repo's Cucumber runner. */
export function verify(root: string, story?: string, opts: { inherit?: boolean } = {}): VerifyResult {
  const stack = stackOrThrow(root);
  if (!existsSync(join(root, CONFIG[stack]))) throw new Error(`No ${CONFIG[stack]} yet. Run \`nikos verify setup\` first.`);
  // cucumber-js and behave both run zero scenarios and exit 0 for a tag that matches nothing.
  if (story && !featureFor(story, root)) throw new Error(`No feature file is tagged @${story}`);

  let cmd: string;
  let args: string[];
  const env = { ...process.env };
  if (stack === "python") {
    cmd = process.env.PYTHON ?? "python3";
    args = ["-m", "behave", ...(story ? [`--tags=@${story}`] : [])];
  } else {
    cmd = join(root, "node_modules/.bin/cucumber-js");
    if (!existsSync(cmd)) throw new Error(`cucumber-js isn't installed. Run: ${INSTALL[stack]}`);
    args = story ? ["--tags", `@${story}`] : [];
    // tsx lets Node versions without built-in type stripping load .ts step files.
    if (stack === "ts") env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --import tsx`.trim();
  }
  const r = spawnSync(cmd, args, { cwd: root, env, encoding: "utf8", stdio: opts.inherit ? "inherit" : "pipe" });
  if (r.error) throw new Error(`Couldn't run ${cmd}: ${r.error.message}. Run: ${INSTALL[stack]}`);
  return { stack, command: [cmd, ...args].join(" "), status: r.status ?? 1, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

export function runVerify(args: string[]): number {
  const i = args.indexOf("--dir");
  const root = i >= 0 ? args[i + 1] : process.cwd();
  const positional = args.filter((a, n) => a !== "--dir" && (i < 0 || n !== i + 1));
  try {
    if (positional[0] === "setup") {
      const r = setupVerify(root);
      console.log(`Stack: ${r.stack}`);
      if (r.created.length) console.log(`Created:\n${r.created.map((f) => `  + ${f}`).join("\n")}`);
      if (r.skipped.length) console.log(`Skipped (already there):\n${r.skipped.map((f) => `  = ${f}`).join("\n")}`);
      console.log(`\nNext: ${r.install}\nThen: nikos verify <story-id>`);
      return 0;
    }
    return verify(root, positional[0], { inherit: true }).status;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
