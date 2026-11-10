// `nikos serve`: see what's in this repo. Opens the local dashboard of its plan and story maps.
import { join, resolve } from "node:path";
import { store } from "../lib/store.js";
import { mapDirs } from "../lib/maps.js";
import { oldLayoutProblem } from "../plan/repo.js";
import { runServe } from "../planning/server.js";

export function runServeCommand(args: string[]): Promise<number> | number {
  const opt = (n: string) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const root = resolve(opt("dir") ?? process.cwd());
  const old = oldLayoutProblem(root);
  if (old) {
    console.error(`✗ ${old}`);
    return 1;
  }
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
  });
}
