#!/usr/bin/env node
import { runValidate } from "./commands/validate.js";
import { runPlan } from "./commands/plan.js";
import { runInit } from "./commands/init.js";

const commands: Record<string, (args: string[]) => number | Promise<number>> = {
  init: runInit,
  validate: runValidate,
  plan: runPlan,
};

const help = `nikos — spec-driven development for AI coding agents

Usage: nikos <command> [options]

Commands:
  init             Create intent/ in this repo (--name, --key)
  validate [dir]   Check the intent/ folder is well formed
  plan new <id>    Start the next version of a story's plan

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
