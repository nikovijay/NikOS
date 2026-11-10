// `nikos serve`: see this code repo's story map in your browser, or save it as one page. A planning repo
// has no story map of its own, so it is sent to nikos plan serve.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderMap } from "./map.js";
import { mapDirs } from "../lib/maps.js";
import { oldLayoutProblem } from "../plan/repo.js";
import { isPlanRepo } from "../planning/model.js";
import { startServer, type RunningServer } from "../planning/server.js";

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
  if (isPlanRepo(root)) {
    console.error("✗ This is a planning repo: it holds the company's plan, not story maps. To see the plan, run: nikos plan serve");
    return 1;
  }
  if (!mapDirs(root).length) {
    console.error(`✗ There's nothing to show in ${root} yet: it has no story map (maps/).\n  To set it up, run: nikos start`);
    return 1;
  }
  const map = opt("map");
  const exportTo = opt("export");
  // A bare --export (no file) would otherwise start the live server.
  if (args.includes("--export") && (exportTo === undefined || exportTo.startsWith("--"))) {
    console.error("✗ --export needs a file name. For example: nikos serve --export storymap.html");
    return 1;
  }
  if (exportTo) return exportMap(resolve(exportTo), root, map);
  return runServe(root, { port: opt("port") ? Number(opt("port")) : undefined, map });
}

/** The story map as one page that opens in any browser: it works offline and can't change anything. */
function exportMap(file: string, root: string, map: string | undefined): number {
  writeFileSync(file, renderMap(root, { map }));
  console.log(`Saved the story map as one page: ${file}`);
  console.log("It opens in any browser, works offline and can't change anything.");
  return 0;
}

/** The story map server: the live map at /, read-only. It takes no save and has no other page. */
export function startMapServer(root: string, opts: { port?: number; map?: string } = {}): Promise<RunningServer> {
  return startServer(root, {
    port: opts.port,
    pages: { page: (query) => renderMap(root, { live: true, map: query.get("map") ?? opts.map }) },
  });
}

/** Serve the story map on 127.0.0.1 until Ctrl+C. The page is read-only, so it needs no key. */
async function runServe(root: string, opts: { port?: number; map?: string }): Promise<number> {
  const srv = await startMapServer(root, opts);
  console.log("The story map is running. Open this link in your browser:");
  console.log(`  http://127.0.0.1:${srv.port}/`);
  console.log("");
  console.log("It only reads this repo: nothing you do on the page changes a file.");
  console.log("Press Ctrl+C to stop.");
  return new Promise<number>((ok) => {
    const stop = () => {
      srv.close().then(() => ok(0));
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
