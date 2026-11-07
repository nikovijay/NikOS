// `nikos serve`: see what's in this repo. Opens the local dashboard: the plan's objectives, key
// results, bets and rollout, with the story map a click away. The same as `nikos planning serve`,
// under the name people try first.
import { join, resolve } from "node:path";
import { store } from "../lib/store.js";
import { runServe } from "../planning/server.js";

export function runServeCommand(args: string[]): Promise<number> | number {
  const opt = (n: string) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const root = resolve(opt("dir") ?? process.cwd());
  if (!store().exists(join(root, "intent", "storymap.yaml")) && !store().isDir(join(root, "planning"))) {
    console.error("✗ Nothing to show here yet: this folder has no intent/ or planning/. Set it up with nikos start (a team's product) or nikos company init (a company plan).");
    return 1;
  }
  return runServe(root, { port: opt("port") ? Number(opt("port")) : undefined, exportTo: opt("export") });
}
