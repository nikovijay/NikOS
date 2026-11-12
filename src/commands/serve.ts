// `nikos serve`: see this code repo's story map in your browser, or save it as one page. A planning repo
// has no story map of its own, so it is sent to nikos plan serve.
import { writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
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
  if (!mapDirs(root).length) {
    if (isPlanRepo(root)) {
      console.error("✗ This is a planning repo: it holds the company's plan, not story maps. To see the plan, run: nikos plan serve");
      return 1;
    }
    console.error(`✗ There's nothing to show in ${root} yet: it has no story map (maps/).\n  To set it up, run: nikos start --map --name "<name>" --key <KEY>`);
    return 1;
  }
  const map = opt("map");
  const exportTo = opt("export");
  // A bare --export (no file) would otherwise start the live server.
  if (args.includes("--export") && (exportTo === undefined || exportTo.startsWith("--"))) {
    console.error("✗ --export needs a file name. For example: nikos serve --export storymap.html");
    return 1;
  }
  const keys = mapKeys(root);
  if (map !== undefined && !keys.includes(map)) {
    console.error(`✗ There's no story map called '${map}' here. This repo has: ${keys.join(", ")}`);
    return 1;
  }
  if (exportTo && map === undefined && keys.length > 1) {
    console.error(`✗ This repo has ${keys.length} story maps (${keys.join(", ")}). Say which one to save with --map, for example: nikos serve --map ${keys[0]} --export ${exportTo}`);
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

/** The keys of this repo's story maps, as maps/<key>/ names them. */
const mapKeys = (root: string) => mapDirs(root).map((d) => basename(d)).sort();

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** With several maps and none picked, / lists them, each a link to its own page. */
function mapList(root: string, keys: string[]): string {
  const items = keys.map((k) => `<li><a href="/?map=${encodeURIComponent(k)}">${esc(k)}</a></li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Story maps · ${esc(basename(root))}</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:2rem 1rem;max-width:40rem}</style></head><body><h1>Story maps</h1><p>This repo has ${keys.length} story maps. Pick one:</p><ul>${items}</ul></body></html>`;
}

/** The story map server: the live map at /, read-only. It takes no save and has no other page. */
export function startMapServer(root: string, opts: { port?: number; map?: string } = {}): Promise<RunningServer> {
  return startServer(root, {
    port: opts.port,
    pages: {
      page: (query) => {
        const keys = mapKeys(root);
        const asked = query.get("map") ?? opts.map;
        if (asked === undefined || !keys.includes(asked)) return keys.length > 1 ? mapList(root, keys) : renderMap(root, { live: true });
        // ?map= with no key is the list, even when the server was started on one map.
        return renderMap(root, { live: true, map: asked, ...(keys.length > 1 ? { back: "/?map=" } : {}) });
      },
    },
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
