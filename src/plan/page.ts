// The planning dashboard's page for nikos plan serve: one area's pages (Key results, OKRs and bets, the
// ladder, Bets, Timeline) and the drill-downs from a key result or bet. The HTML is built here from the
// AreaPage that dashboard.ts reads. Every link is a plain ?at= URL, so the place is in the URL, and the
// page needs no script except the area picker's one line.
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

const pct = (p: number) => (Number.isFinite(p) ? `${Math.round(p * 100)}%` : "no progress yet");
const checkinOf = (k: KrRef) => (k.latest ? `last ${k.latest.value} on ${k.latest.date}` : "no check-ins");
const krMeta = (k: DashKr) => `${pct(k.progress)} toward ${k.target}${k.unit ? ` ${k.unit}` : ""}, ${checkinOf(k)}${k.stale ? " · stale" : ""}`;

/** A bet's delivery in words, as plan status says it: its own figures, or each bet below that has maps. */
export function deliveryText(d: BetDelivery | undefined): string {
  if (!d) return "no story map names this bet yet";
  if (d.source === "own" && d.delivery) return `${figuresText(d.delivery)}${readsText(d.reads)}`;
  if (d.source === "via") return `${d.via.map((v) => `via ${v.bet}: ${figuresText(v.delivery)}`).join("; ")}${readsText(d.reads)}`;
  return "no story map names this bet yet";
}

/** The ladder's short word for a bet's delivery: its own, delivered through the bets below, or none yet. */
function deliveredBy(d: BetDelivery | undefined): string {
  if (d?.source === "own") return "Own bet";
  if (d?.source === "via") return `Delivered via ${d.via.map((v) => v.bet).join(", ")}`;
  return "Own bet · no story map yet";
}

const aimOf = { primary: "Aims at it", also: "Also aims at it", via: "Through a bet below" } as const;
const mapText = (m: DrillMap) => `${repoLabel(m)} · ${m.key}${m.owner ? ` · owner ${m.owner}` : ""}${m.title ? ` · ${m.title}` : ""} · read ${m.age}`;

const betHref = (rel: string, id: string) => hrefOf({ at: rel, bet: id });
const krHref = (rel: string, id: string) => hrefOf({ at: rel, kr: id });
const betLink = (b: BetRef) => `<a href="${esc(betHref(b.rel, b.id))}">${esc(b.id)}</a>`;

/** A bet's line in a list: its id linked to its drill-down, its outcome, owner and delivery. */
function betLine(b: BetRef | DashBet): string {
  const owner = b.owner ? `. Owner: ${esc(b.owner)}` : "";
  return `<li>${betLink(b)} — ${esc(b.outcome)}${owner}. Delivery: ${esc(deliveryText(b.delivery))}</li>`;
}

const STYLE = `:root{--bg:#fbfbf8;--fg:#1d1d1b;--muted:#6b6b66;--line:#dcdcd4;--card:#ffffff;--purple:#5b3fb0;--purple-bg:#efeafb;--green:#23663f;--green-bg:#e4f2e8;--grey:#5d5d58;--grey-bg:#eeeeea;--notice:#fff4d6;--notice-fg:#4a3800;--link:#2b59c3}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#171716;--fg:#ecebe6;--muted:#a3a39b;--line:#3a3a36;--card:#21211f;--purple:#c2b2f5;--purple-bg:#2d2840;--green:#94d6aa;--green-bg:#1f3428;--grey:#b8b8b0;--grey-bg:#2a2a27;--notice:#3a3014;--notice-fg:#ffe7a3;--link:#9bb8ff}}
:root[data-theme="dark"]{--bg:#171716;--fg:#ecebe6;--muted:#a3a39b;--line:#3a3a36;--card:#21211f;--purple:#c2b2f5;--purple-bg:#2d2840;--green:#94d6aa;--green-bg:#1f3428;--grey:#b8b8b0;--grey-bg:#2a2a27;--notice:#3a3014;--notice-fg:#ffe7a3;--link:#9bb8ff}
body{background:var(--bg);color:var(--fg);font-family:system-ui,sans-serif;margin:0 auto;max-width:72rem;padding:1rem;line-height:1.5;box-sizing:border-box}
a{color:var(--link)}
.top{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;justify-content:space-between}
.altitudes a,.altitudes span{display:inline-block;padding:.25rem .6rem;border:1px solid var(--line);border-radius:999px;margin-right:.25rem;text-decoration:none}
.altitudes a.on{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.altitudes span{color:var(--muted)}
.crumbs{margin:.75rem 0 .25rem;color:var(--muted)}
.views a{margin-right:.75rem}
.views a.on{font-weight:600}
.notice{background:var(--notice);color:var(--notice-fg);padding:.5rem .75rem;border-radius:.4rem}
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
    return `<a href="${esc(hrefOf({ at: at.rel }))}"${current}>${esc(ALTITUDE_LABEL[level])}</a>`;
  }).join("");
}

/** The area picker for the chosen altitude: choosing an area goes to its page. */
function picker(page: AreaPage): string {
  const options = page.tree
    .filter((n) => n.level === page.plan.level)
    .map((n) => `<option value="${esc(hrefOf({ at: n.rel }))}"${n.rel === page.plan.rel ? " selected" : ""}>${esc(n.level === "team" ? `${n.name} (${n.id})` : n.name)}</option>`)
    .join("");
  return `<label>${esc(LEVEL_LABEL[page.plan.level])} <select onchange="location.href=this.value">${options}</select></label>`;
}

/** The breadcrumb: Company, then each area above this one. Each part links to its area. */
function crumbs(page: AreaPage): string {
  return page.breadcrumb.map((c) => `<a href="${esc(hrefOf({ at: c.rel }))}">${esc(c.label)}</a>`).join(" › ");
}

/** The key results table: company and departments only. */
function renderKeys(page: AreaPage): string {
  if (!page.krs.length) return "<p>None yet.</p>";
  const rows = page.krs.map((k) => {
    const latest = k.latest ? `${k.latest.value} on ${k.latest.date}` : "no check-ins";
    return `<tr><td><a href="${esc(krHref(k.rel, k.id))}">${esc(k.title)}</a> <span class="id">${esc(k.id)}</span></td><td>${esc(k.objective)}</td><td>${esc(k.owner)}</td><td>${esc(pct(k.progress))}</td><td>${esc(String(k.target))}${k.unit ? ` ${esc(k.unit)}` : ""}</td><td>${esc(latest)}${k.stale ? " · stale" : ""}</td><td>${esc(k.by)}</td></tr>`;
  });
  return `<table><thead><tr><th>Key result</th><th>Objective</th><th>Owner</th><th>Progress</th><th>Target</th><th>Latest</th><th>By</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

/** The OKRs and bets: each objective with its key results, and the bets that aim at each one. */
function renderOkrs(page: AreaPage): string {
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
      parts.push(
        `<div class="card"><a href="${esc(krHref(k.rel, k.id))}">${esc(k.title)}</a> <span class="id">${esc(k.id)}</span><div class="meta">${esc(krMeta(k))}${k.aligns_to.length ? `. Aligns to ${esc(k.aligns_to.join(", "))}` : ""}</div>${
          aimed.length ? `<ul>${aimed.map(betLine).join("")}</ul>` : '<p class="meta">No bets aim at this yet.</p>'
        }</div>`,
      );
    }
    parts.push("</section>");
  }
  const loose = page.bets.filter((b) => !listed.has(b.id));
  const heading = own ? "Key results and the bets that aim at them" : "Key results its bets aim at";
  const body = parts.length ? parts.join("") : `<p class="meta">${own ? "No key results for this quarter yet." : "Its bets aim at no key results yet."}</p>`;
  return `<h2>${esc(heading)}</h2>${body}${loose.length ? `<h2>Bets that aim at no key result shown here</h2><ul>${loose.map(betLine).join("")}</ul>` : ""}`;
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

function renderLadder(page: AreaPage, state: PlanView): string {
  const placed = new Map<string, Placed>();
  const cap = state.more ? Infinity : CAP;
  const krLink = (rel: string, k: { id: string; title: string }, meta: string, cls: string) =>
    ({ cls, inner: `<a class="t" href="${esc(krHref(rel, k.id))}">${esc(k.title)}</a><span class="m">${esc(meta)}</span>` });

  const aboveKrCells: Cell[] = page.aboveKrs.map((a) => ({
    key: `above-kr:${a.rel}/${a.id}`,
    ...krLink(a.rel, a, `${a.rel} · ${pct(a.progress)} · ${a.owner}`, "above-kr"),
  }));
  const krGroups = new Map<string, Cell[]>();
  for (const k of page.krs) {
    const cell: Cell = { key: `kr:${k.id}`, ...krLink(k.rel, k, `${pct(k.progress)} ${page.period ? "this period" : "toward target"}`, "kr") };
    krGroups.set(k.objective, [...(krGroups.get(k.objective) ?? []), cell]);
  }
  const krColumn: Group[] = [...krGroups].map(([head, cells]) => ({ ...(head ? { head } : {}), cells }));
  const betCells: Cell[] = page.bets.map((b) => ({
    key: `bet:${b.id}`,
    cls: "bet",
    inner: `<a class="t" href="${esc(betHref(b.rel, b.id))}">${esc(b.id)}</a><span class="m">${esc(deliveredBy(b.delivery))}</span>`,
  }));
  const aboveBetCells: Cell[] = page.aboveBets.map((a) => ({
    key: `above-bet:${a.rel}/${a.id}`,
    cls: "above-bet",
    inner: `<a class="t" href="${esc(betHref(a.rel, a.id))}">${esc(a.id)}</a><span class="m">${esc(`${a.rel} · ${a.owner}`)}</span>`,
  }));

  const columns = [
    stackColumn(0, [{ cells: aboveKrCells }], cap, placed),
    stackColumn(1, krColumn, cap, placed),
    stackColumn(2, [{ cells: betCells }], cap, placed),
    stackColumn(3, [{ cells: aboveBetCells }], cap, placed),
  ];
  // Each link runs from the left column's cell to the right one's, drawn as a curve.
  const links: [string, string][] = [];
  for (const k of page.krs) for (const a of k.above) links.push([`above-kr:${a.rel}/${a.id}`, `kr:${k.id}`]);
  for (const b of page.bets) for (const id of [b.krs.primary, ...b.krs.also]) if (id) links.push([`kr:${id}`, `bet:${b.id}`]);
  for (const b of page.bets) for (const a of b.aligns_to) links.push([`bet:${b.id}`, `above-bet:${a.rel}/${a.id}`]);
  const paths: string[] = [];
  for (const [from, to] of links) {
    const a = placed.get(from);
    const b = placed.get(to);
    if (!a || !b) continue;
    const [left, right] = a.col < b.col ? [a, b] : [b, a];
    const sx = left.x + W, sy = left.y + CH / 2, ex = right.x, ey = right.y + CH / 2;
    paths.push(`<path d="M${sx} ${sy} C${sx + G / 2} ${sy}, ${ex - G / 2} ${ey}, ${ex} ${ey}"/>`);
  }

  const heads = ["Above key results", page.period ? `This area's key results · ${page.period}` : "This area's key results", "This area's bets", "Above bets"];
  const headHtml = heads.map((h, i) => `<div class="colhead" style="left:${i * (W + G)}px;width:${W}px">${esc(h)}</div>`).join("");
  const width = 4 * W + 3 * G;
  const height = Math.max(...columns.map((c) => c.height)) + 4;
  const more = columns.map((c, i) => (c.hidden ? `<div class="more" style="left:${i * (W + G)}px;top:${height}px;width:${W}px">+${c.hidden} more · <a href="${esc(hrefOf({ at: page.plan.rel, view: "ladder", widen: widenParam(state.widen), more: "all" }))}">show all</a></div>` : "")).join("");
  const hidden = columns.some((c) => c.hidden > 0);
  return `<div class="ladder-scroll"><div class="ladder" style="width:${width}px;height:${height + (hidden ? 22 : 0)}px"><svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">${paths.join("")}</svg>${headHtml}${columns.map((c) => c.html.join("")).join("")}${more}</div></div>`;
}

/** The widen value a query carries: up, down or all, or none. */
function widenParam(w: { up: boolean; down: boolean }): string | undefined {
  return w.up && w.down ? "all" : w.up ? "up" : w.down ? "down" : undefined;
}

function renderWiden(page: AreaPage, state: PlanView): string {
  const base = { at: page.plan.rel, view: "ladder", more: state.more ? "all" : undefined };
  const up = { up: !state.widen.up, down: state.widen.down };
  const down = { up: state.widen.up, down: !state.widen.down };
  const upLabel = state.widen.up ? "Hide the levels above" : "Show everything above";
  const downLabel = state.widen.down ? "Hide the levels below" : "Show everything below";
  return `<p class="widen"><a href="${esc(hrefOf({ ...base, widen: widenParam(up) }))}">${upLabel}</a><a href="${esc(hrefOf({ ...base, widen: widenParam(down) }))}">${downLabel}</a></p>`;
}

/** The bets below this area, when it widened down: each with how it delivers the area's bets or key results. */
function renderBelow(belowBets: BelowBet[]): string {
  if (!belowBets.length) return "<p>None below this area yet.</p>";
  const how = (b: BelowBet) => (b.how === "child" ? `Below ${b.of}` : `${aimOf[b.how]} ${b.of}`);
  return `<h2>Below this area</h2><ul>${belowBets.map((b) => `<li>${betLink(b)} (${esc(b.rel)}) — ${esc(b.outcome)}. ${esc(how(b))}. Delivery: ${esc(deliveryText(b.delivery))}</li>`).join("")}</ul>`;
}

/** The ladder page: the widen links, the ladder, and what widened below. */
function renderLadderPage(page: AreaPage, state: PlanView): string {
  return `${renderWiden(page, state)}${renderLadder(page, state)}${state.widen.down ? renderBelow(page.belowBets) : ""}`;
}

function renderBets(page: AreaPage): string {
  if (!page.bets.length) return "<p>None yet.</p>";
  return page.bets
    .map((b: DashBet) => {
      const facts: string[] = [];
      if (b.owner) facts.push(`<li>Owner: ${esc(b.owner)}</li>`);
      if (b.team) facts.push(`<li>Team: ${esc(b.team)}</li>`);
      if (b.hypothesis) facts.push(`<li>Hypothesis: ${esc(b.hypothesis)}</li>`);
      if (b.review_on) facts.push(`<li>Review on ${esc(b.review_on)}</li>`);
      const aims = [b.krs.primary, ...b.krs.also].filter((x): x is string => !!x);
      if (aims.length) facts.push(`<li>Aims at ${aims.map((id) => `<a href="${esc(krHref(page.plan.rel, id))}">${esc(id)}</a>`).join(", ")}</li>`);
      if (b.aligns_to.length) facts.push(`<li>Aligns to ${b.aligns_to.map(betLink).join(", ")}</li>`);
      facts.push(`<li>Delivery: ${esc(deliveryText(b.delivery))}</li>`);
      if (b.stories.length) facts.push(`<li>Stories: ${b.stories.map((s) => `${esc(s.id)} (${esc(s.status ?? "no summary yet")})`).join(", ")}</li>`);
      return `<article class="card"><h3>${betLink(b)} <span class="id">${esc(b.rel)}</span></h3><p>${esc(b.outcome)}</p><ul>${facts.join("")}</ul></article>`;
    })
    .join("");
}

function renderTimeline(page: AreaPage): string {
  const dated: { date: string; what: string; item: string; href: string; rel: string }[] = [];
  for (const b of page.bets) {
    const item = `${b.id} — ${b.outcome}`;
    const href = betHref(b.rel, b.id);
    if (b.starts) dated.push({ date: b.starts, what: "Starts", item, href, rel: b.rel });
    if (b.review_on) dated.push({ date: b.review_on, what: "Review", item, href, rel: b.rel });
    if (b.deadline) dated.push({ date: b.deadline, what: "Deadline", item, href, rel: b.rel });
  }
  for (const k of page.krs) if (k.by) dated.push({ date: k.by, what: "Key result due", item: `${k.id} — ${k.title}`, href: krHref(k.rel, k.id), rel: k.rel });
  if (!dated.length) return "<p>No dated items yet.</p>";
  dated.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.item.localeCompare(b.item)));
  const rows = dated.map((d) => `<tr><td>${esc(d.date)}</td><td>${esc(d.what)}</td><td><a href="${esc(d.href)}">${esc(d.item)}</a></td><td>${esc(d.rel)}</td></tr>`);
  return `<table><thead><tr><th>Date</th><th>What</th><th>Item</th><th>Area</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function renderKrDrill(d: KrDrill): string {
  const k = d.kr;
  const head = `<h2>Key result: ${esc(k.title)}</h2><p class="meta"><span class="id">${esc(k.id)}</span> in ${esc(k.rel)} · ${esc(pct(k.progress))}, ${esc(checkinOf(k))}${k.stale ? " · stale" : ""}</p>`;
  if (!d.areas.length) return `${head}<p>No bets aim at this key result yet.</p>`;
  const areas = d.areas.map((a) => {
    const items = a.bets.map((b: DrillBet) => {
      const maps = b.maps.length ? `<ul>${b.maps.map((m) => `<li>${esc(mapText(m))}</li>`).join("")}</ul>` : "";
      return `<li>${betLink({ id: b.id, rel: b.rel, outcome: b.outcome, owner: "", stories: [] })} — ${esc(b.outcome)}. ${esc(aimOf[b.aims])}. Delivery: ${esc(deliveryText(b.delivery))}${maps}</li>`;
    });
    return `<h3>${esc(a.name)} <span class="id">${esc(a.rel)}</span></h3><ul>${items.join("")}</ul>`;
  });
  return `${head}${areas.join("")}`;
}

function renderBetDrill(d: BetDrill, up: UpChain): string {
  const b = d.bet;
  const head = `<h2>Bet: ${esc(b.id)}</h2><p>${esc(b.outcome)}</p><p class="meta">In ${esc(b.rel)}${b.owner ? ` · Owner: ${esc(b.owner)}` : ""}</p><p>Delivery: ${esc(deliveryText(b.delivery))}</p>`;
  const maps = d.maps.length ? `<h3>Story maps that deliver it</h3><ul>${d.maps.map((m) => `<li>${esc(mapText(m))}</li>`).join("")}</ul>` : "";
  const chain = up.levels.length
    ? up.levels.map((lvl) => `<h3>${lvl.depth === 1 ? "Aligns to" : `Level ${lvl.depth} up`}</h3><ul>${lvl.bets.map((x) => `<li>${betLink(x)} (${esc(x.rel)}) — ${esc(x.outcome)}</li>`).join("")}</ul>`).join("")
    : "<h3>Aligns to</h3><p>Nothing above it.</p>";
  const below = d.children.length
    ? `<h3>Below it</h3><ul>${d.children.map((c) => `<li>${betLink({ id: c.id, rel: c.rel, outcome: c.outcome, owner: "", stories: [] })} (${esc(c.rel)}) — ${esc(c.outcome)}. Delivery: ${esc(deliveryText(c.delivery))}</li>`).join("")}</ul>`
    : "";
  return `${head}${maps}<h2>Up the chain</h2>${chain}${below}`;
}

/** One area's page. The view shows the area; a drill-down (kr or bet) replaces the view with its page. */
export function renderPlanPage(page: AreaPage, state: PageState): string {
  const name = page.plan.name;
  const period = page.period ?? page.plan.period;
  const views = viewsFor(page.plan.level);
  const current = state.view.view;
  const viewLinks = views
    .map((v) => `<a href="${esc(hrefOf({ at: page.plan.rel, view: v }))}"${v === current && !state.drill ? ' class="on" aria-current="page"' : ""}>${esc(VIEW_LABEL[v])}</a>`)
    .join("");
  const below = page.tree.filter((n) => n.parent === page.plan.rel);
  const subs = below.length
    ? `<h2>Below this</h2><ul>${below.map((n) => `<li><a href="${esc(hrefOf({ at: n.rel }))}">${esc(n.name)}</a> <span class="id">${esc(n.rel)}</span></li>`).join("")}</ul>`
    : "";
  let body: string;
  if (state.drill?.kind === "kr") body = renderKrDrill(state.drill.kr);
  else if (state.drill?.kind === "bet") body = renderBetDrill(state.drill.bet, state.drill.up);
  else if (current === "keys") body = renderKeys(page);
  else if (current === "okrs") body = renderOkrs(page);
  else if (current === "ladder") body = renderLadderPage(page, state.view);
  else if (current === "bets") body = renderBets(page);
  else body = renderTimeline(page);
  const back = state.drill ? `<p><a href="${esc(hrefOf({ at: page.plan.rel, view: current }))}">Back to ${esc(name)}</a></p>` : "";
  const reads = page.repos.map((r) => `<li>${esc(repoLabel(r))}: ${esc(r.age)}</li>`);
  const list = (items: string[]) => (items.length ? `<ul>${items.join("")}</ul>` : "<p>None yet.</p>");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)} · nikOS plan</title><style>${STYLE}</style></head>
<body>
<header class="top">
<nav class="altitudes" aria-label="Altitude">${altitudes(page)}</nav>
<div>${picker(page)}</div>
</header>
<nav class="crumbs" aria-label="Breadcrumb">${crumbs(page)}</nav>
<h1>${esc(name)} <span class="id">${esc(LEVEL_LABEL[page.plan.level])}${period ? ` · ${esc(period)}` : ""}</span></h1>
${page.notices.map((n) => `<p class="notice">${esc(n)}</p>`).join("")}
${subs}
${state.drill ? "" : `<nav class="views" aria-label="Views">${viewLinks}</nav>`}
${back}
${body}
<h2>Code repos read</h2>
${list(reads)}
${page.warnings.length ? `<h2>Warnings</h2>${list(page.warnings.map((w) => esc(w.message)))}` : ""}
${page.problems.length ? `<h2>Files that won't load</h2>${list(page.problems.map((p) => esc(p)))}` : ""}
</body></html>
`;
}
