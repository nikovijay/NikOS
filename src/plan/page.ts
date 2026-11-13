// The planning dashboard's page for nikos plan serve: one area's pages (Key results, OKRs and bets, the
// ladder, Bets, Timeline) and the drill-downs from a key result or bet. The HTML is built here from the
// AreaPage that dashboard.ts reads. Every link is a plain ?at= URL that carries the quarter shown, so the
// place is in the URL. The live page adds forms (add and edit key results and bets, check-ins, a pending bar),
// which post to /api/op and the git buttons with the server's token. The offline export has none of them.
import type { AreaLevel } from "../planning/model.js";
import { THEME_BUTTON, THEME_CSS, THEME_HEAD } from "../lib/theme.js";
import { SAVE_BAR_CSS, saveBarScript } from "../lib/save-bar.js";
import { DESIGN_CSS } from "../lib/design.js";
import { idFromTitle } from "../planning/rules.js";
import type { BetDelivery } from "./delivery.js";
import type { AreaPage, BelowBet, BetRef, Choice, DashBet, DashKr, DrillBet, DrillMap, KrDrill, KrRef, UpChain, BetDrill } from "./dashboard.js";
import { figuresText, readsText, repoLabel } from "./words.js";

export type ViewName = "keys" | "okrs" | "ladder" | "bets" | "timeline";

/** The view a page shows, and what the ladder widens to. more lifts the ladder's cap of rows per column. */
export interface PlanView {
  view: ViewName;
  widen: { up: boolean; down: boolean };
  more: boolean;
}

/** A drill-down page: a key result's bets and maps, or a bet's chain up, the bets below it and its maps. */
export type Drill = { kind: "kr"; kr: KrDrill } | { kind: "bet"; bet: BetDrill; up: UpChain };

export interface PageState {
  view: PlanView;
  drill?: Drill;
}

/** How the page is rendered. The live page has forms; the offline export has none. */
export interface PlanRenderOptions {
  live?: boolean;
}

const VIEW_LABEL: Record<ViewName, string> = { keys: "Key results", okrs: "OKRs and bets", ladder: "Ladder", bets: "Bets", timeline: "Timeline" };
const LEVEL_LABEL: Record<AreaLevel, string> = { company: "Company", department: "Department", group: "Group", team: "Team" };
const ALTITUDE_LABEL: Record<AreaLevel, string> = { company: "Company", department: "Departments", group: "Groups", team: "Teams" };
const ALTITUDES: AreaLevel[] = ["company", "department", "group", "team"];

/** The views an area has: key results only for the company and departments, which own the key results. */
export function viewsFor(level: AreaLevel): ViewName[] {
  return level === "company" || level === "department" ? ["keys", "okrs", "ladder", "bets", "timeline"] : ["okrs", "ladder", "bets", "timeline"];
}

/** What the query asks for. An unknown view is the OKRs and bets page; keys is refused for a group or team. */
export function viewOf(query: URLSearchParams, level: AreaLevel): PlanView {
  const asked = query.get("view") ?? "";
  const widen = query.get("widen") ?? "";
  const view = (viewsFor(level) as string[]).includes(asked) ? (asked as ViewName) : "okrs";
  return { view, widen: { up: widen === "up" || widen === "all", down: widen === "down" || widen === "all" }, more: query.get("more") === "all" };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A link to this dashboard's query: the empty values are left out, so ?at=company is the company's page. */
export function hrefOf(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  return `?${q.toString()}`;
}

/** Progress as a share. Below 0 the figure has moved the wrong way, so the words say so rather than a minus sign. */
const pct = (p: number) => (!Number.isFinite(p) ? "no progress yet" : p < 0 ? "moved the wrong way" : `${Math.round(p * 100)}%`);
const checkinOf = (k: KrRef) => (k.latest ? `last ${k.latest.value} on ${k.latest.date}` : "no check-ins");
/** A milestone's steps done, as "2 of 5 steps done", and the names still to do. */
const stepsOf = (k: KrRef) => `${k.steps.filter((s) => s.done).length} of ${k.steps.length} steps done`;
const stepsLeft = (k: KrRef) => k.steps.filter((s) => !s.done).map((s) => s.name).join(", ");
/** A key result's progress as the page says it: a share, or for a milestone its steps. */
const shareOf = (k: KrRef) => (k.kind === "milestone" ? stepsOf(k) : pct(k.progress));
const krMeta = (k: DashKr) =>
  k.kind === "milestone"
    ? `${stepsOf(k)}${stepsLeft(k) ? `. To do: ${stepsLeft(k)}` : ""}${k.stale ? " · stale" : ""}`
    : `${pct(k.progress)} toward ${k.target}${k.unit ? ` ${k.unit}` : ""}${k.direction === "down" ? " (should go down)" : ""}, ${checkinOf(k)}${k.stale ? " · stale" : ""}`;

/** A bet's delivery in words, as plan status says it: its own figures, or each bet below that has maps. */
export function deliveryText(d: BetDelivery | undefined): string {
  if (!d) return "no story map yet";
  if (d.source === "own" && d.delivery) return `${figuresText(d.delivery)}${readsText(d.reads)}`;
  if (d.source === "via") return `${d.via.map((v) => `via ${v.bet}: ${figuresText(v.delivery)}`).join("; ")}${readsText(d.reads)}`;
  return "no story map yet";
}

/** A department's key result is for a quarter, so its progress is this period's. A company's is for the year: toward its target. */
const quarterly = (k: KrRef) => !!k.period && /-Q[1-4]$/.test(k.period);

/** The ladder's short word for a bet's delivery: its own, delivered through the bets below, or none yet. */
function deliveredBy(d: BetDelivery | undefined): string {
  if (d?.source === "own") return "Own bet";
  if (d?.source === "via") return `Delivered via ${d.via.map((v) => v.bet).join(", ")}`;
  return "Own bet · no story map yet";
}

/** How a bet aims at a key result, as a phrase: "Aims at close-days", or "Through a bet below close-days" for a bet below one that does. */
const aimText = (how: "primary" | "also" | "via", of: string) => (how === "primary" ? `Aims at ${of}` : how === "also" ? `Also aims at ${of}` : `Through a bet below ${of}`);
// The age already says "read …", and a map's title is often just its key, so neither is repeated.
const mapText = (m: DrillMap) =>
  `${repoLabel(m)} · ${m.key}${m.owner ? ` · owner ${m.owner}` : ""}${m.title && m.title.toLowerCase() !== m.key.toLowerCase() ? ` · ${m.title}` : ""} · ${m.age}`;

// Every link carries the quarter the page shows, so a chosen quarter survives a click. The company has none: its key results are for the year.
const periodFor = (rel: string, period?: string) => (rel === "company" ? undefined : period);
const betHref = (rel: string, id: string, period?: string) => hrefOf({ at: rel, bet: id, period: periodFor(rel, period) });
const krHref = (rel: string, id: string, period?: string) => hrefOf({ at: rel, kr: id, period: periodFor(rel, period) });
/** A bet's name on the page: its title, or its id when it has none. */
const betName = (b: { id: string; title?: string }) => b.title || b.id;
/** The bet's id, after its title and in a muted span. Nothing when it has no title, since the name is the id then. */
const betId = (b: { id: string; title?: string }) => (b.title ? ` <span class="id">${esc(b.id)}</span>` : "");
const betLink = (b: { rel: string; id: string; title?: string }, period?: string) => `<a href="${esc(betHref(b.rel, b.id, period))}">${esc(betName(b))}</a>`;
/** An area's name on the page. The rel is never shown. */
const areaName = (page: AreaPage, rel: string) => page.names[rel] ?? rel;
/** The name a key result or bet has in a choice list: its title, else the id it is given by. */
function labelOf(page: AreaPage, id: string): string {
  return page.choices.aimKrs.find((c) => c.value === id)?.label ?? page.choices.alignBets.find((c) => c.value === id)?.label ?? id;
}

/** A bet's delivery as a pill: Shipped, Building or Not started from its own maps, through the bets below, or none yet. */
export function deliveryPill(d: BetDelivery | undefined): string {
  if (d?.source === "own" && d.delivery) {
    const st = d.delivery.status;
    return `<span class="pill ${st === "Shipped" ? "s-good" : st === "Building" ? "s-accent" : "s-idle"}">${esc(st)}</span>`;
  }
  if (d?.source === "via") return `<span class="pill s-accent">Through the bets below</span>`;
  return `<span class="pill s-idle">No story map yet</span>`;
}

/** A bet's outcome as an outlined pill, apart from its delivery: shipped is not won. */
export function outcomePill(outcome: string): string {
  const cls = outcome === "open" ? "o-open" : outcome === "won" ? "o-won" : outcome === "lost" ? "o-lost" : outcome === "stopped" ? "o-stopped" : "o-other";
  const word = outcome ? outcome.charAt(0).toUpperCase() + outcome.slice(1) : "Open";
  return `<span class="o-pill ${cls}" title="Outcome, called at review from key result evidence">${esc(word)}</span>`;
}

/** A bet's line in a list: its name linked to its drill-down, its delivery and outcome, then its owner and delivery in words. from names the area it's in, when it isn't this one. */
function betLine(b: BetRef | DashBet, page: AreaPage, from?: string): string {
  const owner = b.owner ? `Owner: ${esc(b.owner)}. ` : "";
  const where = from ? ` <span class="where">${esc(from)}</span>` : "";
  return `<li>${betLink(b, page.period)}${betId(b)}${where} ${deliveryPill(b.delivery)} ${outcomePill(b.outcome)}<span class="said">${owner}Delivery: ${esc(deliveryText(b.delivery))}</span></li>`;
}

const DAY = 864e5;
const dayOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const shortDate = (iso: string) => {
  const d = new Date(dayOf(iso));
  return Number.isNaN(d.getTime()) ? iso : `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/** Where a key result's period starts: its quarter's first day, else the first day of the year it is due in. */
function periodStart(k: KrRef): string | undefined {
  const q = /^(\d{4})-Q([1-4])$/.exec(k.period ?? "");
  if (q) return `${q[1]}-${String((Number(q[2]) - 1) * 3 + 1).padStart(2, "0")}-01`;
  const y = /^(\d{4})/.exec(k.by);
  return y ? `${y[1]}-01-01` : undefined;
}

/** How far through its period a key result is on a day, 0 to 1, or undefined when its dates don't say. */
function paceOf(k: KrRef, today: string): number | undefined {
  const start = periodStart(k);
  if (!start || !k.by) return undefined;
  const span = dayOf(k.by) - dayOf(start);
  if (!(span > 0)) return undefined;
  return Math.max(0, Math.min(1, (dayOf(today) - dayOf(start)) / span));
}

/** On track, at risk or off track, from progress against how much of the period has gone. None until it has a check-in or a step done. */
function krStatus(k: KrRef, today: string): { label: string; cls: string; tone: string } | undefined {
  const started = k.kind === "milestone" ? k.steps.some((s) => s.done) : !!k.latest;
  const pace = paceOf(k, today);
  if (!started || pace === undefined || !Number.isFinite(k.progress)) return undefined;
  const gap = pace - Math.max(0, k.progress);
  if (gap <= 0.1) return { label: "On track", cls: "s-good", tone: "good" };
  if (gap <= 0.25) return { label: "At risk", cls: "s-warn", tone: "warn" };
  return { label: "Off track", cls: "s-bad", tone: "bad" };
}

const statusPill = (k: KrRef, today: string) => {
  const st = krStatus(k, today);
  return st ? `<span class="pill ${st.cls}">${st.label}</span>` : `<span class="pill s-idle">${k.kind === "milestone" ? "No steps done yet" : "No check-ins yet"}</span>`;
};

/** The progress bar, with a tick for how far through the period it is. */
function krBar(k: KrRef, today: string): string {
  const p = Number.isFinite(k.progress) ? Math.max(0, Math.min(1, k.progress)) : 0;
  const pace = paceOf(k, today);
  const tone = krStatus(k, today)?.tone ?? "";
  const label = `${Math.round(p * 100)}% of the way${pace === undefined ? "" : `; ${Math.round(pace * 100)}% of the period has gone`}`;
  return `<div class="bar ${tone}" role="img" aria-label="${esc(label)}"><i style="width:${(p * 100).toFixed(1)}%"></i>${pace === undefined ? "" : `<span class="pace" style="left:${(pace * 100).toFixed(1)}%"></span>`}</div>`;
}

/** A small chart of a key result's check-ins from its baseline, with its target as a dashed line. */
function sparkOf(k: DashKr): string {
  const pts = [...(k.checkins ?? [])];
  const start = periodStart(k);
  if (!pts.length || !start || !k.by) return "";
  const values = [k.baseline, k.target, ...pts.map((c) => c.value)];
  const lo = Math.min(...values), hi = Math.max(...values), span = dayOf(k.by) - dayOf(start);
  if (!(span > 0)) return "";
  const X = (d: string) => 2 + (92 * Math.max(0, Math.min(1, (dayOf(d) - dayOf(start)) / span)));
  const Y = (v: number) => 25 - (22 * (v - lo)) / (hi - lo || 1);
  const line = [`${X(start).toFixed(1)},${Y(k.baseline).toFixed(1)}`, ...pts.map((c) => `${X(c.date).toFixed(1)},${Y(c.value).toFixed(1)}`)].join(" ");
  const last = pts[pts.length - 1]!;
  return `<svg class="spark" viewBox="0 0 96 28" aria-hidden="true"><line x1="2" x2="94" y1="${Y(k.target).toFixed(1)}" y2="${Y(k.target).toFixed(1)}" stroke="var(--good)" stroke-dasharray="3 3" stroke-width="1"/><polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="1.8"/><circle cx="${X(last.date).toFixed(1)}" cy="${Y(last.value).toFixed(1)}" r="2.6" fill="var(--accent)"/></svg>`;
}

/** A figure with its unit: "68.4 %", "31 s". */
const withUnit = (v: number, unit: string) => `${v}${unit ? (unit === "%" ? "%" : ` ${unit}`) : ""}`;

/** The dashboard's own parts, on the shared design: the shell, the cards, the ladder, the timeline and the forms. */
const PAGE_CSS = `[hidden]{display:none!important}
body{margin:0}
.app{display:grid;grid-template-columns:220px minmax(0,1fr);gap:32px;max-width:1440px;margin:0 auto;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:0 48px}
.side{position:sticky;top:0;align-self:start;max-height:100vh;overflow-y:auto;display:flex;flex-direction:column;gap:18px;padding-block:22px 18px;min-width:0}
.brand{display:flex;align-items:center;gap:10px;font-family:var(--f-display);font-weight:700;font-size:1.1rem;color:var(--fg);text-decoration:none}
.brand-mark{width:28px;height:28px;border-radius:8px;background:var(--accent);display:grid;place-items:center;flex:none}
.brand-mark svg{width:18px;height:18px}
.brand small{display:block;font-family:var(--f-body);font-weight:500;font-size:.75rem;color:var(--muted);line-height:1.2}
.views{display:flex;flex-direction:column;gap:2px}
.views a{display:block;padding:7px 10px;border-radius:8px;color:var(--fg);text-decoration:none;font-weight:500;font-size:.93rem}
.views a:hover{background:var(--surface-2)}
.views a[aria-current="page"]{background:var(--accent-weak);color:var(--accent)}
.side-areas{display:grid;gap:2px;border-top:1px solid var(--line);padding-top:12px}
.side-areas a{font-size:.88rem;color:var(--muted);text-decoration:none;padding:4px 10px;border-radius:6px}
.side-areas a:hover{color:var(--fg);background:var(--surface-2)}
.main{min-width:0;padding-top:16px}
.top{display:grid;gap:10px;padding-block:4px 12px;border-bottom:1px solid var(--line)}
.top-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px}
.top-right{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-left:auto}
.altitudes{display:inline-flex;flex-wrap:wrap;background:var(--surface-2);border-radius:10px;padding:3px;gap:2px}
.altitudes a,.altitudes span{padding:6px 12px;border-radius:8px;font-weight:500;font-size:.9rem;color:var(--muted);text-decoration:none}
.altitudes a:hover{color:var(--fg)}
.altitudes a.on{background:var(--surface);color:var(--fg);box-shadow:var(--shadow)}
.altitudes span{font-size:.82rem}
.picker label{display:flex;align-items:center;gap:8px;font-size:.72rem;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);font-weight:600}
.picker select{text-transform:none;letter-spacing:0;font-size:.92rem;color:var(--fg);background:var(--surface);border:1px solid var(--line-strong);border-radius:8px;padding:6px 10px;font-weight:500;max-width:100%}
.share-btn{border:1px solid var(--line);background:var(--surface);border-radius:8px;padding:5px 10px;font-size:.85rem;cursor:pointer}
.share-btn:hover,.theme-toggle:hover{border-color:var(--line-strong)}
.crumbs{display:flex;flex-wrap:wrap;gap:4px;font-size:.88rem;color:var(--muted)}
.crumbs a{color:var(--muted);text-decoration:none;padding:1px 4px;border-radius:4px}
.crumbs a:hover{color:var(--fg);background:var(--surface-2)}
.crumbs a:last-child{color:var(--fg);font-weight:600}
.page-head{display:grid;gap:6px;padding-top:22px;max-width:72ch}
h1{font-size:1.9rem;line-height:1.15;margin:0}
h1 .id{font-family:var(--f-body);font-size:.5em;font-weight:500;letter-spacing:0;vertical-align:middle}
h2{font-size:1.2rem;line-height:1.3;margin:28px 0 12px}
h3{font-size:1rem;margin:18px 0 8px}
h4{font-size:.8rem;margin:4px 0 8px;font-family:var(--f-body);text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.quarters{margin:4px 0 0;color:var(--muted);font-size:.9rem}
.quarters .on{color:var(--fg);font-weight:600}
.notice{background:var(--notice);color:var(--notice-fg);padding:10px 14px;border-radius:var(--r);font-size:.9rem;margin:12px 0 0}
.id{color:var(--muted);font-family:var(--f-mono);font-size:.8em}
.where{display:inline-block;font-size:.72rem;font-weight:600;color:var(--muted);background:var(--surface-2);border-radius:4px;padding:0 6px;line-height:1.7}
.meta{color:var(--muted);margin:4px 0;font-size:.9rem}
ul{padding-left:1.2rem}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:14px 16px;margin:12px 0}
.strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:var(--r);overflow:hidden;margin:18px 0}
.strip>div{background:var(--surface);padding:12px 16px;display:grid;gap:4px}
.strip .big{font-family:var(--f-display);font-size:1.5rem;font-weight:700;line-height:1}
.strip .parts{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:.82rem;color:var(--muted)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px}
.kr-card{display:grid;gap:10px;align-content:start;margin:0;min-width:0}
.kr-card .head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.kr-card .head a{font-weight:600;color:var(--fg);text-decoration:none}
.kr-card .head a:hover{text-decoration:underline}
.figure{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.figure .now{font-family:var(--f-display);font-size:1.6rem;font-weight:700;line-height:1}
.figure .of{color:var(--muted);font-size:.85rem}
.bar{position:relative;height:8px;border-radius:99px;background:var(--surface-2)}
.bar>i{position:absolute;inset:0 auto 0 0;border-radius:99px;background:var(--accent)}
.bar.good>i{background:var(--good)}.bar.warn>i{background:var(--warn)}.bar.bad>i{background:var(--bad)}
.bar .pace{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--fg);opacity:.55;border-radius:2px}
.card-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;font-size:.8rem;color:var(--muted)}
.spark{display:block;width:96px;height:28px}
.okr{padding:0;overflow:hidden}
.okr-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px 16px;padding:14px 16px;border-bottom:1px solid var(--line)}
.okr-head>div{min-width:0}
.okr-head a{font-weight:600}
.okr-body{padding:6px 16px 12px}
.okr-body>ul,.rows{list-style:none;padding:0;margin:6px 0;display:grid;gap:2px}
.rows>li{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:8px 10px;border-radius:8px}
.rows>li:hover{background:var(--surface-2)}
.rows .said{flex-basis:100%;font-size:.84rem;color:var(--muted)}
.o-pill{display:inline-flex;align-items:center;font-size:.75rem;font-weight:600;border-radius:99px;padding:0 9px;line-height:1.7;border:1.5px solid currentColor;white-space:nowrap}
.o-open{color:var(--muted)}.o-won{color:var(--good)}.o-lost{color:var(--bad)}.o-stopped{color:var(--idle);border-style:dashed}.o-other{color:var(--warn)}
.bet-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
.bet-card{margin:0;display:grid;gap:10px;align-content:start;min-width:0}
.bet-card h3{margin:0;font-size:1.02rem}
.bet-card .belief{border-left:3px solid var(--accent);padding:2px 0 2px 12px;color:var(--muted);font-size:.92rem;margin:0}
.bet-card .row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.kv{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;font-size:.86rem;margin:0}
.kv dt{color:var(--muted)}.kv dd{margin:0;min-width:0}
.stack{display:flex;height:8px;border-radius:99px;overflow:hidden;background:var(--surface-2)}
.stack i{display:block;height:100%}
.stack .d{background:var(--good)}.stack .b{background:var(--accent)}
.ladder-scroll{overflow-x:auto;padding:12px;border:1px solid var(--line);border-radius:var(--r);background:var(--surface)}
.ladder{position:relative}
.ladder svg{position:absolute;left:0;top:0;pointer-events:none;color:var(--wire)}
.ladder path{fill:none;stroke:currentColor;stroke-width:1.6}
.colhead{position:absolute;top:0;font-size:.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:.09em;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.grouphead{position:absolute;font-size:.78rem;color:var(--muted);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cell{position:absolute;border-radius:8px;padding:7px 10px;overflow:hidden;border:1px solid var(--line);background:var(--surface)}
.cell .t{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;font-size:.86rem;color:var(--fg);text-decoration:none}
.cell .t:hover{text-decoration:underline}
.cell .m{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.75rem;color:var(--muted)}
.cell.kr,.cell.bet{border-color:var(--accent);box-shadow:inset 3px 0 0 var(--accent)}
.cell.above-kr,.cell.above-bet{background:var(--surface-2)}
.more{position:absolute;font-size:.85rem;color:var(--muted)}
.widen{display:flex;flex-wrap:wrap;gap:8px 18px;margin:8px 0 12px}
.tl{border:1px solid var(--line);border-radius:var(--r);background:var(--surface);overflow:hidden}
.tl-row{display:grid;grid-template-columns:minmax(160px,250px) minmax(0,1fr);border-top:1px solid var(--line);align-items:center}
.tl-row:first-child{border-top:0}
.tl-label{padding:8px 14px;display:grid;gap:2px;min-width:0;font-size:.86rem}
.tl-label a{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tl-label .meta{margin:0;font-size:.76rem}
.tl-track{position:relative;height:40px;border-left:1px solid var(--line)}
.tl-head .tl-track{height:28px}
.tl-month{position:absolute;top:0;bottom:0;border-left:1px dashed var(--line);font-size:.7rem;color:var(--muted);padding:5px 0 0 4px;white-space:nowrap}
.tl-bar{position:absolute;top:13px;height:14px;border-radius:5px;background:var(--accent-weak);border:1.5px solid var(--accent)}
.tl-mark{position:absolute;top:13px;width:12px;height:12px;transform:translateX(-50%) rotate(45deg);background:var(--surface);border:2px solid var(--fg);border-radius:2px}
.tl-mark.due{border-color:var(--good)}
.tl-today{position:absolute;top:0;bottom:0;width:2px;background:var(--bad);opacity:.7}
.tl-group{padding:7px 14px;background:var(--surface-2);font-size:.72rem;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);font-weight:600;border-top:1px solid var(--line)}
.tl-legend{display:flex;flex-wrap:wrap;gap:16px;font-size:.8rem;color:var(--muted);margin:8px 0}
table{border-collapse:collapse;width:100%;font-size:.9rem}
th,td{text-align:left;border-top:1px solid var(--line);padding:9px 12px;vertical-align:top}
thead th{border-top:0;font-size:.72rem;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);background:var(--surface-2)}
.tbl{overflow-x:auto;border:1px solid var(--line);border-radius:var(--r);background:var(--surface)}
.empty{border:1.5px dashed var(--line-strong);border-radius:var(--r);padding:22px;margin:12px 0;display:grid;gap:8px;max-width:640px}
.empty p{margin:0}
.unlinked{border:1.5px dashed var(--line-strong);border-radius:var(--r);padding:14px 16px}
.unlinked ul{margin:8px 0 0}
.drill{display:grid;gap:4px}
.drill>h2:first-child{font-size:1.5rem;margin-top:22px}
.serve-hint{font-size:.84rem;color:var(--muted)}
.primary{font:inherit;font-weight:600;padding:6px 14px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:var(--accent-fg);cursor:pointer}
details.add{padding:0}
details.add>summary{padding:12px 16px;cursor:pointer;color:var(--accent);font-weight:600}
details.add[open]>summary{border-bottom:1px solid var(--line)}
details.add>form{padding:4px 16px 14px}
details.edit{margin:10px 0 0;border-top:1px dashed var(--line);padding-top:8px}
details.edit>summary,details.form-more>summary{cursor:pointer;color:var(--accent);font-weight:600;font-size:.9rem}
.sub{margin:10px 0;background:var(--surface-2);border-radius:var(--r);padding:12px 14px}
form.form{margin:8px 0}
form.form .fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px;align-items:start}
form.form .form-more{grid-column:1/-1}
form.form .form-more .fields{margin-top:8px}
.field{display:flex;flex-direction:column;gap:4px;font-size:.84rem;font-weight:600;min-width:0}
.field.wide{grid-column:1/-1}
.field .hint{color:var(--muted);font-size:.8rem;font-weight:400}
.field input,.field select,.field textarea,.save input,.save select{font:inherit;font-weight:400;width:100%;padding:7px 9px;border:1px solid var(--line-strong);border-radius:7px;background:var(--surface);color:var(--fg)}
.field textarea{resize:vertical;min-height:4.5rem}
.field select[multiple]{min-height:7rem}
form.form .actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:10px}
form.form .actions button,.save:not(.form) button{font:inherit;font-weight:600;padding:6px 14px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:var(--accent-fg);cursor:pointer}
.save:not(.form){display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin:4px 0}
.save:not(.form) label{display:grid;gap:3px;font-size:.78rem;font-weight:600;color:var(--muted)}
.save:not(.form) input,.save:not(.form) select{width:auto;max-width:11rem;padding:5px 8px}
.save-msg{color:var(--muted);font-size:.85rem}
.save-msg.error{color:var(--bad)}
button:disabled{opacity:.55;cursor:default}
dialog.sheet-dialog .box{padding:20px;display:grid;gap:12px}
dialog.sheet-dialog h2{margin:0}
.opt{border:1px solid var(--line);border-radius:var(--r);background:var(--surface);padding:12px 14px;display:grid;gap:6px}
.opt h3{margin:0;font-family:var(--f-body);font-size:.95rem}
.opt p{margin:0;font-size:.88rem;color:var(--muted)}
.opt code{display:block;background:var(--surface-2);border-radius:6px;padding:7px 10px;overflow-x:auto;white-space:pre-wrap;word-break:break-word}
@media (max-width:860px){
.app{grid-template-columns:minmax(0,1fr);gap:0}
.side{position:static;max-height:none;padding-block:14px 0;gap:10px}
.views{flex-direction:row;overflow-x:auto;gap:4px;padding-bottom:6px;scrollbar-width:none}
.views a{white-space:nowrap;flex:none}
.side-areas{display:none}
.top-right{margin-left:0}
.altitudes{flex-wrap:nowrap}
.altitudes a,.altitudes span{padding:6px 8px;font-size:.84rem}
h1{font-size:1.55rem}
form.form .fields{grid-template-columns:minmax(0,1fr)}
.tl-row{grid-template-columns:minmax(0,1fr)}
.tl-track{border-left:0;border-top:1px dashed var(--line)}
.tl-head .tl-label{display:none}
}`;

/** The dashboard's whole style: the shared design, the save bar, the light/dark switch, then its own parts. */
export const STYLE = `${THEME_CSS}
${DESIGN_CSS}
${SAVE_BAR_CSS}
${PAGE_CSS}`;

/** The altitude switcher: each level's page is the one above this area, or the first area at that level. */
function altitudes(page: AreaPage): string {
  const node = page.tree.find((n) => n.rel === page.plan.rel);
  const onPath = node ? node.path.map((r) => page.tree.find((x) => x.rel === r)!) : [];
  return ALTITUDES.map((level) => {
    const at = onPath.find((n) => n.level === level) ?? page.tree.find((n) => n.level === level);
    if (!at) return `<span>${esc(ALTITUDE_LABEL[level])}: none yet</span>`;
    const current = level === page.plan.level ? ' class="on" aria-current="page"' : "";
    return `<a href="${esc(hrefOf({ at: at.rel, period: periodFor(at.rel, page.period) }))}"${current}>${esc(ALTITUDE_LABEL[level])}</a>`;
  }).join("");
}

/**
 * The area picker for the chosen altitude: choosing an area goes to its page. The offline export has no
 * script of its own here: its page moves the picker to the next page itself.
 */
function picker(page: AreaPage, offline: boolean): string {
  const options = page.tree
    .filter((n) => n.level === page.plan.level)
    .map((n) => `<option value="${esc(hrefOf({ at: n.rel, period: periodFor(n.rel, page.period) }))}"${n.rel === page.plan.rel ? " selected" : ""}>${esc(n.level === "team" ? `${n.name} (${n.id})` : n.name)}</option>`)
    .join("");
  const onchange = offline ? "" : ' onchange="location.href=this.value"';
  return `<label>${esc(LEVEL_LABEL[page.plan.level])} <select${onchange}>${options}</select></label>`;
}

/** The breadcrumb: Company, then each area above this one. Each part links to its area. */
function crumbs(page: AreaPage): string {
  return page.breadcrumb.map((c) => `<a href="${esc(hrefOf({ at: c.rel, period: periodFor(c.rel, page.period) }))}">${esc(c.label)}</a>`).join(" › ");
}

/** The quarters with key results, each a link, with the one shown marked. Not for the company, whose key results are for the year. */
function quarters(page: AreaPage, state: PageState): string {
  if (page.plan.level !== "department" || !page.periods.length) return "";
  const widen = widenParam(state.view.widen);
  const links = page.periods.map((q) =>
    q === page.period ? `<span class="on" aria-current="true">${esc(q)}</span>` : `<a href="${esc(hrefOf({ at: page.plan.rel, view: state.view.view, period: q, widen }))}">${esc(q)}</a>`,
  );
  return `<p class="quarters">Quarter: ${links.join(" · ")}</p>`;
}

/** The form that checks a key result in: the new value and its date, today unless one is given. It saves on the area's nikos branch. Live page only. */
function checkinForm(k: KrRef, live: boolean): string {
  if (!live) return "";
  if (k.kind === "milestone") {
    // A step is marked once, and its date is today unless one is given. A milestone with every step done has no form.
    const todo = k.steps.filter((s) => !s.done);
    if (!todo.length) return "";
    const options = todo.map((s) => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join("");
    return `<form class="save" data-op="kr.step" data-area="${esc(k.rel)}" data-target="${esc(JSON.stringify({ kr: k.id }))}" data-expect="${esc(k.version)}"><label>Step <select name="name" required>${options}</select></label><label>Done on <input name="date" type="date"></label><button type="submit">Mark step done</button><span class="save-msg" role="status"></span></form>`;
  }
  return `<form class="save" data-op="checkin" data-area="${esc(k.rel)}" data-target="${esc(JSON.stringify({ kr: k.id }))}" data-expect="${esc(k.version)}"><label>New value <input name="value" type="number" step="any" required></label><label>On <input name="date" type="date"></label><button type="submit">Check in</button><span class="save-msg" role="status"></span></form>`;
}

/* The forms. One field helper and one form helper build every form on the live page, so each one reads the same
   way: a visible label, the op's own names, and the four attributes the live script posts with. */

/** One option of a select: its value and what the person reads. */
type Opt = { value: string; label: string };

/** One input of a form. name is the argument the op reads, or with target set the key of the op's target. */
interface Field {
  name: string;
  label: string;
  /** Text by default. lines is a textarea whose lines are read as a list. */
  kind?: "text" | "number" | "date" | "textarea" | "lines";
  /** Set, the field is a select. blank, when given, is its first option, with that text. */
  options?: Opt[];
  blank?: string;
  multiple?: boolean;
  value?: string | number | string[];
  required?: boolean;
  placeholder?: string;
  hint?: string;
  /** The field is part of the op's target, not its arguments. */
  target?: boolean;
  /** The id box: it follows the id made from the field named here, until someone types in it. */
  idFrom?: string;
  /** The datalist of suggestions it offers. */
  list?: string;
  /** Shown only while the field named here has the value given. */
  when?: { name: string; value: string };
  wide?: boolean;
}

interface FormSpec {
  op: string;
  area: string;
  target?: Record<string, string>;
  /** The version the page read, for an edit: the save is refused if the file changed since. New things carry none. */
  expect?: string;
  fields: Field[];
  /** Fields in a closed "More" section: the id, and the rest a person seldom needs. */
  more?: Field[];
  submit: string;
  note?: string;
}

const UP_DOWN: Opt[] = [
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
];
const CONFIDENCE: Opt[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];
const DECISIONS: Opt[] = [
  { value: "continue", label: "Continue" },
  { value: "change", label: "Change" },
  { value: "stop", label: "Stop" },
  { value: "complete", label: "Complete" },
];
const OUTCOMES: Opt[] = [
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];
const KIND: Opt[] = [
  { value: "number", label: "A number to move" },
  { value: "milestone", label: "A list of steps" },
];

const KR_BODY = "A key result is a number to move, from where it starts to a target.";
const KR_COMMAND = 'nikos plan kr new --title "..."';
const BET_BODY = "A bet says what you believe will move a key result, and why. It has a review date, not a deadline.";
const BET_COMMAND = 'nikos plan bet new --title "..."';

/** The options a select offers: the ones given, and any value the page holds that they lack, so a save never drops it. */
function offered(options: Opt[], current: (string | null | undefined)[]): Opt[] {
  const extra = current.filter((v): v is string => !!v && !options.some((o) => o.value === v));
  return [...options, ...[...new Set(extra)].map((v) => ({ value: v, label: v }))];
}

/** Key results and bets as options: each labelled with its title and the area that holds it, by name. */
const choiceOptions = (page: AreaPage, list: Choice[]): Opt[] => list.map((c) => ({ value: c.value, label: `${c.label} · ${areaName(page, c.area)}` }));

function fieldHtml(f: Field): string {
  const attrs: string[] = [`name="${esc(f.name)}"`];
  if (f.target) attrs.push('data-to="target"');
  // A field shown only for some kind is required only while it shows: the script sets required then, since a
  // hidden required field would stop the form from submitting.
  if (f.required) attrs.push(f.when ? "data-required" : "required");
  if (f.multiple) attrs.push("multiple");
  if (f.idFrom) attrs.push(`data-id-from="${esc(f.idFrom)}"`);
  if (f.list) attrs.push(`list="${esc(f.list)}"`);
  if (f.placeholder) attrs.push(`placeholder="${esc(f.placeholder)}"`);
  let control: string;
  if (f.options) {
    const chosen = Array.isArray(f.value) ? f.value : f.value === undefined ? [] : [String(f.value)];
    const blank = f.blank !== undefined && !f.multiple ? `<option value="">${esc(f.blank)}</option>` : "";
    const opts = f.options.map((o) => `<option value="${esc(o.value)}"${chosen.includes(o.value) ? " selected" : ""}>${esc(o.label)}</option>`).join("");
    control = `<select ${attrs.join(" ")}>${blank}${opts}</select>`;
  } else if (f.kind === "textarea" || f.kind === "lines") {
    const text = Array.isArray(f.value) ? f.value.join(String.fromCharCode(10)) : f.value === undefined ? "" : String(f.value);
    control = `<textarea ${attrs.join(" ")}${f.kind === "lines" ? ' data-list="lines"' : ""} rows="${f.kind === "lines" ? 4 : 3}">${esc(text)}</textarea>`;
  } else {
    const type = f.kind === "number" || f.kind === "date" ? f.kind : "text";
    const value = f.value === undefined || Array.isArray(f.value) ? "" : String(f.value);
    control = `<input ${attrs.join(" ")} type="${type === "number" ? "number" : type === "date" ? "date" : "text"}"${type === "number" ? ' step="any"' : ""} value="${esc(value)}">`;
  }
  const when = f.when ? ` data-when="${esc(`${f.when.name}=${f.when.value}`)}"` : "";
  const hint = f.hint ? `<small class="hint">${esc(f.hint)}</small>` : "";
  return `<label class="field${f.wide ? " wide" : ""}"${when}><span>${esc(f.label)}</span>${control}${hint}</label>`;
}

/** A form that makes or changes one thing through one op. Its fields are read on submit, and the live script posts them. */
function formHtml(s: FormSpec): string {
  const expect = s.expect === undefined ? "" : ` data-expect="${esc(s.expect)}"`;
  const more = s.more?.length ? `<details class="form-more"><summary>More</summary><div class="fields">${s.more.map(fieldHtml).join("")}</div></details>` : "";
  const note = s.note ? `<span class="meta">${esc(s.note)}</span>` : "";
  return `<form class="save form" data-op="${esc(s.op)}" data-area="${esc(s.area)}" data-target="${esc(JSON.stringify(s.target ?? {}))}"${expect}><div class="fields">${s.fields.map(fieldHtml).join("")}${more}</div><div class="actions"><button type="submit">${esc(s.submit)}</button>${note}<span class="save-msg" role="status"></span></div></form>`;
}

/** A named part of an edit section, with its form under it. */
const sub = (title: string, html: string) => `<div class="sub"><h4>${esc(title)}</h4>${html}</div>`;

/** The line that says how to add something: a button that opens the form on this page, or the command when there is no form. */
function addAction(live: boolean, open: string, label: string, command: string): string {
  return live ? `<button type="button" class="primary" data-open="${open}">${esc(label)}</button>` : `Add one with <code>${esc(command)}</code>.`;
}

/** What a page says when it has nothing to show: what is missing, and how to add it. */
function emptyState(title: string, body: string, action = ""): string {
  return `<div class="empty"><p><strong>${esc(title)}</strong></p><p class="meta">${esc(body)}</p>${action ? `<p>${action}</p>` : ""}</div>`;
}

/** The form that adds a key result. Company and department only, and live only. The quarter is a department's; the year is the company's. */
function addKrForm(page: AreaPage, live: boolean): string {
  if (!live || (page.plan.level !== "company" && page.plan.level !== "department")) return "";
  const c = page.choices;
  const dept = page.plan.level === "department";
  const number = { name: "kind", value: "number" };
  const steps = { name: "kind", value: "milestone" };
  const fields: Field[] = [
    { name: "title", label: "Title", required: true, placeholder: "e.g. Close days" },
    { name: "owner", label: "Owner", required: true },
    { name: "objective", label: "Objective", list: "objectives", hint: "The goal it serves. Pick one already in use, or write a new one." },
    { name: "kind", label: "Kind", options: KIND, value: "number" },
    { name: "baseline", label: "Starts at", kind: "number", when: number, required: true },
    { name: "target", label: "Target", kind: "number", when: number, required: true },
    { name: "unit", label: "Unit", placeholder: "e.g. days", when: number },
    { name: "direction", label: "Should it go up or down?", options: UP_DOWN, value: "up", when: number },
    { name: "steps", label: "Steps, one per line", kind: "lines", wide: true, when: steps },
  ];
  // The select has no blank option, so the quarter it shows is the one it sends: the page's, else the first offered.
  if (dept && c.periods.length) fields.push({ name: "period", label: "Quarter", options: c.periods.map((q) => ({ value: q, label: q })), value: page.period ?? c.periods[0], required: true });
  fields.push({ name: "by", label: "Due date", kind: "date", hint: "Leave blank for the end of the quarter or year." });
  if (dept && c.alignKrs.length) fields.push({ name: "aligns_to", label: "Aligns to", options: choiceOptions(page, c.alignKrs), multiple: true, wide: true, hint: "Key results above this one. Pick one or more." });
  const more: Field[] = [{ name: "kr", label: "Id", target: true, idFrom: "title", hint: "Made from the title. Change it only when you need another." }];
  return `<details class="card add" id="add-kr"><summary>Add a key result</summary>${formHtml({ op: "kr.new", area: page.plan.rel, fields, more, submit: "Add key result" })}</details>`;
}

/** The form that adds a bet in this area. Every level, and live only. */
function addBetForm(page: AreaPage, live: boolean): string {
  if (!live) return "";
  const c = page.choices;
  const fields: Field[] = [
    { name: "title", label: "What are you betting on?", required: true, placeholder: "e.g. Faster checkout" },
    { name: "hypothesis", label: "Hypothesis", kind: "textarea", required: true, wide: true, placeholder: "We think … because …", hint: "What you believe, and why." },
    { name: "owner", label: "Owner", required: true },
    { name: "review_on", label: "Review on", kind: "date", required: true, hint: "When to look at the bet again. A bet has a review date, not a deadline." },
    { name: "primary", label: "Aims at", options: choiceOptions(page, c.aimKrs), blank: "Not yet", hint: "The key result it is meant to move." },
    { name: "also", label: "Also aims at", options: choiceOptions(page, c.aimKrs), multiple: true, wide: true },
  ];
  if (c.alignBets.length) fields.push({ name: "aligns_to", label: "Aligns to", options: choiceOptions(page, c.alignBets), multiple: true, wide: true, hint: "Bets above this one that it helps deliver." });
  const more: Field[] = [
    { name: "bet", label: "Id", target: true, idFrom: "title", hint: "Made from the title. Change it only when you need another." },
    { name: "team", label: "Team" },
    { name: "starts", label: "Starts", kind: "date" },
    { name: "deadline", label: "Deadline", kind: "date" },
  ];
  return `<details class="card add" id="add-bet"><summary>Add a bet</summary>${formHtml({ op: "bet.new", area: page.plan.rel, fields, more, submit: "Add bet" })}</details>`;
}

/** A key result's edit forms, live only: its details, its target and what it aligns to. Each saves with the version the page read. */
function editKrBlock(k: DashKr, page: AreaPage, live: boolean): string {
  if (!live) return "";
  const number = k.kind === "number";
  const forms = [
    sub(
      "Details",
      formHtml({
        op: "kr.edit",
        area: k.rel,
        target: { kr: k.id },
        expect: k.version,
        submit: "Save",
        fields: [
          { name: "title", label: "Title", value: k.title, required: true },
          { name: "owner", label: "Owner", value: k.owner, required: true },
          { name: "objective", label: "Objective", value: k.objective, list: "objectives" },
          { name: "by", label: "Due date", kind: "date", value: k.by, required: true },
          ...(number
            ? [
                { name: "unit", label: "Unit", value: k.unit },
                { name: "direction", label: "Should it go up or down?", options: UP_DOWN, value: k.direction },
              ]
            : []),
        ],
      }),
    ),
  ];
  if (number)
    forms.push(
      sub(
        "Move the target",
        formHtml({
          op: "kr.target",
          area: k.rel,
          target: { kr: k.id },
          expect: k.version,
          submit: "Move target",
          note: "The original target stays on record.",
          fields: [{ name: "target", label: "New target", kind: "number", value: k.target, required: true }],
        }),
      ),
    );
  if (page.choices.alignKrs.length)
    forms.push(
      sub(
        "Aligns to",
        formHtml({
          op: "kr.align",
          area: k.rel,
          target: { kr: k.id },
          expect: k.version,
          submit: "Save alignment",
          fields: [{ name: "aligns_to", label: "Aligns to", options: offered(choiceOptions(page, page.choices.alignKrs), k.aligns_to), multiple: true, value: k.aligns_to, wide: true, hint: "Key results above this one." }],
        }),
      ),
    );
  return `<details class="edit"><summary>Edit this key result</summary>${forms.join("")}</details>`;
}

/** A bet's edit forms, live only: its details, what it aims at, what it aligns to, and a review. Each saves with the version the page read. */
function editBetBlock(b: DashBet, page: AreaPage, live: boolean): string {
  if (!live) return "";
  const aims = choiceOptions(page, page.choices.aimKrs);
  const alignOptions = offered(choiceOptions(page, page.choices.alignBets), b.aligns);
  const forms = [
    sub(
      "Details",
      formHtml({
        op: "bet.edit",
        area: b.rel,
        target: { bet: b.id },
        expect: b.version,
        submit: "Save",
        fields: [
          { name: "title", label: "Title", value: b.title ?? "", hint: "Shown in place of the id. Leave blank to show the id." },
          { name: "owner", label: "Owner", value: b.owner, required: true },
          { name: "team", label: "Team", value: b.team },
          { name: "hypothesis", label: "Hypothesis", kind: "textarea", value: b.hypothesis, required: true, wide: true },
          { name: "starts", label: "Starts", kind: "date", value: b.starts },
          { name: "review_on", label: "Review on", kind: "date", value: b.review_on, required: true },
          { name: "deadline", label: "Deadline", kind: "date", value: b.deadline },
          { name: "confidence", label: "How sure are you?", options: CONFIDENCE, value: b.confidence },
        ],
      }),
    ),
    sub(
      "What it aims at",
      formHtml({
        op: "bet.krs",
        area: b.rel,
        target: { bet: b.id },
        expect: b.version,
        submit: "Save",
        fields: [
          { name: "primary", label: "Aims at", options: offered(aims, [b.krs.primary]), blank: "Not yet", value: b.krs.primary ?? "" },
          { name: "also", label: "Also aims at", options: offered(aims, b.krs.also), multiple: true, value: b.krs.also, wide: true },
        ],
      }),
    ),
  ];
  if (alignOptions.length)
    forms.push(
      sub(
        "Aligns to",
        formHtml({
          op: "bet.align",
          area: b.rel,
          target: { bet: b.id },
          expect: b.version,
          submit: "Save alignment",
          fields: [{ name: "aligns_to", label: "Aligns to", options: alignOptions, multiple: true, value: b.aligns, wide: true, hint: "Bets above this one that it helps deliver." }],
        }),
      ),
    );
  forms.push(
    sub(
      "Record a review",
      formHtml({
        op: "bet.review",
        area: b.rel,
        target: { bet: b.id },
        expect: b.version,
        submit: "Record review",
        note: "Dated today.",
        fields: [
          { name: "decision", label: "Decision", options: DECISIONS, value: "continue" },
          { name: "outcome", label: "Outcome, when completing", options: OUTCOMES, blank: "Not yet", value: "" },
          { name: "reason", label: "Reason", kind: "textarea", required: true, wide: true },
        ],
      }),
    ),
  );
  return `<details class="edit"><summary>Edit this bet</summary>${forms.join("")}</details>`;
}

/** The key results: a summary, then a card for each, grouped by objective. Company and departments only. */
function renderKeys(page: AreaPage, live: boolean): string {
  const add = addKrForm(page, live);
  if (!page.krs.length) return `${add}${krEmpty(page, live)}`;
  const st = page.krs.map((k) => krStatus(k, page.today)?.label);
  const n = (l: string) => st.filter((x) => x === l).length;
  const ds = page.bets.map((b) => (b.delivery?.source === "own" ? b.delivery.delivery?.status : undefined));
  const strip = `<div class="strip"><div><span class="eyebrow">Key results</span><span class="big num">${page.krs.length}</span><span class="parts"><span>${n("On track")} on track</span><span>${n("At risk")} at risk</span><span>${n("Off track")} off track</span></span></div><div><span class="eyebrow">Bets</span><span class="big num">${page.bets.length}</span><span class="parts"><span>${ds.filter((x) => x === "Building").length} building</span><span>${ds.filter((x) => x === "Shipped").length} shipped</span><span>${page.bets.filter((b) => b.outcome === "won").length} won</span></span></div></div>`;
  const byObjective = new Map<string, DashKr[]>();
  for (const k of page.krs) byObjective.set(k.objective, [...(byObjective.get(k.objective) ?? []), k]);
  const sections = [...byObjective].map(([objective, krs]) => `<section>${objective ? `<h2><span class="eyebrow">Objective</span><br>${esc(objective)}</h2>` : "<h2>Key results</h2>"}<div class="cards">${krs.map((k) => krCard(k, page, live)).join("")}</div></section>`);
  return `${add}${strip}${sections.join("")}`;
}

/** One key result as a card: its figure against its target, a bar with the period's pace, its check-ins, and the check-in form. */
function krCard(k: DashKr, page: AreaPage, live: boolean): string {
  const figure =
    k.kind === "milestone"
      ? `<div class="figure"><span class="now num">${k.steps.filter((x) => x.done).length}/${k.steps.length}</span><span class="of">steps done</span></div>`
      : `<div class="figure"><span class="now num">${esc(k.latest ? withUnit(k.latest.value, k.unit) : "—")}</span><span class="of">from ${esc(withUnit(k.baseline, k.unit))} to ${esc(withUnit(k.target, k.unit))}${k.direction === "down" ? ", going down" : ""}</span></div>`;
  const when = k.latest ? `Checked in ${esc(shortDate(k.latest.date))}` : k.kind === "milestone" ? "" : "No check-ins yet";
  return `<article class="card kr-card"><div class="head"><a href="${esc(krHref(k.rel, k.id, page.period))}">${esc(k.title)}</a>${statusPill(k, page.today)}</div><span class="id">${esc(k.id)}${k.owner ? ` · ${esc(k.owner)}` : ""} · due ${esc(shortDate(k.by))}</span>${figure}${krBar(k, page.today)}<div class="card-foot"><span>${when}${k.stale ? `${when ? " · " : ""}<strong>stale</strong>` : ""}</span>${k.kind === "number" ? sparkOf(k) : ""}</div><p class="meta">${esc(krMeta(k))}</p>${checkinForm(k, live)}</article>`;
}

/** The empty state of an area's key results: the year for the company, the quarter for a department. */
function krEmpty(page: AreaPage, live: boolean): string {
  const when = page.plan.level === "company" ? page.plan.period : (page.period ?? page.choices.periods[0]);
  return emptyState(when ? `No key results for ${when} yet.` : "No key results yet.", KR_BODY, addAction(live, "add-kr", "Add a key result", KR_COMMAND));
}

/** The OKRs and bets: each objective with its key results, and the bets that aim at each one. */
function renderOkrs(page: AreaPage, live: boolean): string {
  const own = page.plan.level === "company" || page.plan.level === "department";
  const byObjective = new Map<string, DashKr[]>();
  for (const k of page.krs) byObjective.set(k.objective, [...(byObjective.get(k.objective) ?? []), k]);
  const listed = new Set<string>();
  const parts: string[] = [];
  for (const [objective, krs] of byObjective) {
    parts.push(`<section>${objective ? `<h3>${esc(objective)}</h3>` : ""}`);
    for (const k of krs) {
      const aimed = page.bets.filter((b) => b.krs.primary === k.id || b.krs.also.includes(k.id));
      for (const b of aimed) listed.add(b.id);
      // Other areas' bets at it follow the area's own, each with the area it's in.
      const elsewhere = page.aimingBets.filter((b) => b.of === k.id);
      const lines = [...aimed.map((b) => betLine(b, page)), ...elsewhere.map((b) => betLine(b, page, areaName(page, b.rel)))];
      parts.push(
        `<div class="card okr"><div class="okr-head"><div><a href="${esc(krHref(k.rel, k.id, page.period))}">${esc(k.title)}</a> <span class="id">${esc(k.id)}</span><div class="meta">${esc(krMeta(k))}${k.aligns_to.length ? `. Aligns to ${esc(k.aligns_to.map((id) => labelOf(page, id)).join(", "))}` : ""}</div></div>${statusPill(k, page.today)}</div><div class="okr-body">${checkinForm(k, live)}${
          lines.length ? `<ul class="rows">${lines.join("")}</ul>` : '<p class="meta">No bets aim at this yet.</p>'
        }${editKrBlock(k, page, live)}</div></div>`,
      );
    }
    parts.push("</section>");
  }
  const loose = page.bets.filter((b) => !listed.has(b.id));
  const heading = own ? "Key results and the bets that aim at them" : "Key results its bets aim at";
  let body: string;
  if (parts.length) body = parts.join("");
  else if (own) body = krEmpty(page, live);
  else body = emptyState("Its bets aim at no key results yet.", "Key results come from the level above. Make a bet that aims at one of them.", addAction(live, "add-bet", "Add a bet", BET_COMMAND));
  // The bet form sits at the top for every level, so a bet can be added once key results exist too.
  return `${addKrForm(page, live)}${addBetForm(page, live)}<h2>${esc(heading)}</h2>${body}${loose.length ? `<h2>Bets that aim at no key result shown here</h2><ul class="rows">${loose.map((b) => betLine(b, page)).join("")}</ul>` : ""}`;
}

/** The four-column ladder: above key results, this area's key results, this area's bets, above bets. */
const W = 200, G = 96, CH = 58, CG = 10, HH = 24, TOP = 30, CAP = 12;

interface Cell {
  key: string;
  cls: string;
  inner: string;
}
interface Group {
  head?: string;
  cells: Cell[];
}
interface Placed {
  x: number;
  y: number;
  col: number;
}

/** Stacks one column's groups top to bottom, up to the cap; the rest are counted for the "more" line. */
function stackColumn(col: number, groups: Group[], cap: number, placed: Map<string, Placed>): { html: string[]; height: number; hidden: number } {
  const x = col * (W + G);
  const html: string[] = [];
  let y = TOP;
  let shown = 0;
  let hidden = 0;
  for (const g of groups) {
    const take = g.cells.slice(0, Math.max(0, cap - shown));
    hidden += g.cells.length - take.length;
    if (!take.length) continue;
    if (g.head) {
      html.push(`<div class="grouphead" style="left:${x}px;top:${y}px;width:${W}px">${esc(g.head)}</div>`);
      y += HH;
    }
    for (const c of take) {
      placed.set(c.key, { x, y, col });
      html.push(`<div class="cell ${c.cls}" style="left:${x}px;top:${y}px;width:${W}px;height:${CH}px">${c.inner}</div>`);
      y += CH + CG;
      shown++;
    }
    y += 6;
  }
  return { html, height: y, hidden };
}

/**
 * The lines of the ladder: each cell that aligns to another cell on the page, from the one that aligns to the
 * one it aligns to. Every cell above the area is reached by a line from the cell below it that aligns to it.
 */
function ladderLinks(page: AreaPage): [string, string][] {
  const aboveKrKey = new Map(page.aboveKrs.map((a) => [a.id, `above-kr:${a.rel}/${a.id}`] as const));
  const aboveBetKey = new Map(page.aboveBets.map((a) => [a.id, `above-bet:${a.rel}/${a.id}`] as const));
  const links: [string, string][] = [];
  for (const k of page.krs) for (const ref of k.aligns) if (aboveKrKey.has(ref)) links.push([`kr:${k.id}`, aboveKrKey.get(ref)!]);
  for (const a of page.aboveKrs) for (const ref of a.aligns) if (aboveKrKey.has(ref) && aboveKrKey.get(ref) !== `above-kr:${a.rel}/${a.id}`) links.push([`above-kr:${a.rel}/${a.id}`, aboveKrKey.get(ref)!]);
  for (const b of page.bets) for (const id of [b.krs.primary, ...b.krs.also]) if (id) links.push([`kr:${id}`, `bet:${b.id}`]);
  for (const b of page.bets) for (const a of b.aligns_to) links.push([`bet:${b.id}`, `above-bet:${a.rel}/${a.id}`]);
  for (const a of page.aboveBets) for (const ref of a.aligns) if (aboveBetKey.has(ref) && aboveBetKey.get(ref) !== `above-bet:${a.rel}/${a.id}`) links.push([`above-bet:${a.rel}/${a.id}`, aboveBetKey.get(ref)!]);
  return links;
}

function renderLadder(page: AreaPage, state: PlanView): string {
  const placed = new Map<string, Placed>();
  const cap = state.more ? Infinity : CAP;
  const period = page.period;
  const krLink = (rel: string, k: { id: string; title: string }, meta: string, cls: string) =>
    ({ cls, inner: `<a class="t" href="${esc(krHref(rel, k.id, period))}">${esc(k.title)}</a><span class="m">${esc(meta)}</span>` });

  const aboveKrCells: Cell[] = page.aboveKrs.map((a) => ({
    key: `above-kr:${a.rel}/${a.id}`,
    ...krLink(a.rel, a, `${areaName(page, a.rel)} · ${shareOf(a)} · ${a.owner}`, "above-kr"),
  }));
  const krGroups = new Map<string, Cell[]>();
  for (const k of page.krs) {
    const cell: Cell = { key: `kr:${k.id}`, ...krLink(k.rel, k, k.kind === "milestone" ? stepsOf(k) : `${pct(k.progress)} ${quarterly(k) ? "this period" : "toward target"}`, "kr") };
    krGroups.set(k.objective, [...(krGroups.get(k.objective) ?? []), cell]);
  }
  const krColumn: Group[] = [...krGroups].map(([head, cells]) => ({ ...(head ? { head } : {}), cells }));
  const betCells: Cell[] = page.bets.map((b) => ({
    key: `bet:${b.id}`,
    cls: "bet",
    inner: `<a class="t" href="${esc(betHref(b.rel, b.id, period))}">${esc(betName(b))}</a><span class="m">${esc(deliveredBy(b.delivery))}</span>`,
  }));
  const aboveBetCells: Cell[] = page.aboveBets.map((a) => ({
    key: `above-bet:${a.rel}/${a.id}`,
    cls: "above-bet",
    inner: `<a class="t" href="${esc(betHref(a.rel, a.id, period))}">${esc(betName(a))}</a><span class="m">${esc(`${areaName(page, a.rel)} · ${a.owner}`)}</span>`,
  }));

  const columns = [
    stackColumn(0, [{ cells: aboveKrCells }], cap, placed),
    stackColumn(1, krColumn, cap, placed),
    stackColumn(2, [{ cells: betCells }], cap, placed),
    stackColumn(3, [{ cells: aboveBetCells }], cap, placed),
  ];
  const paths: string[] = [];
  for (const [from, to] of ladderLinks(page)) {
    const a = placed.get(from);
    const b = placed.get(to);
    if (!a || !b) continue;
    const sy = a.y + CH / 2;
    const ey = b.y + CH / 2;
    if (a.col === b.col) {
      // Two cells in one column: the curve bulges into the gap beside them, on the right, or on the left in the last column.
      const side = a.col < 3 ? 1 : -1;
      const sx = side > 0 ? a.x + W : a.x;
      const ex = side > 0 ? b.x + W : b.x;
      paths.push(`<path d="M${sx} ${sy} C${sx + (side * G) / 2} ${sy}, ${ex + (side * G) / 2} ${ey}, ${ex} ${ey}"/>`);
      continue;
    }
    // Across columns: from the right edge of the left cell to the left edge of the right one.
    const [left, right] = a.col < b.col ? [a, b] : [b, a];
    const y1 = left === a ? sy : ey;
    const y2 = right === a ? sy : ey;
    const sx = left.x + W;
    const ex = right.x;
    paths.push(`<path d="M${sx} ${y1} C${sx + G / 2} ${y1}, ${ex - G / 2} ${y2}, ${ex} ${y2}"/>`);
  }

  const heads = ["Above key results", page.period ? `This area's key results · ${page.period}` : "This area's key results", "This area's bets", "Above bets"];
  const headHtml = heads.map((h, i) => `<div class="colhead" style="left:${i * (W + G)}px;width:${W}px">${esc(h)}</div>`).join("");
  const width = 4 * W + 3 * G;
  const height = Math.max(...columns.map((c) => c.height)) + 4;
  const more = columns
    .map((c, i) => (c.hidden ? `<div class="more" style="left:${i * (W + G)}px;top:${height}px;width:${W}px">+${c.hidden} more · <a href="${esc(hrefOf({ at: page.plan.rel, view: "ladder", widen: widenParam(state.widen), more: "all", period }))}">show all</a></div>` : ""))
    .join("");
  const hidden = columns.some((c) => c.hidden > 0);
  return `<div class="ladder-scroll"><div class="ladder" style="width:${width}px;height:${height + (hidden ? 22 : 0)}px"><svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">${paths.join("")}</svg>${headHtml}${columns.map((c) => c.html.join("")).join("")}${more}</div></div>`;
}

/** The widen value a query carries: up, down or all, or none. */
function widenParam(w: { up: boolean; down: boolean }): string | undefined {
  return w.up && w.down ? "all" : w.up ? "up" : w.down ? "down" : undefined;
}

function renderWiden(page: AreaPage, state: PlanView): string {
  const base = { at: page.plan.rel, view: "ladder", more: state.more ? "all" : undefined, period: page.period };
  const up = { up: !state.widen.up, down: state.widen.down };
  const down = { up: state.widen.up, down: !state.widen.down };
  const upLabel = state.widen.up ? "Hide the levels above" : "Show everything above";
  const downLabel = state.widen.down ? "Hide the levels below" : "Show everything below";
  return `<p class="widen"><a href="${esc(hrefOf({ ...base, widen: widenParam(up) }))}">${upLabel}</a><a href="${esc(hrefOf({ ...base, widen: widenParam(down) }))}">${downLabel}</a></p>`;
}

/** The bets below this area, when it widened down: each with how it delivers the area's bets or key results. */
function renderBelow(belowBets: BelowBet[], page: AreaPage): string {
  if (!belowBets.length) return "<p>None below this area yet.</p>";
  const how = (b: BelowBet) => (b.how === "child" ? `Below ${b.of}` : aimText(b.how, b.of));
  return `<h2>Below this area</h2><ul class="rows">${belowBets.map((b) => `<li>${betLink(b, page.period)}${betId(b)} (${esc(areaName(page, b.rel))}) — ${esc(b.outcome)}. ${esc(how(b))}. Delivery: ${esc(deliveryText(b.delivery))}</li>`).join("")}</ul>`;
}

/** The ladder page: the widen links, the ladder, and what widened below. */
function renderLadderPage(page: AreaPage, state: PlanView): string {
  return `${renderWiden(page, state)}${renderLadder(page, state)}${state.widen.down ? renderBelow(page.belowBets, page) : ""}`;
}

/** A bet's stories as a bar: done, then in progress, out of all of them. Only for a bet whose own maps have stories. */
function deliveryBar(d: BetDelivery | undefined): string {
  const f = d?.source === "own" ? d.delivery : undefined;
  if (!f || !f.total) return "";
  const w = (n: number) => `${((100 * n) / f.total).toFixed(1)}%`;
  return `<div class="stack" role="img" aria-label="${f.done} of ${f.total} stories done, ${f.inProgress} in progress"><i class="d" style="width:${w(f.done)}"></i><i class="b" style="width:${w(f.inProgress)}"></i></div>`;
}

function renderBets(page: AreaPage, live: boolean): string {
  const add = addBetForm(page, live);
  if (!page.bets.length) return `${add}${emptyState(`No bets in ${page.plan.name} yet.`, BET_BODY, addAction(live, "add-bet", "Add a bet", BET_COMMAND))}`;
  const body = page.bets
    .map((b: DashBet) => {
      const facts: string[] = [];
      if (b.owner) facts.push(`<dt>Owner</dt><dd>${esc(b.owner)}</dd>`);
      if (b.team) facts.push(`<dt>Team</dt><dd>${esc(b.team)}</dd>`);
      if (b.review_on) facts.push(`<dt>Review</dt><dd>${esc(shortDate(b.review_on))}${b.review_on < page.today && b.outcome === "open" ? ' · <strong style="color:var(--bad)">due</strong>' : ""}</dd>`);
      const aims = [b.krs.primary, ...b.krs.also].filter((x): x is string => !!x);
      if (aims.length) facts.push(`<dt>Aims at</dt><dd>${aims.map((id) => `<a href="${esc(krHref(page.plan.rel, id, page.period))}">${esc(labelOf(page, id))}</a>`).join(", ")}</dd>`);
      if (b.aligns_to.length) facts.push(`<dt>Aligns to</dt><dd>${b.aligns_to.map((x) => betLink(x, page.period)).join(", ")}</dd>`);
      facts.push(`<dt>Delivery</dt><dd>${esc(deliveryText(b.delivery))}</dd>`);
      if (b.stories.length) facts.push(`<dt>Stories</dt><dd>${b.stories.map((s) => `${esc(s.id)} (${esc(s.status ?? "no summary yet")})`).join(", ")}</dd>`);
      return `<article class="card bet-card"><div class="row" style="justify-content:space-between;align-items:flex-start"><h3>${betLink(b, page.period)}${betId(b)} <span class="where">${esc(areaName(page, b.rel))}</span></h3>${outcomePill(b.outcome)}</div>${b.hypothesis ? `<p class="belief">${esc(b.hypothesis)}</p>` : ""}<div class="row">${deliveryPill(b.delivery)}</div>${deliveryBar(b.delivery)}<dl class="kv">${facts.join("")}</dl>${editBetBlock(b, page, live)}</article>`;
    })
    .join("");
  return `${add}<div class="bet-cards">${body}</div>`;
}

/** The timeline: each bet from its start to its deadline with its review, and each key result's due date, against the months. */
function renderTimeline(page: AreaPage): string {
  const bets = page.bets.filter((b) => b.starts || b.review_on || b.deadline);
  const krs = page.krs.filter((k) => k.by);
  if (!bets.length && !krs.length) return emptyState("No dated items yet.", "Bets show here once they have a start, a review date or a deadline, and key results once they have a due date.");
  const dates = [...bets.flatMap((b) => [b.starts, b.review_on, b.deadline]), ...krs.map((k) => k.by), page.today].filter((d) => !!d && !Number.isNaN(dayOf(d))).sort();
  const lo = new Date(dayOf(dates[0]!)), hi = new Date(dayOf(dates[dates.length - 1]!));
  // A month's room after the last date, so a mark on it isn't cut off at the edge.
  const start = Date.UTC(lo.getUTCFullYear(), lo.getUTCMonth(), 1), end = Date.UTC(hi.getUTCFullYear(), hi.getUTCMonth() + 2, 1);
  const X = (d: string) => `${((100 * (dayOf(d) - start)) / (end - start)).toFixed(2)}%`;
  const months: number[] = [];
  for (let d = new Date(start); d.getTime() < end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) months.push(d.getTime());
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const grid = months.map((m) => `<span class="tl-month" style="left:${((100 * (m - start)) / (end - start)).toFixed(2)}%"></span>`).join("");
  const today = `<span class="tl-today" style="left:${X(page.today)}" title="Today, ${esc(shortDate(page.today))}"></span>`;
  const head = `<div class="tl-row tl-head"><div class="tl-label"></div><div class="tl-track">${months.map((m, i) => `<span class="tl-month" style="left:${((100 * (m - start)) / (end - start)).toFixed(2)}%">${months.length > 8 && i % 2 ? "" : MON[new Date(m).getUTCMonth()]}</span>`).join("")}${today}</div></div>`;
  // One list in date order: each key result by its due date, each bet by its first date.
  const rows: { date: string; html: string }[] = [];
  for (const k of krs) rows.push({ date: k.by, html: `<div class="tl-row"><div class="tl-label"><a href="${esc(krHref(k.rel, k.id, page.period))}">${esc(k.title)}</a><p class="meta">Key result due ${esc(k.by)}</p></div><div class="tl-track" aria-hidden="true">${grid}<span class="tl-mark due" style="left:${X(k.by)}"></span>${today}</div></div>` });
  for (const b of bets) {
    const from = b.starts || b.review_on, to = b.deadline || b.review_on;
    const said = [b.starts && `Starts ${b.starts}`, b.review_on && `Review ${b.review_on}`, b.deadline && `Deadline ${b.deadline}`].filter(Boolean).join(" · ");
    const bar = from && to && to >= from ? `<span class="tl-bar" style="left:${X(from)};width:calc(${X(to)} - ${X(from)})"></span>` : "";
    rows.push({ date: [b.starts, b.review_on, b.deadline].filter(Boolean).sort()[0]!, html: `<div class="tl-row"><div class="tl-label"><a href="${esc(betHref(b.rel, b.id, page.period))}">${esc(betName(b))} — ${esc(b.outcome)}</a><p class="meta">${esc(said)}</p></div><div class="tl-track" aria-hidden="true">${grid}${bar}${b.review_on ? `<span class="tl-mark" style="left:${X(b.review_on)}"></span>` : ""}${today}</div></div>` });
  }
  rows.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  return `<p class="tl-legend"><span>Bar: a bet from its start to its deadline</span><span>Diamond: a review, or a key result's due date</span><span>Red line: today, ${esc(shortDate(page.today))}</span><span>${esc(MON[new Date(start).getUTCMonth()]!)} ${new Date(start).getUTCFullYear()} to ${esc(MON[new Date(end - DAY).getUTCMonth()]!)} ${new Date(end - DAY).getUTCFullYear()}</span></p><div class="tl">${head}${rows.map((r) => r.html).join("")}</div>`;
}

/** A text-only item's line on its own drill-down: what it says, and that no figure counts it. Nothing once a link backs it. */
const notLinkedLine = (text?: string) => (text ? `<p class="meta">Not linked yet: "${esc(text)}". It counts in no figure.</p>` : "");

/** The line that sends a person to the area that holds a key result or bet, to change it there. */
const elsewhereLine = (what: string, rel: string, href: string, page: AreaPage) => `<p class="meta">To change this ${what}, open it in <a href="${esc(href)}">${esc(areaName(page, rel))}</a>.</p>`;

/** Where a story map opens: in its own code repo, with nikos serve. The plan only reads its delivery. */
const SERVE_HINT = `<p class="serve-hint">The plan reads each map's committed delivery file. To open a whole story map, run <code>nikos serve</code> in its code repo.</p>`;

function renderKrDrill(d: KrDrill, page: AreaPage, live: boolean): string {
  const k = d.kr;
  const head = `<h2>Key result: ${esc(k.title)}</h2><p>${statusPill(k, page.today)}</p><p class="meta"><span class="id">${esc(k.id)}</span> in ${esc(areaName(page, k.rel))} · ${esc(k.kind === "milestone" ? stepsOf(k) : `${pct(k.progress)}, ${checkinOf(k)}`)}${k.stale ? " · stale" : ""}</p>${notLinkedLine(k.laddersUp)}`;
  const own = page.krs.find((x) => x.id === k.id && x.rel === k.rel);
  const editing = own ? editKrBlock(own, page, live) : k.rel === page.plan.rel ? "" : elsewhereLine("key result", k.rel, krHref(k.rel, k.id, page.period), page);
  if (!d.areas.length) return `<div class="drill">${head}<p>No bets aim at this key result yet.</p>${editing}</div>`;
  const areas = d.areas.map((a) => {
    const items = a.bets.map((b: DrillBet) => {
      const maps = b.maps.length ? `<ul>${b.maps.map((m) => `<li>${esc(mapText(m))}</li>`).join("")}</ul>` : "";
      return `<li>${betLink(b, page.period)}${betId(b)} — ${esc(b.outcome)}. ${esc(aimText(b.aims, k.id))}. Delivery: ${esc(deliveryText(b.delivery))}${maps}</li>`;
    });
    return `<h3>${esc(a.name)}</h3><ul>${items.join("")}</ul>`;
  });
  const anyMaps = d.areas.some((a) => a.bets.some((b) => b.maps.length));
  return `<div class="drill">${head}${areas.join("")}${anyMaps ? SERVE_HINT : ""}${editing}</div>`;
}

function renderBetDrill(d: BetDrill, up: UpChain, page: AreaPage, live: boolean): string {
  const b = d.bet;
  const head = `<h2>Bet: ${esc(betName(b))}${betId(b)}</h2><p class="row">${deliveryPill(b.delivery)} ${outcomePill(b.outcome)}</p><p class="meta">In ${esc(areaName(page, b.rel))}${b.owner ? ` · Owner: ${esc(b.owner)}` : ""}</p><p>Delivery: ${esc(deliveryText(b.delivery))}</p><p class="meta">Delivery comes from the story maps. The outcome is called at review, from key result evidence.</p>${notLinkedLine(b.laddersUp)}`;
  const own = page.bets.find((x) => x.id === b.id && x.rel === b.rel);
  const editing = own ? editBetBlock(own, page, live) : b.rel === page.plan.rel ? "" : elsewhereLine("bet", b.rel, betHref(b.rel, b.id, page.period), page);
  const maps = d.maps.length ? `<h3>Story maps that deliver it</h3><ul>${d.maps.map((m) => `<li>${esc(mapText(m))}</li>`).join("")}</ul>${SERVE_HINT}` : "";
  const chain = up.levels.length
    ? up.levels.map((lvl) => `<h3>${lvl.depth === 1 ? "Aligns to" : `Level ${lvl.depth} up`}</h3><ul>${lvl.bets.map((x) => `<li>${betLink(x, page.period)}${betId(x)} (${esc(areaName(page, x.rel))}) — ${esc(x.outcome)}</li>`).join("")}</ul>`).join("")
    : "<h3>Aligns to</h3><p>Nothing above it.</p>";
  const below = d.children.length
    ? `<h3>Below it</h3><ul>${d.children.map((c) => `<li>${betLink(c, page.period)}${betId(c)} (${esc(areaName(page, c.rel))}) — ${esc(c.outcome)}. Delivery: ${esc(deliveryText(c.delivery))}</li>`).join("")}</ul>`
    : "";
  return `<div class="drill">${head}${maps}<h2>Up the chain</h2>${chain}${below}${editing}</div>`;
}

/**
 * The script of the live page. It posts each form to the server with the token and nothing else, and it keeps
 * the forms' small rules: a field is read from a form that shows it, a new form sends only what it has, an edit
 * sends a cleared field as blank so the file drops it, an id follows its title, and a kind shows its own fields.
 * idFromTitle is the rules module's own function, so the id box makes the same id as the command does.
 */
const LIVE_SCRIPT = `(function () {
var NL = String.fromCharCode(10);
${idFromTitle.toString()}
${saveBarScript("nikos plan serve", "dashboard")}
function showing(el) { return !el.closest("[hidden]"); }
// A field marked data-when shows while the named field of its form has the value given.
function syncKinds(form) {
  var parts = form.querySelectorAll("[data-when]");
  for (var i = 0; i < parts.length; i++) {
    var rule = parts[i].getAttribute("data-when").split("=");
    var field = form.elements.namedItem(rule[0]);
    var show = !!(field && field.value === rule[1]);
    parts[i].hidden = !show;
    var needs = parts[i].querySelectorAll("[data-required]");
    for (var j = 0; j < needs.length; j++) {
      if (show) needs[j].setAttribute("required", ""); else needs[j].removeAttribute("required");
    }
  }
}
// An id box nobody typed in follows its title, so the server makes the id: it skips an id already taken, where a sent id is refused.
function sends(f) { return !(f.hasAttribute("data-id-from") && !f.hasAttribute("data-typed")); }
// What a field sends. An edit sends a cleared field as blank, so the op drops it; a new thing sends only what has a value.
function readField(f, editing) {
  if (f.tagName === "SELECT" && f.multiple) {
    var picked = [];
    for (var j = 0; j < f.options.length; j++) if (f.options[j].selected && f.options[j].value !== "") picked.push(f.options[j].value);
    return picked.length || editing ? picked : undefined;
  }
  if (f.tagName === "TEXTAREA" && f.getAttribute("data-list") === "lines") {
    var lines = f.value.split(NL).map(function (s) { return s.trim(); }).filter(function (s) { return s !== ""; });
    return lines.length || editing ? lines : undefined;
  }
  var text = f.value.trim();
  if (text === "") return editing ? "" : undefined;
  return f.type === "number" ? Number(text) : text;
}
document.addEventListener("change", function (e) {
  var form = e.target && e.target.form;
  if (form && form.getAttribute("data-op") !== null) syncKinds(form);
});
document.addEventListener("click", function (e) {
  var opener = e.target && e.target.closest ? e.target.closest("[data-open]") : null;
  if (!opener) return;
  var box = document.getElementById(opener.getAttribute("data-open"));
  if (!box) return;
  box.open = true;
  var fields = box.querySelectorAll("input, select, textarea");
  for (var i = 0; i < fields.length; i++) {
    if (!showing(fields[i]) || fields[i].type === "hidden") continue;
    fields[i].focus();
    break;
  }
  if (box.scrollIntoView) box.scrollIntoView({ block: "start" });
});
document.addEventListener("submit", function (e) {
  var form = e.target;
  if (!form || !form.getAttribute || form.getAttribute("data-op") === null) return;
  e.preventDefault();
  var out = form.querySelector(".save-msg");
  var sendBtn = form.querySelector('button[type="submit"]');
  var editing = form.hasAttribute("data-expect");
  var target = JSON.parse(form.getAttribute("data-target") || "{}");
  var args = {};
  var fields = form.querySelectorAll("input[name], select[name], textarea[name]");
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    if (!showing(f) || !sends(f)) continue;
    var value = readField(f, editing);
    if (value === undefined) continue;
    if (f.getAttribute("data-to") === "target") target[f.name] = value;
    else args[f.name] = value;
  }
  if (out) { out.className = "save-msg"; out.textContent = "Saving…"; }
  if (sendBtn) sendBtn.disabled = true;
  call("POST", "/api/op", { op: form.getAttribute("data-op"), area: form.getAttribute("data-area"), target: target, args: args, expect: form.getAttribute("data-expect") || "" }).then(function (res) {
    if (res.ok) {
      if (out) out.textContent = res.body.message + (res.body.branch ? " on " + res.body.branch : "");
      // Saved: show the message for a moment, then load the page again so its figures and versions are the new ones.
      setTimeout(function () { location.reload(); }, 800);
      return;
    }
    if (sendBtn) sendBtn.disabled = false;
    if (!out) return;
    out.className = "save-msg error";
    out.textContent = res.status === 409 ? "This changed since the page loaded. Reload to see the latest, then try again." : errorOf(res);
    if (res.status === 409) {
      var reload = document.createElement("button");
      reload.type = "button";
      reload.textContent = "Reload";
      reload.addEventListener("click", function () { location.reload(); });
      out.appendChild(document.createTextNode(" "));
      out.appendChild(reload);
    }
  }, function () {
    if (sendBtn) sendBtn.disabled = false;
    if (out) { out.className = "save-msg error"; out.textContent = gone(); }
  });
});
var boxes = document.querySelectorAll("input[data-id-from]");
for (var b = 0; b < boxes.length; b++) (function (box) {
  var source = box.form ? box.form.elements.namedItem(box.getAttribute("data-id-from")) : null;
  if (!source) return;
  box.addEventListener("input", function () { box.setAttribute("data-typed", "yes"); });
  source.addEventListener("input", function () {
    if (box.hasAttribute("data-typed")) return;
    box.value = idFromTitle(source.value) || "";
  });
})(boxes[b]);
var forms = document.querySelectorAll("form[data-op]");
for (var k = 0; k < forms.length; k++) syncKinds(forms[k]);
pendingBar();
})();`;

/** What the page renders: the live page's forms and bar, or none for the offline export. */
export interface RenderBodyOptions extends PlanRenderOptions {
  /** The offline export's picker moves the page itself, so it has no script of its own. */
  offline?: boolean;
}

/** The Share dialog: what a person can send, which depends on where the page is open. Nothing here is a link to this page, which is private. */
function shareDialog(page: AreaPage, offline: boolean): string {
  // --in takes the area's id as well as its folder, and the id reads as a name.
  const rel = page.plan.rel;
  const file = rel === "company" ? "plan.html" : `${page.plan.id}.html`;
  const opt = (title: string, body: string, code?: string) => `<div class="opt"><h3>${esc(title)}</h3><p>${body}</p>${code ? `<code>${esc(code)}</code>` : ""}</div>`;
  const body = offline
    ? `<p>This page is a file. It works with no network and can't change anything. Send the file itself, or put it on an internal web host your company already uses. It names the code repos it reads, so share it only with people who may see them.</p>${opt("Get a newer copy", "Ask someone with the planning repo to export it again.", "nikos plan serve --export plan.html")}`
    : `<p>This dashboard runs on your computer. Its link has a private key in it and only works here while <code>nikos plan serve</code> is running, so don't send it to anyone. To share the plan, use one of these.</p>${opt(
        "Send a read-only page",
        "One file that opens in any browser and works offline. It names the code repos it reads, so send it only to people who may see them.",
        `nikos plan serve --export ${file}${rel === "company" ? "" : ` --in ${page.plan.id}`}`,
      )}${opt(
        "Publish it on your internal site",
        "Export the page for every area and put the file on an internal web host. A CI job can export it each time the planning repo's main branch changes, so the page always shows the merged plan.",
        "nikos plan serve --export plan.html",
      )}`;
  return `<dialog class="sheet-dialog" id="share" aria-labelledby="share-title"><div class="box"><h2 id="share-title">Share the plan</h2>${body}<div><button class="btn" type="button" data-share-close>Close</button></div></div></dialog>`;
}

/** Opens the Share dialog. The live page and the export both carry it. */
export const SHARE_JS = `document.addEventListener("click",function(e){var t=e.target&&e.target.closest?e.target:null;if(!t)return;var d=document.getElementById("share");if(!d)return;if(t.closest("[data-share]")&&d.showModal)d.showModal();else if(t.closest("[data-share-close]")||t===d)d.close();});`;

/** One area's page, as the content of its body. The view shows the area; a drill-down (kr or bet) replaces it. */
export function renderPlanBody(page: AreaPage, state: PageState, opts: RenderBodyOptions = {}): string {
  const name = page.plan.name;
  const period = page.period ?? page.plan.period;
  const live = !!opts.live && !opts.offline;
  const views = viewsFor(page.plan.level);
  const current = state.view.view;
  const viewLinks = views
    .map((v) => `<a href="${esc(hrefOf({ at: page.plan.rel, view: v, period: page.period }))}"${v === current && !state.drill ? ' class="on" aria-current="page"' : ""}>${esc(VIEW_LABEL[v])}</a>`)
    .join("");
  const below = page.tree.filter((n) => n.parent === page.plan.rel);
  const subs = below.length
    ? `<nav class="side-areas" aria-label="Areas below this"><span class="eyebrow">Areas below this</span>${below.map((n) => `<a href="${esc(hrefOf({ at: n.rel, period: periodFor(n.rel, page.period) }))}">${esc(n.name)}</a>`).join("")}</nav>`
    : "";
  // The suggestions of the objectives forms offer. One list for the page, since its forms share it.
  const datalist = live && page.choices.objectives.length ? `<datalist id="objectives">${page.choices.objectives.map((o) => `<option value="${esc(o)}">`).join("")}</datalist>` : "";
  let body: string;
  if (state.drill?.kind === "kr") body = renderKrDrill(state.drill.kr, page, live);
  else if (state.drill?.kind === "bet") body = renderBetDrill(state.drill.bet, state.drill.up, page, live);
  else if (current === "keys") body = renderKeys(page, live);
  else if (current === "okrs") body = renderOkrs(page, live);
  else if (current === "ladder") body = renderLadderPage(page, state.view);
  else if (current === "bets") body = renderBets(page, live);
  else body = renderTimeline(page);
  const back = state.drill ? `<p><a href="${esc(hrefOf({ at: page.plan.rel, view: current, period: page.period }))}">← Back to ${esc(name)}</a></p>` : "";
  const reads = page.repos.map((r) => `<li>${esc(repoLabel(r))}: ${esc(r.age)}</li>`);
  const list = (items: string[]) => (items.length ? `<ul>${items.join("")}</ul>` : "<p>None yet.</p>");
  const host = opts.offline
    ? `<span class="host"><span class="host-k">Exported page</span><span class="host-v">read-only</span></span>`
    : `<span class="host" title="Only you can open this, while nikos plan serve runs"><span class="host-k">On this computer</span><span class="host-v" data-host>127.0.0.1</span></span>`;
  const eyebrow = state.drill ? LEVEL_LABEL[page.plan.level] : VIEW_LABEL[current];
  return `${datalist}<a class="skip" href="#main">Skip to the page</a>
<div class="app">
<aside class="side">
<a class="brand" href="${esc(hrefOf({ at: "company" }))}"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,18 10,8 14,14 20,5"/></svg></span><span>nikOS Plan<small>${esc(page.names.company ?? "")}</small></span></a>
${state.drill ? "" : `<nav class="views" aria-label="Views">${viewLinks}</nav>`}
${subs}
</aside>
<div class="main">
<header class="top">
<div class="top-row"><nav class="altitudes" aria-label="Altitude">${altitudes(page)}</nav><div class="picker">${picker(page, !!opts.offline)}</div>
<div class="top-right">${host}<button type="button" class="share-btn" data-share aria-haspopup="dialog">Share…</button>${THEME_BUTTON}</div></div>
<nav class="crumbs" aria-label="Breadcrumb">${crumbs(page)}</nav>
</header>
${live ? '<div id="pending" class="pending" role="status" hidden></div>' : ""}
${page.notices.map((n) => `<p class="notice">${esc(n)}</p>`).join("")}
<main id="main" tabindex="-1">
<div class="page-head"><span class="eyebrow">${esc(eyebrow)}</span><h1>${esc(name)} <span class="id">${esc(LEVEL_LABEL[page.plan.level])}${period ? ` · ${esc(period)}` : ""}</span></h1>${quarters(page, state)}</div>
${back}
${body}
${state.drill ? "" : renderUnlinked(page)}
<h2>Code repos read</h2>
${list(reads)}
${page.warnings.length ? `<h2>Warnings</h2>${list(page.warnings.map((w) => esc(w.message)))}` : ""}
${page.problems.length ? `<h2>Files that won't load</h2>${list(page.problems.map((p) => esc(p)))}` : ""}
</main>
</div>
</div>
${shareDialog(page, !!opts.offline)}
`;
}

/** What's not linked yet: the words a person wrote, with no link behind them. Listed by name, with no line in the ladder and no figure. */
function renderUnlinked(page: AreaPage): string {
  if (!page.unlinked.length) return "";
  const items = page.unlinked.map((u) => {
    const href = u.kind === "key result" ? krHref(u.rel, u.id, page.period) : betHref(u.rel, u.id, page.period);
    return `<li><a href="${esc(href)}">${esc(u.id)}</a> (${esc(u.kind)}, ${esc(areaName(page, u.rel))}) — "${esc(u.text)}"</li>`;
  });
  return `<h2>Not linked yet</h2><div class="unlinked"><p class="meta">These say what they ladder up to in words, but no link backs them yet. They count in no figure. To see what each could link to, run nikos plan ladder &lt;id&gt;.</p><ul>${items.join("")}</ul></div>`;
}

/** The page title, as text: the area's name, then the product. The export puts it in the document's own title. */
export function planTitleText(page: AreaPage): string {
  return `${page.plan.name} · nikOS plan`;
}

/** The page title as HTML, for the dashboard server's document. */
export function planTitle(page: AreaPage): string {
  return esc(planTitleText(page));
}

/** One area's page as a whole HTML document, for the dashboard server. The token is the server's, for the saves. */
export function renderPlanPage(page: AreaPage, state: PageState, opts: { token: string }): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="nikos-token" content="${esc(opts.token)}">
<title>${planTitle(page)}</title><style>${STYLE}</style>${THEME_HEAD}</head>
<body>
${renderPlanBody(page, state, { live: true })}<script>
${LIVE_SCRIPT}
${SHARE_JS}
var hostEl = document.querySelector("[data-host]");
if (hostEl) hostEl.textContent = location.host;
</script></body></html>
`;
}
