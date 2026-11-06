#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { runValidate } from "./commands/validate.js";
import { runPlan } from "./commands/plan.js";
import { runInit } from "./commands/init.js";
import { runClear } from "./commands/clear.js";
import { runVerify } from "./commands/verify.js";
import { runCi } from "./commands/ci.js";
import { runNext } from "./commands/next.js";
import { runState } from "./commands/state.js";
import { runApprove } from "./commands/approve.js";
import { runSuggest } from "./commands/suggest.js";
import { runMcp } from "./mcp/server.js";
import { runJoin, runSettings } from "./commands/join.js";
import { runDoctor } from "./commands/doctor.js";
import { runMigrate } from "./commands/migrate.js";
import { runTracker } from "./commands/tracker.js";
import { runCompany, runStart } from "./commands/start.js";
import { runDecide } from "./commands/decide.js";
import { runShow } from "./commands/show.js";
import { runDecisions } from "./commands/decisions.js";
import { runStory } from "./commands/story.js";
import { runActivity, runStep } from "./commands/step.js";
import { runRelease } from "./commands/release.js";
import { runVideo } from "./commands/video.js";
import { runMap } from "./commands/map.js";
import { runExport } from "./commands/export.js";
import { runPlanning } from "./planning/cli.js";

const commands: Record<string, (args: string[]) => number | Promise<number>> = {
  init: runInit,
  validate: runValidate,
  plan: runPlan,
  clear: runClear,
  verify: runVerify,
  ci: runCi,
  next: runNext,
  state: runState,
  approve: runApprove,
  suggest: runSuggest,
  mcp: runMcp,
  join: runJoin,
  settings: runSettings,
  doctor: runDoctor,
  migrate: runMigrate,
  tracker: runTracker,
  start: runStart,
  company: runCompany,
  decide: runDecide,
  show: runShow,
  decisions: runDecisions,
  story: runStory,
  step: runStep,
  activity: runActivity,
  release: runRelease,
  video: runVideo,
  map: runMap,
  export: runExport,
  planning: runPlanning,
};

const help = `nikos — spec-driven development for AI coding agents

Usage: nikos <command> [options]

Commands:
  start            Set this repo up in one go: intent/, a scenario runner for its stack
                   and CI for its host, each only if it's missing (--name, --key)
  init             Create intent/ in this repo (--name, --key)
  validate [dir]   Check the intent/ folder is well formed
  story add "<title>"  Add a story to the map, state and a starter feature
                   (--activity, --step, --release, --priority)
  activity add "<title>"  Add an activity to the story map (--id)
  step add "<title>"   Add a step under an activity (--activity, --id)
  release add "<title>"  Add the next release (--goal)
  release rename <n>   Change a release's title or goal (--goal)
  release move <id> <n>  Move a story to another release, retagging its feature
  release reorder <n> <pos>  Move a release and renumber them all
  release remove <n>   Remove an empty release and renumber the rest
  release check <n>    Is a release ready to ship? (--run reruns its scenarios)
  plan new <id>    Start the next version of a story's plan
  clear <id>       Check a story is Lean and Executable before building
  verify setup     Set up a Cucumber runner for this repo's stack
  verify [id]      Run a story's scenarios (or all of them)
  ci setup         Run validate and every story's scenarios on each PR or merge
                   request (GitHub Actions or GitLab CI; --github, --gitlab)
  show <id>        Summarise a story: feature, status, plan, bets, decisions
  decisions "<q>"  Quote the decisions.md entries that mention a topic or story
  next             Print the next story to build
  state set <id> <status>  Move a story; done only if its scenarios pass
                   (cancelled needs --reason)
  approve <id>...  Sign off done stories: in your terminal, or --via chat when
                   you've answered an agent's "Do you want to approve …?"
  suggest          What to do next: where things stand and a short menu (--json, --brief)
  company init     Write a company plan repo that departments and teams join
                   (--name, --period, --departments, --repo, --host)
  join <repo>      Plan against a company or department plan, and inherit its settings
                   (--host gitlab.com, --url, --ref)
  settings [set <key> <value>]  See the settings that apply here and where each comes
                   from, or change one this repo is allowed to
  doctor           Check this repo is set up well, and say what to do next (--offline)
  migrate per-story  Give each story its own state and approval file, so parallel
                   branches never conflict (migrate single-file goes back)
  tracker link|record|sync|import  Keep the story map and a Jira, Linear, GitHub or GitLab
                   tracker in step; the agent reads tickets through the tracker's MCP
  mcp              Run nikOS as a local MCP server for Claude Desktop, Cursor, Codex and
                   other apps (--dir <repo>)
  decide "<title>" Append a decision to decisions.md
                   (--why, --story, --category, --supersedes)
  video            Draft a video brief and storyboard from the done stories
                   (--out, default marketing/storymap-video)
  map              Write a read-only story map page (--out, default storymap.html)
  export --format <prd|linear|jira>  The story map as a PRD or tracker import
                   (--release, --out, --project-key)
  planning <cmd>   Bets, key results and the planning dashboard (nikos-planning pack;
                   run \`nikos planning help\`)

  --version        Print the installed version

Docs: https://nikos.tools`;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    console.log(help);
    return 0;
  }
  if (cmd === "--version" || cmd === "-v" || cmd === "version") {
    console.log(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
    return 0;
  }
  const run = commands[cmd];
  if (!run) {
    console.error(`Unknown command '${cmd}'.\n\n${help}`);
    return 1;
  }
  return run(rest);
}

main(process.argv.slice(2)).then((code) => process.exit(code));
