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
import { runTracker } from "./commands/tracker.js";
import { runStart } from "./commands/start.js";
import { runDecide } from "./commands/decide.js";
import { runShow } from "./commands/show.js";
import { runDecisions } from "./commands/decisions.js";
import { runStory } from "./commands/story.js";
import { runActivity, runStep } from "./commands/step.js";
import { runRelease } from "./commands/release.js";
import { runVideo } from "./commands/video.js";
import { runMap } from "./commands/map.js";
import { runExport } from "./commands/export.js";
import { help as planRepoHelp, runPlanRepo } from "./plan/cli.js";
import { runServeCommand } from "./commands/serve.js";
import { closest } from "./lib/closest.js";

const commands: Record<string, (args: string[]) => number | Promise<number>> = {
  init: runInit,
  validate: runValidate,
  // plan new <story> starts a story's plan; every other plan command is the company's planning repo.
  plan: (args: string[]) => (args[0] === "new" ? runPlan(args) : runPlanRepo(args)),
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
  tracker: runTracker,
  start: runStart,
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
  serve: runServeCommand,
};

const help = `nikos: plan the work, write it as stories, and check each story is really done

Usage: nikos <command> [options]
For one command's options: nikos <command> --help

Get started
  start            Set up nikOS in this folder. Pick one: --plan makes the company's planning
                   repo (--name, --year, --pillars); --map makes a story map for this code
                   (--name, --key, --join <planning repo>). In a terminal, with no flags, it asks
                   which one, then a few questions. An agent passes the flags
  serve            Open the dashboard in your browser: the plan and the story map
                   (--port; --export <file> saves it as one page you can share)
  doctor           Check this repo is set up well, and say what to do next (--offline)
  suggest          Say where things stand and what to do next (--json, --brief, --map; in a
                   planning repo, --in <area>)

Plans: objectives, key results and bets
  plan <cmd>       The company's plan in one repo, with a folder for each department, group
                   and team. Run nikos plan help to see how (plan init, add, kr, bet, checkin)
  join <repo>      Link this repo to the company's planning repo (--host gitlab.com). Run it
                   from a code repo; it lists this repo in planning/repos.yaml on a nikos/join
                   branch for review. Settings are not inherited: a code repo keeps its own
  settings [set <key> <value>]  Show the settings that apply here and where each one comes
                   from, or change one this repo is allowed to change

Story maps and stories
  init             Make maps/<key>/ in this repo for its story map (--name, --key)
  story add "<title>"  Add a story to the story map, with a starter feature file
                   (--activity, --step, --release, --priority, --map in a group repo)
  activity add "<title>"  Add an activity: a big thing people do with the product (--id)
  step add "<title>"   Add a step under an activity (--activity, --id)
  release add "<title>"  Add the next release (--goal)
  release rename <n>   Change a release's title or goal (--goal)
  release move <id> <n>  Move a story to another release
  release reorder <n> <pos>  Move a release to another place and renumber them all
  release remove <n>   Remove an empty release and renumber the rest
  release check <n>    Check whether a release is ready to ship (--run runs its scenarios again)
  map              Save the story map as a page you can open offline
                   (--out, default storymap.html; --map)
  map new          Make a story map for one bet, in maps/<key>/ (--bet <bet-id or repo#bet-id>,
                   --key <KEY>, --owner <KEY> for the story ids, e.g. WEB-CHK-1)
  map status       How each story in this repo's maps is doing, and save it to
                   maps/<key>/delivery.yaml to commit (--map, --json saves nothing)
  validate [dir]   Check the story map is well formed (each map in maps/), and that
                   each map's delivery.yaml is current
  show <id>        Sum up a story: its feature, status, plan, bets and decisions
  next             Show the next story to build

Building and checking stories
  plan new <id>    Start a new version of a story's plan
  clear <id>       Check a story is small and testable enough to build
  verify setup     Set up Cucumber, which runs a story's scenarios, for this repo's language
  verify [id]      Run a story's scenarios, or every story's
  state set <id> <status>  Move a story to another status. It only becomes done if its
                   scenarios pass (cancelled needs --reason)
  approve <id>...  Sign off stories that are done: in your terminal, or with --via chat after
                   you answer an agent's "Do you want to approve …?"
  ci setup         Run the checks and every story's scenarios on each pull or merge request
                   (GitHub Actions or GitLab CI; --github, --gitlab)

Decisions, exports and tools
  decide "<title>" Record a decision in decisions.md (--why, --story, --category, --supersedes;
                   in a planning repo, --in <area> picks whose decisions.md, else the company's)
  decisions "<q>"  Show the decisions in decisions.md that mention a topic or story
  export --format <prd|linear|jira>  Turn the story map into a product brief or a file
                   to import into a tracker (--release, --out, --project-key)
  tracker link|record|sync|import  Keep the story map in step with Jira, Linear, GitHub or
                   GitLab issues
  mcp              Let Claude Desktop, Cursor, Codex and other apps use nikOS (--dir <repo>)
  video            Draft a video brief and storyboard from the done stories
                   (--out, default marketing/storymap-video)

  --version        Show which version of nikOS this is
  help             Show this list

Docs: https://nikos.tools`;

/** The lines of the help for one command: its entry, and the lines that continue it. */
function commandHelp(cmd: string): string {
  const lines = help.split("\n");
  const out: string[] = [];
  let inEntry = false;
  for (const line of lines) {
    const entry = /^  \S/.test(line);
    if (entry) inEntry = line.slice(2).split(/[\s|]/)[0] === cmd;
    else if (!/^   /.test(line)) inEntry = false;
    if (inEntry) out.push(line);
  }
  return `Usage: nikos ${cmd} [options]\n\n${out.join("\n")}\n\nSee every command: nikos help\nDocs: https://nikos.tools`;
}

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
    // A typo gets the nearest command, not the whole help.
    const near = closest(cmd, [...Object.keys(commands), "help"]);
    console.error(`Unknown command '${cmd}'.${near ? ` Did you mean: nikos ${near}?` : ""}\nSee every command: nikos help`);
    return 1;
  }
  // `<command> --help` prints help and runs nothing: some commands write files whatever their arguments.
  if (rest.includes("--help") || rest.includes("-h")) {
    console.log(cmd === "plan" && rest[0] !== "new" ? planRepoHelp : commandHelp(cmd));
    return 0;
  }
  if (rest.indexOf("--dir") >= 0 && !rest[rest.indexOf("--dir") + 1]) {
    console.error("✗ --dir needs a folder: --dir <path>");
    return 1;
  }
  return run(rest);
}

main(process.argv.slice(2)).then((code) => process.exit(code));
