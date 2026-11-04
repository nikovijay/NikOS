#!/usr/bin/env node
import { runValidate } from "./commands/validate.js";
import { runPlan } from "./commands/plan.js";
import { runInit } from "./commands/init.js";
import { runClear } from "./commands/clear.js";
import { runVerify } from "./commands/verify.js";
import { runNext } from "./commands/next.js";
import { runState } from "./commands/state.js";
import { runDecide } from "./commands/decide.js";
import { runBet } from "./commands/bet.js";
import { runShow } from "./commands/show.js";
import { runDecisions } from "./commands/decisions.js";
import { runStory } from "./commands/story.js";

const commands: Record<string, (args: string[]) => number | Promise<number>> = {
  init: runInit,
  validate: runValidate,
  plan: runPlan,
  clear: runClear,
  verify: runVerify,
  next: runNext,
  state: runState,
  decide: runDecide,
  bet: runBet,
  show: runShow,
  decisions: runDecisions,
  story: runStory,
};

const help = `nikos — spec-driven development for AI coding agents

Usage: nikos <command> [options]

Commands:
  init             Create intent/ in this repo (--name, --key)
  validate [dir]   Check the intent/ folder is well formed
  story add "<title>"  Add a story to the map, state and a starter feature
                   (--activity, --release, --priority)
  plan new <id>    Start the next version of a story's plan
  clear <id>       Check a story is Lean and Executable before building
  verify setup     Set up a Cucumber runner for this repo's stack
  verify [id]      Run a story's scenarios (or all of them)
  show <id>        Summarise a story: feature, status, plan, bets, decisions
  decisions "<q>"  Quote the decisions.md entries that mention a topic or story
  next             Print the next story to build
  state set <id> <status>  Move a story; done only if its scenarios pass
  decide "<title>" Append a decision to decisions.md
                   (--why, --story, --category, --supersedes)
  bet new <bet-id> Write a time-boxed bet card linked to its stories
                   (--hypothesis, --kr, --uplift, --time-box, --story, --blocker)

Docs: https://nikos.tools`;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    console.log(help);
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
