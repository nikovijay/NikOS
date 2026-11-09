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
import { runServeCommand } from "./commands/serve.js";
import { runApply } from "./planning/apply.js";
import { runAssign } from "./commands/assign.js";
import { runTeam } from "./commands/team.js";
import { runTeamSync } from "./team/sync.js";
import { isTeamRepo, openTeam, TEAM_REPO_STORIES, teamOptedIn } from "./lib/team.js";
import { store } from "./lib/store.js";
import { join } from "node:path";

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

const help = `nikos — spec-driven development for AI coding agents

Usage: nikos <command> [options]

Commands:
  start            Set this repo up in one go: intent/, a scenario runner for its stack
                   and CI for its host, each only if it's missing (--name, --key).
                   In a terminal without --name, asks what you're setting up first
  serve            Open the dashboard for this repo: the plan, and the story map (--port,
                   --export <file> [--editable [--with-linked]] for an offline page)
  apply <file>     Apply a change file from an editable planning export to this repo, on a new
                   nikos branch (--dir, --commit, --pr). Nothing is pushed unless you say so
  init             Create intent/ in this repo (--name, --key)
  validate [dir]   Check the intent/ folder is well formed
  story add "<title>"  Add a story to the map, state and a starter feature
                   (--activity, --step, --release, --priority, --map in a group repo)
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
  suggest          What to do next: where things stand and a short menu (--json, --brief, --map)
  company init     Write a company plan repo that departments join, or a department's with
                   --level department (--name, --period, --departments, --repo, --host)
  group init       Write a group plan repo: bets aimed at the department's key results,
                   and no key results of its own (--name, --key, --period, --repo, --host)
  join <repo>      Plan against a company or department plan, and inherit its settings
                   (--host gitlab.com, --url, --ref)
  settings [set <key> <value>]  See the settings that apply here and where each comes
                   from, or change one this repo is allowed to
  doctor           Check this repo is set up well, and say what to do next (--offline)
  migrate per-story  Give each story its own state and approval file, so parallel
                   branches never conflict (migrate single-file goes back)
  migrate maps     Move a 0.2.x intent/ story map to maps/<key>/: of a group repo (--key,
                   --group-key), or of a team repo (--team-key, --home, --bet <id> or
                   <repo>#<id>, --new-bet). Planned first; --dry-run, --yes, --rename-ids,
                   --commit, --help for every option
  tracker link|record|sync|import  Keep the story map and a Jira, Linear, GitHub or GitLab
                   tracker in step; the agent reads tickets through the tracker's MCP
  mcp              Run nikOS as a local MCP server for Claude Desktop, Cursor, Codex and
                   other apps (--dir <repo>)
  decide "<title>" Append a decision to decisions.md
                   (--why, --story, --category, --supersedes)
  video            Draft a video brief and storyboard from the done stories
                   (--out, default marketing/storymap-video)
  map              Write a read-only story map page (--out, default storymap.html, --map)
  map new          In a group repo, or a team repo with a key and a home: a story map for one
                   bet, in maps/<key>/ (--bet <bet-id | repo#bet>, --key <KEY>)
  map status       In a repo that owns maps: each assigned team's status on its stories, fresh
                   or not, delivery and intent approvals; writes maps/<key>/delivery.yaml to
                   commit (--map, --offline, --json, which writes nothing)
  export --format <prd|linear|jira>  The story map as a PRD or tracker import
                   (--release, --out, --project-key)
  planning <cmd>   Bets, key results and the planning dashboard (nikos-planning pack;
                   run \`nikos planning help\`)
  assign "<team>" --repo <path|.>  Give a team all or part of a story map this repo owns
                   (--activities, --releases or --stories; --map, --include-done, --url, --ref)
  team init|join|member|show  A team repo: its name and key, the repos it takes work from,
                   its members (team init --repo owner/repo --key WEB, team join <group or team
                   repo>, team member add "<name>"); its home is set with nikos join <plan> --home
  sync             In a team repo: fetch the stories assigned to it, read-only, into
                   .nikos/assigned/ (gitignored)

  --version        Print the installed version

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
  return `Usage: nikos ${cmd} [options]\n\n${out.join("\n")}\n\nDocs: https://nikos.tools`;
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
    console.error(`Unknown command '${cmd}'.\n\n${help}`);
    return 1;
  }
  // `<command> --help` prints help and runs nothing: some commands write files whatever their arguments.
  // `migrate maps` has its own, longer help.
  if ((rest.includes("--help") || rest.includes("-h")) && !(cmd === "migrate" && rest[0] === "maps")) {
    console.log(cmd === "planning" ? planningHelp : commandHelp(cmd));
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
