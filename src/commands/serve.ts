// `nikos serve`: see what's in this repo. Opens the local dashboard: the plan's objectives, key
// results, bets and rollout, with the story map a click away. The same as `nikos planning serve`,
// under the name people try first.
import { join, resolve } from "node:path";
import { store } from "../lib/store.js";
import { mapDirs } from "../lib/maps.js";
import { runServe } from "../planning/server.js";

export function runServeCommand(args: string[]): Promise<number> | number {
  const opt = (n: string) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const root = resolve(opt("dir") ?? process.cwd());
  if (!mapDirs(root).length && !store().isDir(join(root, "planning"))) {
    console.error(`✗ There's nothing to show in ${root} yet: it has no story map (maps/) and no plan (planning/).\n  To set it up, run: nikos start`);
    return 1;
  }
  const exportTo = opt("export");
  // A bare --export (no file) would otherwise start the live server.
  if (args.includes("--export") && (exportTo === undefined || exportTo.startsWith("--"))) {
    console.error("✗ --export needs a file name. For example: nikos serve --export plan.html");
    return 1;
  }
  return runServe(root, {
    port: opt("port") ? Number(opt("port")) : undefined,
    exportTo,
    map: opt("map"),
    editable: args.includes("--editable"),
    withLinked: args.includes("--with-linked"),
  });
}
