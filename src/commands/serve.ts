// `nikos serve`: see this code repo's story map in your browser, or save it as one page. The live page can
// edit the map: its saves go on a nikos branch, through the same checks as the command line. A planning repo
// has no story map of its own, so it is sent to nikos plan serve.
import { writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { brand, progressBar, renderMap, storyMapOf } from "./map.js";
import { DESIGN_CSS } from "../lib/design.js";
import { isDone } from "../lib/project.js";
import { THEME_BUTTON, THEME_CSS, THEME_HEAD } from "../lib/theme.js";
import { mapDirs, resolveStoryMap } from "../lib/maps.js";
import type { Runner } from "../lib/git.js";
import { oldLayoutProblem } from "../plan/repo.js";
import { isPlanRepo } from "../planning/model.js";
import { startServer, type RunningServer, type SaveTarget } from "../planning/server.js";

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

/** With several maps and none picked, / lists them: a card for each, with its progress, linking to its own page. */
function mapList(root: string, keys: string[]): string {
  const cards = keys
    .map((k) => {
      const m = storyMapOf(root, k);
      const all = [...m.releases.flatMap((r) => r.stories), ...m.unreleased].filter((s) => s.status !== "cancelled");
      const done = all.filter((s) => isDone(s.status)).length;
      const meta = [m.owner && `Owned by ${esc(m.owner)}`, m.bet && `delivers ${esc(m.bet)}`].filter(Boolean).join(", ");
      return `<li><a class="mapcard" href="/?map=${encodeURIComponent(k)}"><span class="eyebrow">maps/${esc(k)}</span><h2>${esc(m.project || k)}</h2>${meta ? `<span class="muted">${meta}</span>` : ""}${progressBar(all, false)}<span class="num">${done} of ${all.length} stories done · ${m.releases.length} release${m.releases.length === 1 ? "" : "s"}</span></a></li>`;
    })
    .join("");
  const css = `body{margin:0}.wrap{max-width:1100px;margin:0 auto;padding:16px 24px 48px}.bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding-bottom:12px;border-bottom:1px solid var(--line)}.spacer{flex:1}.brand{display:inline-flex;align-items:center;gap:10px;font-family:var(--f-display);font-weight:700;font-size:16px}.brand-mark{width:28px;height:28px;border-radius:8px;background:var(--accent);display:grid;place-items:center}.brand-mark svg{width:18px;height:18px;stroke:var(--accent-fg)}.brand-t small{display:block;font-family:var(--f-mono);font-weight:400;font-size:12px;color:var(--muted)}h1{margin:24px 0 4px;font-size:28px}.maps{list-style:none;margin:20px 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}.mapcard{display:grid;gap:10px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:16px;color:var(--fg);text-decoration:none}.mapcard:hover{border-color:var(--line-strong);box-shadow:var(--shadow)}.mapcard h2{margin:0;font-size:19px}.stack{display:flex;height:10px;border-radius:99px;overflow:hidden;background:var(--surface-2)}.stack i{display:block;height:100%}@media (max-width:767px){.wrap{padding:12px 16px 32px}}${THEME_CSS}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Story maps · ${esc(basename(root))}</title><style>${DESIGN_CSS}\n${css}</style>${THEME_HEAD}</head><body><div class="wrap"><header class="bar">${brand(basename(root))}<span class="spacer"></span>${THEME_BUTTON}</header><main><h1>Story maps</h1><p class="muted">This repo has ${keys.length} story maps. Pick one.</p><ul class="maps">${cards}</ul></main></div></body></html>`;
}

/** The operations a story map's page can make: its stories, their activities, steps and releases, and their criteria and personas. */
const MAP_OPS = /^(story|scenario|persona|activity|step|release)\./;

/**
 * The folder and map a save is for. The map is the one body.map names (or args.map), or the only map when there's
 * one. An op that isn't a change to a story map is refused, so the page can change nothing else.
 */
export function saveMapIn(root: string, body: Record<string, any>): SaveTarget {
  const op = String(body.op ?? "");
  if (!MAP_OPS.test(op)) throw new Error(`${op || "This change"} isn't a change the story map makes`);
  const named = body.map ?? body.args?.map;
  if (named !== undefined && typeof named !== "string") throw new Error("map is the key of the story map to change");
  if (typeof body.map === "string" && typeof body.args?.map === "string" && body.map.toLowerCase() !== body.args.map.toLowerCase()) {
    throw new Error("The change names two story maps. It can change one at a time");
  }
  return { root, area: resolveStoryMap(root, { map: named }).id };
}

/**
 * The story map server: the live map at /. With the page's own saves (on 127.0.0.1, with the token printed at
 * start), it changes the map's files on a nikos branch, and the page commits or pushes only when asked.
 */
export function startMapServer(root: string, opts: { port?: number; map?: string; run?: Runner } = {}): Promise<RunningServer> {
  return startServer(root, {
    port: opts.port,
    run: opts.run,
    pages: {
      kind: "map",
      page: (query, token) => {
        const keys = mapKeys(root);
        const asked = query.get("map") ?? opts.map;
        if (asked === undefined || !keys.includes(asked)) return keys.length > 1 ? mapList(root, keys) : renderMap(root, { live: true, token });
        // ?map= with no key is the list, even when the server was started on one map.
        return renderMap(root, { live: true, map: asked, token, ...(keys.length > 1 ? { back: "/?map=" } : {}) });
      },
      saveIn: (body) => saveMapIn(root, body),
    },
  });
}

/** Serve the story map on 127.0.0.1 until Ctrl+C. The link carries the key the page saves with, so keep it to yourself. */
async function runServe(root: string, opts: { port?: number; map?: string }): Promise<number> {
  const srv = await startMapServer(root, opts);
  console.log("The story map is running. Open this link in your browser:");
  console.log(`  ${srv.url}`);
  console.log("");
  console.log("The link has a private key in it, so keep it to yourself.");
  console.log("Press Ctrl+C to stop.");
  return new Promise<number>((ok) => {
    const stop = () => {
      srv.close().then(() => ok(0));
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
