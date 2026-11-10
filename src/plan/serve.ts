// nikos plan serve: the planning dashboard for the company's planning repo, on 127.0.0.1. Each page shows
// one area (?at=), read from the area's files and the delivery copies. The copies are refreshed on start
// unless --offline, and a refresh that fails is a notice on every page, never a reason not to start.
// The server is planning/server.ts, given these pages.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { startServer, type PageSource, type RunningServer, type SaveTarget } from "../planning/server.js";
import type { Runner } from "../lib/git.js";
import type { Area } from "../planning/model.js";
import { areaPage, drillBet, drillKr, upChain, resolveAt, type AreaPage } from "./dashboard.js";
import { planDeliveries, type PlanDeliveries } from "./delivery.js";
import { keyOf, linksIn, offlineDocument, type OfflinePage } from "./offline.js";
import { renderPlanBody, renderPlanPage, planTitleText, viewOf, type PageState } from "./page.js";
import { areaHolding, findArea, listAreas } from "./repo.js";
import { refreshDelivery } from "./refresh.js";

export interface PlanServeOptions {
  /** The port to listen on. 0, the default, picks a free one. */
  port?: number;
  /** Skip the refresh of the code repos' copies on start. */
  offline?: boolean;
  /** The area the first page shows, named as --in names it (--at is an older alias, not in the help). Unknown names are an error. */
  at?: string;
  /** Runs git for the save buttons. Tests pass a runner that records the calls. */
  run?: Runner;
}

export interface PlanServe {
  srv: RunningServer;
  /** The link to open: the area it starts on, and the token. */
  url: string;
  /** What the pages say before the rest: a refresh that failed. */
  notices: string[];
}

/** A refresh that fails is a notice; the copies already kept still show. Nothing here stops the server. */
function refreshNotices(repo: string, offline = false): string[] {
  if (offline) return [];
  try {
    refreshDelivery(repo);
    return [];
  } catch (err) {
    return [`Couldn't read the code repos (${(err as Error).message.split("\n")[0]}). The page shows the copies kept from the last good read.`];
  }
}

/**
 * The page for a query: the area ?at= names (or the company, with a notice), its view, its widening, and
 * the drill-down ?kr= or ?bet= names. A drill that names nothing is a notice, and the area's view shows.
 */
function pageOf(repo: string, query: URLSearchParams, notices: string[], deliveries: PlanDeliveries = planDeliveries(repo)): { page: AreaPage; state: PageState } {
  const { area, notice } = resolveAt(repo, query.get("at") ?? undefined);
  const view = viewOf(query, area.level);
  const now = new Date();
  const page = areaPage(repo, area, {
    deliveries,
    now,
    notices: [...notices, ...(notice ? [notice] : [])],
    period: query.get("period") ?? undefined,
    widen: view.widen,
  });
  const state: PageState = { view };
  const kr = query.get("kr");
  const bet = query.get("bet");
  if (kr) {
    const drill = drillKr(repo, kr, deliveries, now);
    if (drill) state.drill = { kind: "kr", kr: drill };
    else page.notices.push(`There's no key result called '${kr}'.`);
  } else if (bet) {
    const drill = drillBet(repo, bet, deliveries);
    const up = upChain(repo, bet, deliveries);
    if (drill && up) state.drill = { kind: "bet", bet: drill, up };
    else page.notices.push(`There's no bet called '${bet}'.`);
  }
  return { page, state };
}

/**
 * The folder a change goes in: the area that holds the key result or bet it names. A new key result or bet
 * names its area, and so does a change that names neither. An area that isn't one is refused.
 */
export function saveIn(repo: string, body: Record<string, any>): SaveTarget {
  const target = body.target && typeof body.target === "object" ? body.target : {};
  const op = String(body.op ?? "");
  const creates = op === "kr.new" || op === "bet.new";
  let area: Area;
  if (!creates && typeof target.kr === "string") area = areaHolding(repo, target.kr, "key result");
  else if (!creates && typeof target.bet === "string") area = areaHolding(repo, target.bet, "bet");
  else if (typeof body.area === "string" && body.area) area = findArea(repo, body.area);
  else if (creates) throw new Error(`Say which area the ${op === "kr.new" ? "key result" : "bet"} goes in, e.g. departments/finance`);
  else throw new Error("Say which key result or bet the change is to, or the area it goes in (area, e.g. departments/finance)");
  return { root: area.dir, area: area.rel };
}

/** Start the planning dashboard for a planning repo. It answers until its server is closed. */
export async function startPlanServe(repo: string, opts: PlanServeOptions = {}): Promise<PlanServe> {
  // A name that isn't an area is refused before anything is refreshed or listened on.
  const first = opts.at === undefined ? undefined : findArea(repo, opts.at);
  const notices = refreshNotices(repo, opts.offline);
  const pages: PageSource = {
    page: (query, token) => {
      const { page, state } = pageOf(repo, query, notices);
      return renderPlanPage(page, state, { token });
    },
    data: (query) => {
      const { page, state } = pageOf(repo, query, notices);
      return { ...page, view: state.view, drill: state.drill ?? null };
    },
    saveIn: (body) => saveIn(repo, body),
  };
  const srv = await startServer(repo, { port: opts.port, pages, run: opts.run });
  const url = `http://127.0.0.1:${srv.port}/?${first ? `at=${encodeURIComponent(first.rel)}&` : ""}token=${srv.token}`;
  return { srv, url, notices };
}

/** `nikos plan serve`: run the dashboard until Ctrl+C. */
export async function runPlanServe(repo: string, opts: PlanServeOptions = {}): Promise<number> {
  const plan = await startPlanServe(repo, opts);
  for (const n of plan.notices) console.log(`! ${n}`);
  console.log("The dashboard is running. Open this link in your browser:");
  console.log(`  ${plan.url}`);
  console.log("");
  console.log("The link has a private key in it, so keep it to yourself.");
  console.log("Press Ctrl+C to stop the dashboard.");
  return new Promise<number>((ok) => {
    const stop = () => {
      plan.srv.close().then(() => ok(0));
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

/**
 * `nikos plan serve --export <file>`: the dashboard as one offline file. With --in, the file holds that area's
 * pages only, and links to other areas say they aren't in it. Without --in, it holds every area's pages.
 */
export async function exportPlanPage(repo: string, file: string, opts: { offline?: boolean; at?: string } = {}): Promise<{ wrote: string; notices: string[] }> {
  const at = opts.at === undefined ? undefined : findArea(repo, opts.at).rel;
  const notices = refreshNotices(repo, opts.offline);
  const deliveries = planDeliveries(repo);
  // Each page is built from the links the one before it carries, so every link in the file has its page.
  const seeds = at ? [keyOf({ at })] : [keyOf({ at: "company" }), ...listAreas(repo).map((a) => keyOf({ at: a.rel }))];
  const pages: Record<string, OfflinePage> = {};
  const queue = [...seeds];
  while (queue.length) {
    const key = queue.shift()!;
    if (key in pages) continue;
    const { page, state } = pageOf(repo, new URLSearchParams(key), notices, deliveries);
    if (at && page.plan.rel !== at) continue;
    pages[key] = { title: planTitleText(page), body: renderPlanBody(page, state, { offline: true }) };
    queue.push(...linksIn(pages[key].body));
  }
  // The pages name each code repo they read, so a file that has any is one to share with care.
  const names = deliveries.repos.map((r) => r.repo);
  if (names.length) notices.push(`This page names the code repos ${names.join(", ")}. Share it only with people allowed to see them.`);
  const out = resolve(file);
  writeFileSync(out, offlineDocument(pages, seeds[0]!));
  return { wrote: out, notices };
}
