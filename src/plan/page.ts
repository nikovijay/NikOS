// The planning dashboard's page for nikos plan serve: one area's pages (Key results, OKRs and bets, the
// ladder, Bets, Timeline) and the drill-downs from a key result or bet. The HTML is built here from the
// AreaPage that dashboard.ts reads. Every link is a plain ?at= URL that carries the quarter shown, so the
// place is in the URL. The live page adds save forms (check-ins, new bets) and a pending bar, which post to
// /api/op and the git buttons with the server's token. The offline export has neither.
import type { AreaLevel } from "../planning/model.js";
import type { BetDelivery } from "./delivery.js";
import type { AreaPage, BelowBet, BetRef, DashBet, DashKr, DrillBet, DrillMap, KrDrill, KrRef, UpChain, BetDrill } from "./dashboard.js";
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

/** How the page is rendered. The live page has save forms; the offline export has none. */
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
const betLink = (b: { rel: string; id: string }, period?: string) => `<a href="${esc(betHref(b.rel, b.id, period))}">${esc(b.id)}</a>`;

/** A bet's line in a list: its id linked to its drill-down, its outcome, owner and delivery. */
function betLine(b: BetRef | DashBet, period?: string, from?: string): string {
  const owner = b.owner ? `. Owner: ${esc(b.owner)}` : "";
  const where = from ? ` <span class="id">${esc(from)}</span>` : "";
  return `<li>${betLink(b, period)}${where} — ${esc(b.outcome)}${owner}. Delivery: ${esc(deliveryText(b.delivery))}</li>`;
}

export const STYLE = `:root{--bg:#fbfbf8;--fg:#1d1d1b;--muted:#6b6b66;--line:#dcdcd4;--card:#ffffff;--purple:#5b3fb0;--purple-bg:#efeafb;--green:#23663f;--green-bg:#e4f2e8;--grey:#5d5d58;--grey-bg:#eeeeea;--notice:#fff4d6;--notice-fg:#4a3800;--link:#2b59c3}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#171716;--fg:#ecebe6;--muted:#a3a39b;--line:#3a3a36;--card:#21211f;--purple:#c2b2f5;--purple-bg:#2d2840;--green:#94d6aa;--green-bg:#1f3428;--grey:#b8b8b0;--grey-bg:#2a2a27;--notice:#3a3014;--notice-fg:#ffe7a3;--link:#9bb8ff}}
:root[data-theme="dark"]{--bg:#171716;--fg:#ecebe6;--muted:#a3a39b;--line:#3a3a36;--card:#21211f;--purple:#c2b2f5;--purple-bg:#2d2840;--green:#94d6aa;--green-bg:#1f3428;--grey:#b8b8b0;--grey-bg:#2a2a27;--notice:#3a3014;--notice-fg:#ffe7a3;--link:#9bb8ff}
body{background:var(--bg);color:var(--fg);font-family:system-ui,sans-serif;margin:0 auto;max-width:72rem;padding:1rem;line-height:1.5;box-sizing:border-box}
a{color:var(--link)}
.top{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;justify-content:space-between}
.altitudes a,.altitudes span{display:inline-block;padding:.25rem .6rem;border:1px solid var(--line);border-radius:999px;margin-right:.25rem;text-decoration:none}
.altitudes a.on{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.altitudes span{color:var(--muted)}
.crumbs{margin:.75rem 0 .25rem;color:var(--muted)}
.quarters{margin:.25rem 0;color:var(--muted)}
.quarters .on{color:var(--fg);font-weight:600}
.views a{margin-right:.75rem}
.views a.on{font-weight:600}
.notice{background:var(--notice);color:var(--notice-fg);padding:.5rem .75rem;border-radius:.4rem}
.pending{background:var(--notice);color:var(--notice-fg);padding:.5rem .75rem;border-radius:.4rem;margin-bottom:.75rem}
.pending button,.save button{font:inherit;margin-left:.4rem;padding:.2rem .6rem}
.save{display:inline-flex;flex-wrap:wrap;gap:.4rem;align-items:center;margin:.25rem 0}
.save input{font:inherit;padding:.15rem .3rem;max-width:11rem}
.save-msg{color:var(--muted);font-size:.85rem}
.id{color:var(--muted);font-family:ui-monospace,monospace;font-size:.85em}
.meta{color:var(--muted);margin:.1rem 0}
h1{margin:.25rem 0}h2{margin-top:1.5rem;font-size:1.15rem}h3{font-size:1rem;margin:1rem 0 .25rem}
table{border-collapse:collapse;width:100%}th,td{text-align:left;border-bottom:1px solid var(--line);padding:.35rem .4rem;vertical-align:top}
.ladder-scroll{overflow-x:auto;padding-bottom:.5rem}
.ladder{position:relative}
.ladder svg{position:absolute;left:0;top:0;pointer-events:none;color:var(--muted)}
.ladder path{fill:none;stroke:currentColor;stroke-width:1.2;opacity:.7}
.colhead{position:absolute;top:0;font-size:.8rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.grouphead{position:absolute;font-size:.8rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cell{position:absolute;box-sizing:border-box;border-radius:.45rem;padding:.35rem .5rem;overflow:hidden;border:1px solid var(--line);background:var(--card)}
.cell .t{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}
.cell .m{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.8rem;color:var(--muted)}
.cell.above-kr,.cell.above-bet{background:var(--grey-bg);color:var(--grey)}
.cell.kr{background:var(--purple-bg);border-color:var(--purple)}
.cell.kr .m{color:var(--purple)}
.cell.bet{background:var(--green-bg);border-color:var(--green)}
.cell.bet .m{color:var(--green)}
.more{position:absolute;font-size:.85rem;color:var(--muted)}
.widen{margin:.5rem 0}
.widen a{margin-right:.75rem}
.card{border:1px solid var(--line);border-radius:.5rem;padding:.6rem .8rem;margin:.6rem 0;background:var(--card)}
ul{padding-left:1.2rem}
select{font:inherit;padding:.2rem .4rem;max-width:100%}
@media (max-width:40rem){body{padding:.75rem}}`;

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
  if (page.plan.level === "company" || !page.periods.length) return "";
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

/** The form that adds a bet in this area. Live page only. */
function betForm(page: AreaPage, live: boolean): string {
  if (!live) return "";
  return `<details class="card"><summary>Add a bet in ${esc(page.plan.name)}</summary><form class="save" data-op="bet.new" data-area="${esc(page.plan.rel)}" data-target="{}"><label>Id <input name="bet" required></label><label>Owner <input name="owner"></label><label>Hypothesis <input name="hypothesis"></label><label>Review on <input name="review_on" type="date"></label><label>Aims at <input name="primary" placeholder="key result id"></label><button type="submit">Add bet</button><span class="save-msg" role="status"></span></form></details>`;
}

/** The key results table: company and departments only. */
function renderKeys(page: AreaPage, live: boolean): string {
  if (!page.krs.length) return "<p>None yet.</p>";
  const rows = page.krs.map((k) => {
    const latest = k.kind === "milestone" ? (stepsLeft(k) ? `To do: ${stepsLeft(k)}` : "All steps done") : k.latest ? `${k.latest.value} on ${k.latest.date}` : "no check-ins";
    return `<tr><td><a href="${esc(krHref(k.rel, k.id, page.period))}">${esc(k.title)}</a> <span class="id">${esc(k.id)}</span></td><td>${esc(k.objective)}</td><td>${esc(k.owner)}</td><td>${esc(shareOf(k))}</td><td>${k.kind === "milestone" ? "steps" : `${esc(String(k.target))}${k.unit ? ` ${esc(k.unit)}` : ""}`}</td><td>${esc(latest)}${k.stale ? " · stale" : ""}</td><td>${esc(k.by)}</td><td>${checkinForm(k, live)}</td></tr>`;
  });
  return `<table><thead><tr><th>Key result</th><th>Objective</th><th>Owner</th><th>Progress</th><th>Target</th><th>Latest</th><th>By</th><th>Check in</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
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
      const lines = [...aimed.map((b) => betLine(b, page.period)), ...elsewhere.map((b) => betLine(b, page.period, b.rel))];
      parts.push(
        `<div class="card"><a href="${esc(krHref(k.rel, k.id, page.period))}">${esc(k.title)}</a> <span class="id">${esc(k.id)}</span><div class="meta">${esc(krMeta(k))}${k.aligns_to.length ? `. Aligns to ${esc(k.aligns_to.join(", "))}` : ""}</div>${checkinForm(k, live)}${
          lines.length ? `<ul>${lines.join("")}</ul>` : '<p class="meta">No bets aim at this yet.</p>'
        }</div>`,
      );
    }
    parts.push("</section>");
  }
  const loose = page.bets.filter((b) => !listed.has(b.id));
  const heading = own ? "Key results and the bets that aim at them" : "Key results its bets aim at";
  const body = parts.length ? parts.join("") : `<p class="meta">${own ? "No key results for this quarter yet." : "Its bets aim at no key results yet."}</p>`;
  return `<h2>${esc(heading)}</h2>${body}${loose.length ? `<h2>Bets that aim at no key result shown here</h2><ul>${loose.map((b) => betLine(b, page.period)).join("")}</ul>` : ""}`;
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
    ...krLink(a.rel, a, `${a.rel} · ${shareOf(a)} · ${a.owner}`, "above-kr"),
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
    inner: `<a class="t" href="${esc(betHref(b.rel, b.id, period))}">${esc(b.id)}</a><span class="m">${esc(deliveredBy(b.delivery))}</span>`,
  }));
  const aboveBetCells: Cell[] = page.aboveBets.map((a) => ({
    key: `above-bet:${a.rel}/${a.id}`,
    cls: "above-bet",
    inner: `<a class="t" href="${esc(betHref(a.rel, a.id, period))}">${esc(a.id)}</a><span class="m">${esc(`${a.rel} · ${a.owner}`)}</span>`,
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
function renderBelow(belowBets: BelowBet[], period?: string): string {
  if (!belowBets.length) return "<p>None below this area yet.</p>";
  const how = (b: BelowBet) => (b.how === "child" ? `Below ${b.of}` : aimText(b.how, b.of));
  return `<h2>Below this area</h2><ul>${belowBets.map((b) => `<li>${betLink(b, period)} (${esc(b.rel)}) — ${esc(b.outcome)}. ${esc(how(b))}. Delivery: ${esc(deliveryText(b.delivery))}</li>`).join("")}</ul>`;
}

/** The ladder page: the widen links, the ladder, and what widened below. */
function renderLadderPage(page: AreaPage, state: PlanView): string {
  return `${renderWiden(page, state)}${renderLadder(page, state)}${state.widen.down ? renderBelow(page.belowBets, page.period) : ""}`;
}

function renderBets(page: AreaPage, live: boolean): string {
  const form = betForm(page, live);
  if (!page.bets.length) return `${form}<p>None yet.</p>`;
  const body = page.bets
    .map((b: DashBet) => {
      const facts: string[] = [];
      if (b.owner) facts.push(`<li>Owner: ${esc(b.owner)}</li>`);
      if (b.team) facts.push(`<li>Team: ${esc(b.team)}</li>`);
      if (b.hypothesis) facts.push(`<li>Hypothesis: ${esc(b.hypothesis)}</li>`);
      if (b.review_on) facts.push(`<li>Review on ${esc(b.review_on)}</li>`);
      const aims = [b.krs.primary, ...b.krs.also].filter((x): x is string => !!x);
      if (aims.length) facts.push(`<li>Aims at ${aims.map((id) => `<a href="${esc(krHref(page.plan.rel, id, page.period))}">${esc(id)}</a>`).join(", ")}</li>`);
      if (b.aligns_to.length) facts.push(`<li>Aligns to ${b.aligns_to.map((x) => betLink(x, page.period)).join(", ")}</li>`);
      facts.push(`<li>Delivery: ${esc(deliveryText(b.delivery))}</li>`);
      if (b.stories.length) facts.push(`<li>Stories: ${b.stories.map((s) => `${esc(s.id)} (${esc(s.status ?? "no summary yet")})`).join(", ")}</li>`);
      return `<article class="card"><h3>${betLink(b, page.period)} <span class="id">${esc(b.rel)}</span></h3><p>${esc(b.outcome)}</p><ul>${facts.join("")}</ul></article>`;
    })
    .join("");
  return `${form}${body}`;
}

function renderTimeline(page: AreaPage): string {
  const dated: { date: string; what: string; item: string; href: string; rel: string }[] = [];
  for (const b of page.bets) {
    const item = `${b.id} — ${b.outcome}`;
    const href = betHref(b.rel, b.id, page.period);
    if (b.starts) dated.push({ date: b.starts, what: "Starts", item, href, rel: b.rel });
    if (b.review_on) dated.push({ date: b.review_on, what: "Review", item, href, rel: b.rel });
    if (b.deadline) dated.push({ date: b.deadline, what: "Deadline", item, href, rel: b.rel });
  }
  for (const k of page.krs) if (k.by) dated.push({ date: k.by, what: "Key result due", item: `${k.id} — ${k.title}`, href: krHref(k.rel, k.id, page.period), rel: k.rel });
  if (!dated.length) return "<p>No dated items yet.</p>";
  dated.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.item.localeCompare(b.item)));
  const rows = dated.map((d) => `<tr><td>${esc(d.date)}</td><td>${esc(d.what)}</td><td><a href="${esc(d.href)}">${esc(d.item)}</a></td><td>${esc(d.rel)}</td></tr>`);
  return `<table><thead><tr><th>Date</th><th>What</th><th>Item</th><th>Area</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

/** A text-only item's line on its own drill-down: what it says, and that no figure counts it. Nothing once a link backs it. */
const notLinkedLine = (text?: string) => (text ? `<p class="meta">Not linked yet: "${esc(text)}". It counts in no figure.</p>` : "");

function renderKrDrill(d: KrDrill, period?: string): string {
  const k = d.kr;
  const head = `<h2>Key result: ${esc(k.title)}</h2><p class="meta"><span class="id">${esc(k.id)}</span> in ${esc(k.rel)} · ${esc(k.kind === "milestone" ? stepsOf(k) : `${pct(k.progress)}, ${checkinOf(k)}`)}${k.stale ? " · stale" : ""}</p>${notLinkedLine(k.laddersUp)}`;
  if (!d.areas.length) return `${head}<p>No bets aim at this key result yet.</p>`;
  const areas = d.areas.map((a) => {
    const items = a.bets.map((b: DrillBet) => {
      const maps = b.maps.length ? `<ul>${b.maps.map((m) => `<li>${esc(mapText(m))}</li>`).join("")}</ul>` : "";
      return `<li>${betLink({ id: b.id, rel: b.rel }, period)} — ${esc(b.outcome)}. ${esc(aimText(b.aims, k.id))}. Delivery: ${esc(deliveryText(b.delivery))}${maps}</li>`;
    });
    return `<h3>${esc(a.name)} <span class="id">${esc(a.rel)}</span></h3><ul>${items.join("")}</ul>`;
  });
  return `${head}${areas.join("")}`;
}

function renderBetDrill(d: BetDrill, up: UpChain, period?: string): string {
  const b = d.bet;
  const head = `<h2>Bet: ${esc(b.id)}</h2><p>${esc(b.outcome)}</p><p class="meta">In ${esc(b.rel)}${b.owner ? ` · Owner: ${esc(b.owner)}` : ""}</p><p>Delivery: ${esc(deliveryText(b.delivery))}</p>${notLinkedLine(b.laddersUp)}`;
  const maps = d.maps.length ? `<h3>Story maps that deliver it</h3><ul>${d.maps.map((m) => `<li>${esc(mapText(m))}</li>`).join("")}</ul>` : "";
  const chain = up.levels.length
    ? up.levels.map((lvl) => `<h3>${lvl.depth === 1 ? "Aligns to" : `Level ${lvl.depth} up`}</h3><ul>${lvl.bets.map((x) => `<li>${betLink(x, period)} (${esc(x.rel)}) — ${esc(x.outcome)}</li>`).join("")}</ul>`).join("")
    : "<h3>Aligns to</h3><p>Nothing above it.</p>";
  const below = d.children.length
    ? `<h3>Below it</h3><ul>${d.children.map((c) => `<li>${betLink({ id: c.id, rel: c.rel }, period)} (${esc(c.rel)}) — ${esc(c.outcome)}. Delivery: ${esc(deliveryText(c.delivery))}</li>`).join("")}</ul>`
    : "";
  return `${head}${maps}<h2>Up the chain</h2>${chain}${below}`;
}

/** The save bar, the script and the token, for the live page only. The script posts with the token and nothing else. */
const LIVE_SCRIPT = `(function () {
var meta = document.querySelector('meta[name="nikos-token"]');
var token = meta ? meta.getAttribute("content") : "";
var bar = document.getElementById("pending");
function call(method, path, body) {
  var init = { method: method, headers: { "content-type": "application/json", "x-nikos-token": token }, credentials: "same-origin" };
  if (body !== undefined) init.body = JSON.stringify(body);
  return fetch(path, init).then(function (r) {
    return r.json().then(function (j) { return { ok: r.ok, body: j }; }, function () { return { ok: r.ok, body: {} }; });
  });
}
function errorOf(res) { return res.body && res.body.error ? res.body.error : "Something went wrong."; }
function gone() { return "Couldn't reach the dashboard. Is nikos plan serve still running?"; }
function pendingBar() {
  call("GET", "/api/pending").then(function (res) {
    if (!bar) return;
    bar.textContent = "";
    if (!res.ok) { bar.hidden = false; bar.textContent = errorOf(res); return; }
    var files = res.body.files || [];
    if (!files.length) { bar.hidden = true; return; }
    bar.hidden = false;
    var text = document.createElement("span");
    text.textContent = files.length + (files.length === 1 ? " saved change" : " saved changes") + (res.body.branch ? " on " + res.body.branch : "") + ". Nothing is pushed until you press Push. ";
    bar.appendChild(text);
    var msg = document.createElement("span");
    msg.className = "save-msg";
    bar.appendChild(button("Commit", "/api/git/commit", msg));
    if (res.body.branch && res.body.hasOrigin) bar.appendChild(button("Push", "/api/git/push", msg));
    bar.appendChild(msg);
  }, function () { if (bar) { bar.hidden = false; bar.textContent = gone(); } });
}
function button(label, path, msg) {
  var b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", function () {
    b.disabled = true;
    msg.textContent = "Working…";
    call("POST", path, {}).then(function (res) {
      if (!res.ok) { msg.textContent = errorOf(res); b.disabled = false; return; }
      msg.textContent = res.body.committed ? "Committed " + String(res.body.committed).slice(0, 7) : res.body.pushed ? "Pushed " + res.body.pushed : "Done";
      pendingBar();
    }, function () { msg.textContent = gone(); b.disabled = false; });
  });
  return b;
}
document.addEventListener("submit", function (e) {
  var form = e.target;
  if (!form || !form.getAttribute || form.getAttribute("data-op") === null) return;
  e.preventDefault();
  var out = form.querySelector(".save-msg");
  var target = JSON.parse(form.getAttribute("data-target") || "{}");
  var args = {};
  var fields = form.querySelectorAll("input[name], select[name]");
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var v = f.value.trim();
    if (f.name === "bet") { target.bet = v; continue; }
    if (v === "") continue;
    args[f.name] = f.type === "number" ? Number(v) : v;
  }
  if (out) out.textContent = "Saving…";
  call("POST", "/api/op", { op: form.getAttribute("data-op"), area: form.getAttribute("data-area"), target: target, args: args, expect: form.getAttribute("data-expect") || "" }).then(function (res) {
    if (out) out.textContent = res.ok ? res.body.message + (res.body.branch ? " on " + res.body.branch : "") : errorOf(res);
    // Saved: show the message for a moment, then load the page again so its figures and versions are the new ones.
    if (res.ok) setTimeout(function () { location.reload(); }, 800);
  }, function () { if (out) out.textContent = gone(); });
});
pendingBar();
})();`;

/** What the page renders: the live page's forms and bar, or none for the offline export. */
export interface RenderBodyOptions extends PlanRenderOptions {
  /** The offline export's picker moves the page itself, so it has no script of its own. */
  offline?: boolean;
}

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
    ? `<h2>Areas below this</h2><ul>${below.map((n) => `<li><a href="${esc(hrefOf({ at: n.rel, period: periodFor(n.rel, page.period) }))}">${esc(n.name)}</a> <span class="id">${esc(n.rel)}</span></li>`).join("")}</ul>`
    : "";
  let body: string;
  if (state.drill?.kind === "kr") body = renderKrDrill(state.drill.kr, page.period);
  else if (state.drill?.kind === "bet") body = renderBetDrill(state.drill.bet, state.drill.up, page.period);
  else if (current === "keys") body = renderKeys(page, live);
  else if (current === "okrs") body = renderOkrs(page, live);
  else if (current === "ladder") body = renderLadderPage(page, state.view);
  else if (current === "bets") body = renderBets(page, live);
  else body = renderTimeline(page);
  const back = state.drill ? `<p><a href="${esc(hrefOf({ at: page.plan.rel, view: current, period: page.period }))}">Back to ${esc(name)}</a></p>` : "";
  const reads = page.repos.map((r) => `<li>${esc(repoLabel(r))}: ${esc(r.age)}</li>`);
  const list = (items: string[]) => (items.length ? `<ul>${items.join("")}</ul>` : "<p>None yet.</p>");
  return `<header class="top">
<nav class="altitudes" aria-label="Altitude">${altitudes(page)}</nav>
<div>${picker(page, !!opts.offline)}</div>
</header>
<nav class="crumbs" aria-label="Breadcrumb">${crumbs(page)}</nav>
${quarters(page, state)}
<h1>${esc(name)} <span class="id">${esc(LEVEL_LABEL[page.plan.level])}${period ? ` · ${esc(period)}` : ""}</span></h1>
${page.notices.map((n) => `<p class="notice">${esc(n)}</p>`).join("")}
${subs}
${state.drill ? "" : `<nav class="views" aria-label="Views">${viewLinks}</nav>`}
${back}
${body}
${state.drill ? "" : renderUnlinked(page)}
<h2>Code repos read</h2>
${list(reads)}
${page.warnings.length ? `<h2>Warnings</h2>${list(page.warnings.map((w) => esc(w.message)))}` : ""}
${page.problems.length ? `<h2>Files that won't load</h2>${list(page.problems.map((p) => esc(p)))}` : ""}
`;
}

/** What's not linked yet: the words a person wrote, with no link behind them. Listed by name, with no line in the ladder and no figure. */
function renderUnlinked(page: AreaPage): string {
  if (!page.unlinked.length) return "";
  const items = page.unlinked.map((u) => {
    const href = u.kind === "key result" ? krHref(u.rel, u.id, page.period) : betHref(u.rel, u.id, page.period);
    return `<li><a href="${esc(href)}">${esc(u.id)}</a> (${esc(u.kind)}, ${esc(u.rel)}) — "${esc(u.text)}"</li>`;
  });
  return `<h2>Not linked yet</h2><p class="meta">These say what they ladder up to in words, but no link backs them yet. They count in no figure. To see what each could link to, run nikos plan ladder &lt;id&gt;.</p><ul>${items.join("")}</ul>`;
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
<title>${planTitle(page)}</title><style>${STYLE}</style></head>
<body>
<div id="pending" class="pending" role="status" hidden></div>
${renderPlanBody(page, state, { live: true })}<script>
${LIVE_SCRIPT}
</script></body></html>
`;
}
