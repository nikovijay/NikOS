// nikos plan serve: the planning dashboard for the company's planning repo, on 127.0.0.1. Each page shows
// one area (?at=), read from the area's files and the delivery copies. The copies are refreshed on start
// unless --offline, and a refresh that fails is a notice on every page, never a reason not to start.
// The server is the planning dashboard's own (planning/server.ts), given these pages in place of its own.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { startServer, type PageSource, type RunningServer, type SaveTarget } from "../planning/server.js";
import type { Runner } from "../lib/git.js";
import type { Area, AreaLevel } from "../planning/model.js";
import { areaPage, resolveAt, type AreaPage } from "./dashboard.js";
import { planDeliveries, type BetDelivery } from "./delivery.js";
import { areaHolding, findArea } from "./repo.js";
import { refreshDelivery } from "./refresh.js";
import { figuresText, readsText } from "./words.js";

export interface PlanServeOptions {
  /** The port to listen on. 0, the default, picks a free one. */
  port?: number;
  /** Skip the refresh of the code repos' copies on start. */
  offline?: boolean;
  /** The area the first page shows, named as --in names it. Unknown names are an error. */
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

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

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

/** The page's data for ?at=: the named area, or the company with a notice when the name isn't an area. */
function pageOf(repo: string, query: URLSearchParams, notices: string[]): AreaPage {
  const { area, notice } = resolveAt(repo, query.get("at") ?? undefined);
  return areaPage(repo, area, { deliveries: planDeliveries(repo), now: new Date(), notices: [...notices, ...(notice ? [notice] : [])] });
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

const LEVEL_NAME: Record<AreaLevel, string> = { company: "Company", department: "Department", group: "Group", team: "Team" };

/** A bet's delivery in words, as plan status says it: its own figures, or each bet below that has maps. */
function deliveryText(d: BetDelivery | undefined): string {
  if (!d) return "no story map names this bet yet";
  if (d.source === "own" && d.delivery) return `${figuresText(d.delivery)}${readsText(d.reads)}`;
  if (d.source === "via") return `${d.via.map((v) => `via ${v.bet}: ${figuresText(v.delivery)}`).join("; ")}${readsText(d.reads)}`;
  return "no story map names this bet yet";
}

const STYLE = `body{font-family:system-ui,sans-serif;margin:0 auto;max-width:52rem;padding:1rem;line-height:1.5;color-scheme:light dark}
nav a{margin-right:.25rem}.notice{background:#fff4d6;color:#4a3800;padding:.5rem .75rem;border-radius:.4rem}
.id{color:#777;font-family:ui-monospace,monospace;font-size:.85em}h2{margin-top:1.5rem;font-size:1.1rem}`;

/** One area's page: where it sits, its areas below, its key results, its bets and the copies they were read from. */
function pageHtml(page: AreaPage): string {
  const name = page.plan.name;
  const crumbs = page.breadcrumb.map((c) => `<a href="${esc(c.href)}">${esc(c.label)}</a>`).join(" › ");
  const below = page.tree.filter((n) => n.parent === page.plan.rel);
  const subs = below.length
    ? `<h2>Below this</h2><ul>${below.map((n) => `<li><a href="?at=${esc(encodeURIComponent(n.rel))}">${esc(n.name)}</a> <span class="id">${esc(n.rel)}</span></li>`).join("")}</ul>`
    : "";
  const own = page.plan.level === "company" || page.plan.level === "department";
  const krs = page.krs.map((k) => {
    const pct = Number.isFinite(k.progress) ? `${Math.round(k.progress * 100)}%` : "no progress yet";
    const last = k.latest ? `last ${k.latest.value} on ${k.latest.date}` : "no check-ins";
    return `<li>${esc(k.title)} <span class="id">${esc(k.id)}</span>: ${pct} toward ${k.target}${k.unit ? ` ${esc(k.unit)}` : ""}, ${last}${k.stale ? " · stale" : ""}</li>`;
  });
  const bets = page.bets.map(
    (b) =>
      `<li><strong>${esc(b.id)}</strong> — ${esc(b.outcome)}${b.owner ? `. Owner: ${esc(b.owner)}` : ""}. Delivery: ${esc(deliveryText(b.delivery))}${
        b.aligns_to.length ? `. Aligns to ${b.aligns_to.map((a) => esc(a.id)).join(", ")}` : ""
      }</li>`,
  );
  const reads = page.repos.map((r) => `<li>${esc(r.repo)}: ${esc(r.age)}</li>`);
  const list = (items: string[]) => (items.length ? `<ul>${items.join("")}</ul>` : "<p>None yet.</p>");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)} · nikOS plan</title><style>${STYLE}</style></head>
<body>
<nav>${crumbs}</nav>
<h1>${esc(name)} <span class="id">${esc(LEVEL_NAME[page.plan.level])}${page.period ? ` · ${esc(page.period)}` : page.plan.period ? ` · ${esc(page.plan.period)}` : ""}</span></h1>
${page.notices.map((n) => `<p class="notice">${esc(n)}</p>`).join("")}
${subs}
<h2>${own ? "Key results" : "Key results its bets aim at"}</h2>
${list(krs)}
<h2>Bets</h2>
${list(bets)}
<h2>Code repos read</h2>
${list(reads)}
${page.warnings.length ? `<h2>Warnings</h2>${list(page.warnings.map((w) => esc(w.message)))}` : ""}
${page.problems.length ? `<h2>Files that won't load</h2>${list(page.problems.map((p) => esc(p)))}` : ""}
</body></html>
`;
}

/** Start the planning dashboard for a planning repo. It answers until its server is closed. */
export async function startPlanServe(repo: string, opts: PlanServeOptions = {}): Promise<PlanServe> {
  // A name that isn't an area is refused before anything is refreshed or listened on.
  const first = opts.at === undefined ? undefined : findArea(repo, opts.at);
  const notices = refreshNotices(repo, opts.offline);
  const pages: PageSource = {
    page: (query) => pageHtml(pageOf(repo, query, notices)),
    data: (query) => pageOf(repo, query, notices),
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

/** `nikos plan serve --export <file>`: one area's page as a file, the area --at names or else the company. */
export async function exportPlanPage(repo: string, file: string, opts: { offline?: boolean; at?: string } = {}): Promise<{ wrote: string; notices: string[] }> {
  const at = opts.at === undefined ? undefined : findArea(repo, opts.at).rel;
  const notices = refreshNotices(repo, opts.offline);
  const out = resolve(file);
  writeFileSync(out, pageHtml(pageOf(repo, new URLSearchParams(at ? { at } : {}), notices)));
  return { wrote: out, notices };
}
