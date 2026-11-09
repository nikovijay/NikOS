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
import { runCompany, runGroup, runStart } from "./commands/start.js";
import { runDecide } from "./commands/decide.js";
import { runShow } from "./commands/show.js";
import { runDecisions } from "./commands/decisions.js";
import { runStory } from "./commands/story.js";
import { runActivity, runStep } from "./commands/step.js";
import { runRelease } from "./commands/release.js";
import { runVideo } from "./commands/video.js";
import { runMap } from "./commands/map.js";
import { runExport } from "./commands/export.js";
import { help as planningHelp, runPlanning } from "./planning/cli.js";
import { help as planRepoHelp, runPlanRepo } from "./plan/cli.js";
import { runServeCommand } from "./commands/serve.js";
import { runApply } from "./planning/apply.js";
import { runAssign } from "./commands/assign.js";
import { runTeam } from "./commands/team.js";
import { runTeamSync } from "./team/sync.js";
import { isTeamRepo, openTeam, TEAM_REPO_STORIES, teamOptedIn } from "./lib/team.js";
import { store } from "./lib/store.js";
import { join } from "node:path";
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
  migrate: runMigrate,
  tracker: runTracker,
  start: runStart,
  company: runCompany,
  group: runGroup,
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
  serve: runServeCommand,
  apply: runApply,
  assign: runAssign,
  team: runTeam,
  sync: runTeamSync,
};

/** Why a team repo refuses a command that writes a group's stories or plan: each names where the work is done. */
function teamRefusal(cmd: string): string {
  if (cmd === "story" || cmd === "step" || cmd === "activity" || cmd === "release" || cmd === "map") return TEAM_REPO_STORIES;
  if (cmd === "assign") return "this is a team repo: assignments are made in the group repo";
  if (cmd === "apply") return "this is a team repo: changes are made in the group repo";
  if (cmd === "join") return "this is a team repo: take work from a group with nikos team join <group repo>";
  return `this is a team repo: nikos ${cmd} runs in a group or plan repo`;
}

/** What a team repo may run from the group-only commands: its own planning, bets, joins and maps (see the amendment, rule 2). */
const TEAM_PLANNING = new Set(["sync", "status", "validate", "rollout"]);
function teamMayRun(cmd: string, rest: string[], dir: string): boolean {
  // A team's first join names its home with --home; after that a team that has opted in may join more.
  if (cmd === "join") return rest.includes("--home") || teamOptedIn(dir);
  if (!teamOptedIn(dir)) return false;
  if (cmd === "planning") return TEAM_PLANNING.has(rest[0]) || (["bet", "kr"].includes(rest[0]) && rest[1] === "new");
  // assign takes a team's own maps only: a copy's assignments are refused where they're made (assign.ts).
  if (cmd === "assign") return true;
  // A team writes stories and maps of its own; a copy of a group's or another team's map is refused where it's reached (authoringMap).
  if (cmd === "story" || cmd === "step" || cmd === "activity" || cmd === "release") return true;
  if (cmd === "map") return rest[0] === "new";
  return false;
}

/** Commands that write a group's stories or plan. A team repo takes its stories from the group, so these are refused there. */
const GROUP_ONLY = new Set(["story", "step", "activity", "release", "map", "assign", "migrate", "planning", "join", "start", "init", "company", "group", "decide", "rollout", "apply"]);

const help = `nikos: plan the work, write it as stories, and check each story is really done

Usage: nikos <command> [options]
For one command's options: nikos <command> --help

Get started
  start            Set up nikOS in this folder. In a terminal, it asks a few questions first.
                   An agent passes --name and --key instead
  serve            Open the dashboard in your browser: the plan and the story map
                   (--port; --export <file> saves it as one page you can share, add --editable
                   so people can suggest changes in it, and --with-linked to include linked plans)
  doctor           Check this repo is set up well, and say what to do next (--offline)
  suggest          Say where things stand and what to do next (--json, --brief, --map)

Plans: objectives, key results and bets
  plan <cmd>       The company's plan in one repo, with a folder for each department, group
                   and team. Run nikos plan help to see how (plan init, add, kr, bet, checkin)
  company init     Make a company plan that departments plan under. Add --level department
                   for a department's plan (--name, --period, --departments, --repo, --host)
  group init       Make a group plan: bets aimed at a department's key results. A group has
                   no key results of its own (--name, --key, --period, --repo, --host)
  join <repo>      Link this repo to the plan above it, and take on that plan's settings
                   (--host gitlab.com, --url, --ref)
  planning <cmd>   Add key results, bets and check-ins. Run nikos planning help to see how
  apply <file>     Apply a changes file someone downloaded from an editable dashboard page.
                   It goes on a new branch and nothing is pushed (--dir, --commit, --pr)
  settings [set <key> <value>]  Show the settings that apply here and where each one comes
                   from, or change one this repo is allowed to change

Story maps and stories
  init             Make an intent/ folder in this repo for its story map (--name, --key)
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
  map new          Make a story map for one bet, in maps/<key>/. In a group repo, or a team
                   repo with a key and a home (--bet <bet-id or repo#bet-id>, --key <KEY>,
                   --owner <KEY> for the story ids, e.g. WEB-CHK-1)
  map status       How each story in this repo's maps is doing, and save it to
                   maps/<key>/delivery.yaml to commit (--map, --json saves nothing)
  validate [dir]   Check the intent/ folder is well formed
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

Teams
  assign "<team>" --repo <path|.>  Give a team all or part of a story map this repo owns
                   (--activities, --releases or --stories; --map, --include-done, --url, --ref)
  team init|join|member|show  Set up a team repo and the repos it takes work from.
                   For example: team init --repo owner/repo --key WEB, team join <group repo>,
                   team member add "<name>". Set its home with nikos join <plan> --home
  sync             In a team repo: fetch the stories given to this team, read-only, into
                   .nikos/assigned/ (git ignores it)

Decisions, exports and tools
  decide "<title>" Record a decision in decisions.md (--why, --story, --category, --supersedes)
  decisions "<q>"  Show the decisions in decisions.md that mention a topic or story
  export --format <prd|linear|jira>  Turn the story map into a product brief or a file
                   to import into a tracker (--release, --out, --project-key)
  tracker link|record|sync|import  Keep the story map in step with Jira, Linear, GitHub or
                   GitLab issues
  mcp              Let Claude Desktop, Cursor, Codex and other apps use nikOS (--dir <repo>)
  video            Draft a video brief and storyboard from the done stories
                   (--out, default marketing/storymap-video)
  migrate per-story  Give each story its own status file, so branches never clash
                   (migrate single-file goes back)
  migrate maps     Move an intent/ story map from nikOS 0.2 into maps/<key>/. Shows the plan
                   first: --dry-run, --yes and --help for every option

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
  // `migrate maps` has its own, longer help.
  if ((rest.includes("--help") || rest.includes("-h")) && !(cmd === "migrate" && rest[0] === "maps")) {
    console.log(cmd === "planning" ? planningHelp : cmd === "plan" && rest[0] !== "new" ? planRepoHelp : commandHelp(cmd));
    return 0;
  }
  // `nikos map` alone writes the page, which a team can have; `map new` writes a map.
  // `migrate maps` is refused with its own message in a team repo, so it skips the generic one.
  const authoring = GROUP_ONLY.has(cmd) && !(cmd === "map" && rest[0] !== "new") && !(cmd === "migrate" && rest[0] === "maps");
  const at = rest.indexOf("--dir");
  if (at >= 0 && !rest[at + 1]) {
    console.error("✗ --dir needs a folder: --dir <path>");
    return 1;
  }
  const teamDir = at >= 0 ? rest[at + 1] : process.cwd();
  if (authoring && isTeamRepo(teamDir) && !teamMayRun(cmd, rest, teamDir)) {
    console.error(`✗ ${teamRefusal(cmd)}`);
    return 1;
  }
  return run(rest);
}

main(process.argv.slice(2)).then((code) => process.exit(code));
