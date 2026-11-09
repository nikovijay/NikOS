// The dashboard page: one HTML file with the data embedded as JSON. Inline CSS and vanilla
// JS draw the views, so the live dashboard and the offline export are the same page. A
// read-only render leaves out the save code and the token altogether.
import { esc } from "../commands/map.js";
import * as rules from "./rules.js";

const CSS = `
:root {
  color-scheme: light dark;
  --bg: #F5F5F2; --surface: #FFFFFF; --surface-2: #FAFAF8; --sunken: #EFEFEB;
  --ink: #17191A; --ink-2: #3E4347; --muted: #5B6267; --faint: #8A9196;
  --line: #E2E3DE; --line-2: #C9CBC5;
  --accent: #12733F; --accent-ink: #0B5A30; --accent-soft: #E3F1E8; --on-accent: #FFFFFF;
  --kr: #4A3FB5; --kr-soft: #EFEEFC; --kr-line: #B9B2EE;
  --up: #57534A; --up-soft: #F2F0EA; --up-line: #CFC9BB;
  --amber: #8A5300; --amber-soft: #FCF1DB; --blue: #1C5AA6; --blue-soft: #E6EEF9; --red: #A1301C; --red-soft: #FBEAE6;
  --focus: #1C5AA6; --shadow: 0 1px 2px rgba(23,25,26,.05), 0 1px 1px rgba(23,25,26,.03);
  --radius: 12px; --radius-s: 8px;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111315; --surface: #181B1E; --surface-2: #1C1F23; --sunken: #212529;
    --ink: #ECEEEF; --ink-2: #C9CED2; --muted: #9EA6AC; --faint: #6F777D;
    --line: #2A2F34; --line-2: #3B4147;
    --accent: #4CC384; --accent-ink: #86DCAB; --accent-soft: #15301F; --on-accent: #06140B;
    --kr: #B6AEFF; --kr-soft: #221F3B; --kr-line: #4E4796;
    --up: #D2CBB9; --up-soft: #25231F; --up-line: #4B463C;
    --amber: #F0B657; --amber-soft: #2F2513; --blue: #8DB8F2; --blue-soft: #15253A; --red: #F29D8B; --red-soft: #351B16;
    --focus: #8DB8F2; --shadow: none;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.55 var(--font); -webkit-font-smoothing: antialiased; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 4px; }
[hidden] { display: none !important; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.skip { position: absolute; left: 12px; top: -48px; z-index: 20; background: var(--ink); color: var(--bg); padding: 8px 14px; border-radius: var(--radius-s); text-decoration: none; font-weight: 600; }
.skip:focus { top: 12px; }

/* The frame: a sidebar with the pages, and the content. */
.shell { display: grid; grid-template-columns: 248px minmax(0, 1fr); min-height: 100vh; }
.side { background: var(--surface); border-right: 1px solid var(--line); padding: 20px 14px 16px; display: flex; flex-direction: column; gap: 4px; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
.brand { display: flex; gap: 10px; align-items: center; padding: 2px 10px 18px; }
.mark { flex: none; width: 28px; height: 28px; border-radius: 8px; background: var(--accent); color: var(--on-accent); display: grid; place-items: center; font: 700 13px/1 var(--font); letter-spacing: -.02em; }
.brand-name { font-weight: 650; font-size: 14px; letter-spacing: -.01em; }
.project { color: var(--muted); font-size: 13px; line-height: 1.3; overflow-wrap: anywhere; }
.side nav { display: flex; flex-direction: column; gap: 2px; }
.side nav a { display: flex; align-items: center; min-height: 36px; padding: 6px 10px; border-radius: var(--radius-s); color: var(--ink-2); text-decoration: none; font-size: 14px; font-weight: 500; }
.side nav a:hover { background: var(--sunken); color: var(--ink); }
.side nav a.on, .side nav a[aria-current="page"] { background: var(--accent-soft); color: var(--accent-ink); font-weight: 600; }
.side nav h4 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); margin: 18px 10px 4px; }
.links { margin-top: auto; padding: 16px 10px 0; }
.links a { color: var(--muted); text-decoration: none; font-size: 12px; }
.links a:hover { color: var(--ink-2); text-decoration: underline; }
.content { min-width: 0; padding: 20px 40px 80px; }
.content > * { max-width: 1120px; }
.mode { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px; color: var(--muted); margin-bottom: 12px; }
.mode-tag { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: 99px; font-size: 12px; font-weight: 600; background: var(--accent-soft); color: var(--accent-ink); }
.mode-tag::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.mode-tag.snap { background: var(--sunken); color: var(--ink-2); }
main:focus { outline: none; }

/* Type. */
h1 { font-size: 28px; line-height: 1.2; letter-spacing: -.02em; font-weight: 700; margin: 0; }
h1:focus { outline: none; }
h2 { font-size: 18px; line-height: 1.3; letter-spacing: -.01em; font-weight: 650; margin: 0; }
h3 { font-size: 15px; line-height: 1.35; font-weight: 650; margin: 0 0 10px; }
h4 { font-size: 13px; font-weight: 650; margin: 18px 0 6px; color: var(--ink-2); }
p { margin: 0 0 10px; }
a { color: var(--blue); text-underline-offset: 2px; }
code { font-family: var(--mono); font-size: .88em; background: var(--sunken); padding: 1px 6px; border-radius: 5px; overflow-wrap: anywhere; }
.muted { color: var(--muted); font-size: 13px; }
.eyebrow, .label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); }
.page-head { margin: 8px 0 22px; }
.page-head .eyebrow { margin-bottom: 6px; }
.lede { color: var(--muted); font-size: 15px; max-width: 68ch; margin: 8px 0 0; }
.section-title { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 28px 0 12px; }
.back { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; font-size: 14px; font-weight: 500; text-decoration: none; color: var(--ink-2); }
.back:hover { color: var(--ink); text-decoration: underline; }
.num { font-variant-numeric: tabular-nums; }

/* Surfaces. */
.card, .panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px 20px; margin-bottom: 14px; color: inherit; text-decoration: none; display: block; box-shadow: var(--shadow); }
a.card { transition: border-color .15s, transform .15s; }
a.card:hover { border-color: var(--line-2); }
a.card:hover .card-title { text-decoration: underline; text-underline-offset: 3px; }
.cards { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
.cards > .card, .cards > .panel { margin: 0; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.spacer { flex: 1; }
.card-head { display: flex; gap: 10px; align-items: flex-start; justify-content: space-between; }
.card-title { font-size: 16px; font-weight: 650; line-height: 1.35; letter-spacing: -.005em; }
.meta { color: var(--muted); font-size: 13px; margin-top: 2px; }
.meta span + span::before { content: "·"; margin: 0 6px; color: var(--faint); }
.big { font-size: 30px; font-weight: 700; letter-spacing: -.02em; line-height: 1.1; font-variant-numeric: tabular-nums; }
.figure { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
.progress { height: 6px; background: var(--sunken); border-radius: 99px; overflow: hidden; margin-top: 12px; }
.progress > div { height: 100%; background: var(--accent); border-radius: 99px; }
.progress.stale > div { background: var(--amber); }
.card-foot { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-top: 10px; font-size: 13px; color: var(--muted); }

/* Chips. */
.chip { display: inline-flex; align-items: center; gap: 5px; min-height: 24px; font-size: 12px; font-weight: 600; padding: 2px 10px; border-radius: 99px; background: var(--sunken); color: var(--ink-2); border: 1px solid transparent; text-decoration: none; white-space: nowrap; }
a.chip:hover { border-color: var(--line-2); }
.chip.green { background: var(--accent-soft); color: var(--accent-ink); }
.chip.amber { background: var(--amber-soft); color: var(--amber); }
.chip.blue { background: var(--blue-soft); color: var(--blue); }
.chip.red { background: var(--red-soft); color: var(--red); }
.chip.lock { background: transparent; border-color: var(--line-2); color: var(--muted); font-weight: 500; }
.chip.id { font-family: var(--mono); font-weight: 500; }

/* Stats on a key result. */
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin: 20px 0; }
.stat { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 18px; box-shadow: var(--shadow); }
.stat .big { margin: 6px 0 4px; }
.val { font-weight: 650; font-size: 16px; margin: 6px 0 4px; font-variant-numeric: tabular-nums; }

/* The plan bar and the two OKR views. */
.viewbar { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; margin: 0 0 6px; }
.viewbar .field { display: inline-flex; gap: 8px; align-items: center; font-size: 13px; }
.pill { border: 1px solid var(--line); border-radius: 99px; background: var(--surface); padding: 3px 12px; font-size: 13px; font-weight: 600; color: var(--ink-2); }
.seg { display: inline-flex; padding: 3px; border-radius: 10px; background: var(--sunken); gap: 2px; }
.seg a { display: inline-flex; align-items: center; min-height: 30px; padding: 4px 12px; border-radius: 8px; font-size: 13px; font-weight: 600; color: var(--ink-2); text-decoration: none; }
.seg a:hover { color: var(--ink); }
.seg a[aria-current] { background: var(--surface); color: var(--ink); box-shadow: var(--shadow); }

/* The linked columns: objective → key result → bet → plan above. */
.tree { overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: thin; }
.tree:focus-visible { outline-offset: 4px; }
.tree svg { display: block; font-family: var(--font); }
.scroll-hint { display: none; font-size: 12px; color: var(--muted); margin: 0 0 8px; }
.t-head { font-size: 11px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; fill: var(--muted); }
.t-group { font-size: 12px; font-weight: 600; fill: var(--ink-2); }
.t-card rect { stroke-width: 1; }
.t-title { font-size: 13.5px; font-weight: 650; }
.t-sub { font-size: 12px; fill: var(--muted); }
.t-card.up rect { fill: var(--up-soft); stroke: var(--up-line); } .t-card.up .t-title { fill: var(--ink); } .t-card.up .t-sub { fill: var(--up); }
.t-card.kr rect { fill: var(--kr-soft); stroke: var(--kr-line); } .t-card.kr .t-title { fill: var(--kr); } .t-card.kr .t-sub { fill: var(--ink-2); }
.t-card.bet rect { fill: var(--accent-soft); stroke: var(--accent); stroke-opacity: .45; } .t-card.bet .t-title { fill: var(--accent-ink); } .t-card.bet .t-sub { fill: var(--ink-2); }
.t-card.dim { opacity: .45; }
a:hover .t-card rect, a:focus-visible .t-card rect { stroke-width: 2; stroke-opacity: 1; }
a:focus-visible { outline: none; }
a:focus-visible .t-card rect { stroke: var(--focus); }
.t-link { fill: none; stroke-width: 1.5; }
.t-link.kr { stroke: var(--kr); opacity: .55; } .t-link.bet { stroke: var(--accent); opacity: .6; } .t-link.dim { opacity: .3; stroke-dasharray: 4 4; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 12px; font-size: 12px; color: var(--muted); }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend i { width: 12px; height: 12px; border-radius: 4px; border: 1px solid; display: inline-block; }
.legend .up { background: var(--up-soft); border-color: var(--up-line); }
.legend .kr { background: var(--kr-soft); border-color: var(--kr-line); }
.legend .bet { background: var(--accent-soft); border-color: var(--accent); }

/* Bets. */
.bet-card { padding: 22px 24px; }
.bet-card .card-title { font-size: 19px; }
.hyp { font-size: 16px; line-height: 1.5; margin: 12px 0 6px; color: var(--ink); max-width: 72ch; }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 16px 0 4px; }
.box { border: 1px solid var(--line); border-radius: var(--radius-s); padding: 14px 16px; background: var(--surface-2); }
.prose { white-space: pre-line; color: var(--ink-2); font-size: 14px; margin-top: 12px; max-width: 72ch; }
.prose h4 { margin: 14px 0 2px; }
.stories { list-style: none; padding: 0; margin: 8px 0; font-size: 13px; display: grid; gap: 4px; }
.sid { font-family: var(--mono); font-size: 12px; color: var(--muted); margin-right: 6px; }
.reviews { list-style: none; padding: 0; margin: 6px 0 0; font-size: 14px; display: grid; gap: 8px; }
.reviews li { padding-left: 14px; border-left: 2px solid var(--line-2); }
.bet-block { margin-bottom: 26px; }
.bet-block > .panel { margin-left: 18px; border-left: 3px solid var(--accent-soft); }

/* Forms. */
.form { display: grid; gap: 12px; }
.form label { display: grid; gap: 5px; font-size: 13px; font-weight: 600; color: var(--ink-2); }
.form label.check { display: flex; gap: 8px; align-items: center; font-weight: 500; }
.fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 14px; }
input, select, textarea { font: inherit; font-size: 15px; font-weight: 400; min-height: 40px; padding: 8px 11px; border: 1px solid var(--line-2); border-radius: var(--radius-s); background: var(--surface); color: var(--ink); width: 100%; }
input:hover, select:hover, textarea:hover { border-color: var(--muted); }
input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--focus); outline-offset: 0; border-color: var(--focus); border-radius: var(--radius-s); }
select[multiple] { min-height: 96px; }
textarea { resize: vertical; min-height: 72px; }
input[type=checkbox] { width: 18px; height: 18px; min-height: 0; accent-color: var(--accent); }
button { font: inherit; font-size: 14px; font-weight: 600; min-height: 36px; padding: 7px 16px; border-radius: var(--radius-s); border: 1px solid var(--line-2); background: var(--surface); color: var(--ink); cursor: pointer; }
button:hover { background: var(--sunken); }
button.primary { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
button.primary:hover { filter: brightness(.94); }
button:disabled { opacity: .6; cursor: default; }
button[aria-busy="true"] { cursor: progress; }
.actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
details { margin: 10px 0 0; }
details > summary { cursor: pointer; list-style: none; display: inline-flex; align-items: center; gap: 8px; min-height: 32px; font-size: 14px; font-weight: 600; color: var(--ink-2); }
details > summary::-webkit-details-marker { display: none; }
details > summary::before { content: ""; width: 7px; height: 7px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(-45deg); transition: transform .15s; margin: 0 2px; }
details[open] > summary::before { transform: rotate(45deg); }
details > summary:hover { color: var(--ink); }
details .panel, details .form { margin-top: 10px; }
details.panel { padding: 12px 20px; }
details.panel[open] { padding-bottom: 18px; }
.disclosures { display: flex; flex-wrap: wrap; gap: 0 20px; border-top: 1px solid var(--line); margin-top: 16px; padding-top: 6px; }
.disclosures details { flex: 1 1 100%; margin: 4px 0 0; }

/* Chart and lists. */
.chart { width: 100%; height: auto; display: block; }
.chart .base { stroke: var(--faint); stroke-width: 1.5; }
.chart .target { stroke: var(--accent); stroke-width: 1.5; stroke-dasharray: 6 4; }
.chart .line { fill: none; stroke: var(--kr); stroke-width: 2.5; stroke-linejoin: round; }
.chart .pt { fill: var(--surface); stroke: var(--kr); stroke-width: 2; }
.chart .ax { font-size: 11px; fill: var(--muted); font-variant-numeric: tabular-nums; }
.checkins { list-style: none; padding: 0; margin: 0; font-size: 14px; }
.checkins li { padding: 10px 0; border-bottom: 1px solid var(--line); }
.checkins li:last-child { border-bottom: 0; }
.story-row { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; align-items: baseline; }
.story-row .muted { grid-column: 2; }
.story-row details { grid-column: 2; margin: 2px 0 0; }

/* Timeline. */
.timeline { --label: 170px; overflow-x: auto; }
.timeline-inner { min-width: 640px; }
.axis { position: relative; height: 22px; margin-left: var(--label); font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.axis span { position: absolute; white-space: nowrap; padding-left: 4px; border-left: 1px solid var(--line-2); }
.lane { display: flex; border-top: 1px solid var(--line); min-height: 40px; }
.tlabel { width: var(--label); flex: none; padding: 10px 12px 8px 0; font-size: 13px; font-weight: 600; color: var(--ink-2); overflow-wrap: anywhere; }
.track { position: relative; flex: 1; min-height: 40px; }
.tbar { position: absolute; top: 8px; height: 24px; line-height: 24px; padding: 0 8px; border-radius: 6px; font-size: 12px; font-weight: 600; color: #fff; background: #1C5AA6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-decoration: none; }
.tbar.won { background: #12733F; }
.tbar.awaiting { background: #8A5300; }
.tbar.closed { background: #5B6267; }
.tbar:hover { filter: brightness(1.08); }
.today { position: absolute; top: 0; bottom: 0; border-left: 2px solid var(--red); opacity: .7; }
.today-key { display: inline-flex; align-items: center; gap: 6px; }
.today-key::before { content: ""; width: 2px; height: 12px; background: var(--red); }

/* How it works. */
.alts { display: flex; flex-direction: column; }
.alt { border: 1px solid var(--line); border-radius: var(--radius-s); padding: 12px 14px; background: var(--surface); }
.alt.here { border-color: var(--accent); background: var(--accent-soft); }
.alt.delivery { background: var(--surface-2); border-style: dashed; }
.alt .row { margin-bottom: 2px; }
.alt-arrow { font-size: 12px; color: var(--muted); padding: 6px 14px; }
.steps { margin: 0; padding-left: 22px; font-size: 14px; color: var(--ink-2); display: grid; gap: 10px; max-width: 80ch; }
.steps strong { color: var(--ink); }

/* Notices, the save bar, empty states and toasts. */
.notice { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; background: var(--amber-soft); color: var(--amber); border-radius: var(--radius-s); padding: 10px 14px; margin: 0 0 14px; font-size: 14px; font-weight: 500; }
.notice button { min-height: 30px; padding: 3px 12px; }
.pending { display: grid; gap: 6px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 10px 14px; margin-bottom: 14px; font-size: 14px; }
.pending:empty { display: none; }
.pending .row { gap: 10px; }
.pending .state { display: inline-flex; align-items: center; gap: 8px; font-weight: 500; }
.pending .state::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--faint); flex: none; }
.pending .state.dirty::before { background: var(--amber); }
.pending .state.clean::before { background: var(--accent); }
.pending .row .spacer { flex: 1; }
.pending details { margin: 0; }
.pending code { font-size: 12px; }
.empty-state { text-align: left; border: 1px dashed var(--line-2); border-radius: var(--radius); padding: 24px; background: var(--surface-2); margin-bottom: 14px; }
.empty-state h2 { font-size: 16px; margin-bottom: 6px; }
.empty-state p { color: var(--muted); font-size: 14px; margin: 0; max-width: 60ch; }
.empty-state p + p { margin-top: 8px; }
.toast { position: fixed; right: 20px; bottom: 20px; z-index: 30; max-width: min(380px, calc(100vw - 32px)); background: var(--ink); color: var(--bg); padding: 12px 16px; border-radius: var(--radius-s); opacity: 0; transform: translateY(6px); pointer-events: none; transition: opacity .2s, transform .2s; font-size: 14px; font-weight: 500; box-shadow: 0 8px 24px rgba(0,0,0,.18); }
.toast.show { opacity: 1; transform: none; }
.toast.bad { background: var(--red); color: #fff; }
@media (prefers-color-scheme: dark) { .toast.bad { color: #1A0B08; } }

@media (max-width: 860px) {
  .shell { grid-template-columns: 1fr; }
  .side { position: sticky; top: 0; z-index: 10; height: auto; padding: 10px 0 0; border-right: 0; border-bottom: 1px solid var(--line); flex-direction: column; gap: 0; }
  .brand { padding: 0 16px 8px; }
  .mark { width: 24px; height: 24px; font-size: 12px; }
  .brand > div { display: flex; gap: 8px; align-items: baseline; min-width: 0; }
  .project::before { content: "· "; }
  .project { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .side nav { flex-direction: row; gap: 2px; overflow-x: auto; padding: 0 12px 8px; scrollbar-width: none; -webkit-mask-image: linear-gradient(90deg, #000 85%, transparent); mask-image: linear-gradient(90deg, #000 85%, transparent); }
  .side nav a:last-child { margin-right: 40px; }
  .mode { font-size: 12px; gap: 6px 10px; }
  .side nav::-webkit-scrollbar { display: none; }
  .side nav a { white-space: nowrap; flex: none; min-height: 36px; }
  .side nav h4 { display: none; }
  .links { display: none; }
  .content { padding: 14px 16px 64px; }
  h1 { font-size: 24px; }
  .page-head { margin: 4px 0 18px; }
  .card, .panel { padding: 16px; }
  .bet-card { padding: 18px 16px; }
  .split, .fields { grid-template-columns: 1fr; }
  .cards { grid-template-columns: 1fr; }
  .timeline { --label: 92px; }
  .scroll-hint { display: block; }
  .bet-block > .panel { margin-left: 0; }
  .toast { left: 16px; right: 16px; bottom: 16px; max-width: none; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
@media print { .side, .pending, .mode, .toast, details { display: none !important; } .shell { display: block; } .card, .panel { break-inside: avoid; box-shadow: none; } }
`;

// Shared view code (drawn in both the live dashboard and the export). Written with String.raw:
// no backticks or substitutions inside.
const VIEWS_JS = String.raw`
var D = JSON.parse(document.getElementById('nikos-data').textContent);
var TODAY = D.today;
var DAY = 86400000;
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var main = document.getElementById('main');
var NOTICE = '';

function ts(d) { return Date.parse(d + 'T00:00:00Z'); }
function addDays(d, n) { return new Date(ts(d) + n * DAY).toISOString().slice(0, 10); }
function dayDiff(a, b) { return Math.round((ts(b) - ts(a)) / DAY); }
function num(n, unit) {
  if (n === null || n === undefined || isNaN(n)) return '-';
  var s = String(Math.round(n * 100) / 100);
  return unit ? (unit === '%' ? s + '%' : s + ' ' + unit) : s;
}
function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
function chip(text, cls) { return '<span class="chip ' + cls + '">' + esc(text) + '</span>'; }
function krById(id) { for (var i = 0; i < D.krs.length; i++) if (D.krs[i].id === id) return D.krs[i]; return null; }
function outcomeClass(o) { return o === 'won' ? 'green' : o === 'awaiting evidence' ? 'amber' : o === 'open' ? 'blue' : o === 'lost' ? 'red' : ''; }
function barClass(o) { return o === 'won' ? 'won' : o === 'awaiting evidence' ? 'awaiting' : (o === 'lost' || o === 'stopped') ? 'closed' : ''; }
// Words for the page: a bet's id as a title (smart-retries reads Smart retries), and a status with a capital.
function betTitle(id) { return id ? id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ') : id; }
function cap(s) { s = String(s || '').replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); }
function statusWord(s) { return s === 'todo' ? 'To do' : cap(s); }
// The top of every page: a small label, the title, and one line on what the page shows.
function pageHead(title, lede, eyebrow) {
  return '<header class="page-head">' + (eyebrow ? '<div class="eyebrow">' + eyebrow + '</div>' : '') + '<h1 tabindex="-1">' + esc(title) + '</h1>' + (lede ? '<p class="lede">' + esc(lede) + '</p>' : '') + '</header>';
}
// What a page says when it has nothing to show: what is missing, and how to add it.
function emptyState(title, body, how) {
  return '<div class="empty-state"><h2>' + esc(title) + '</h2><p>' + esc(body) + '</p>' + (how ? '<p>' + how + '</p>' : '') + '</div>';
}
// How to add something: the form on this page when it has one, else the command.
function howToAdd(form, command) { return EDIT ? esc('Use ' + form + ' below.') : 'Add one with <code>' + esc(command) + '</code>.'; }
function defaultRoute() { return D.plan && D.plan.level === 'group' ? '#/groupmaps' : '#/krs'; }
var TITLES = { krs: 'Key results', okrs: 'OKRs and bets', ladder: 'OKR ladder', groupmaps: 'Bets and story maps', bets: 'Bets', timeline: 'Timeline', guide: 'How it works' };
var FIRST = true;
function render() {
  var p = (location.hash || defaultRoute()).replace(/^#\/?/, '').split('/');
  var section = p[0] === 'kr' ? 'krs' : (p[0] || (D.plan && D.plan.level === 'group' ? 'groupmaps' : 'krs'));
  var links = document.querySelectorAll('[data-nav]');
  for (var i = 0; i < links.length; i++) {
    var on = links[i].getAttribute('data-nav') === section;
    links[i].classList.toggle('on', on);
    if (on) links[i].setAttribute('aria-current', 'page'); else links[i].removeAttribute('aria-current');
  }
  var html;
  if (p[0] === 'kr' && p[1]) html = krDetail(p[1]);
  else if (p[0] === 'okrs') html = okrsView();
  else if (p[0] === 'ladder') html = ladderView();
  else if (p[0] === 'groupmaps') html = groupMapsView();
  else if (p[0] === 'bets') html = betsView();
  else if (p[0] === 'timeline') html = timelineView();
  else if (p[0] === 'guide') html = guideView();
  else html = krsView();
  var notes = (D.problems && D.problems.length ? '<div class="notice" role="alert">Some planning files could not be read: ' + esc(D.problems.join('; ')) + '</div>' : '') + (NOTICE ? '<div class="notice" role="alert">' + NOTICE + '</div>' : '');
  main.innerHTML = notes + html;
  var h1 = main.querySelector('h1');
  document.title = (h1 ? h1.textContent + ' · ' : (TITLES[section] ? TITLES[section] + ' · ' : '')) + D.project + ' · nikOS planning';
  var target = p[0] === 'bets' && p[1] ? document.getElementById('bet-' + p[1]) : null;
  if (target && target.scrollIntoView) target.scrollIntoView();
  // A new page moves focus to its title, so a screen reader reads where it went. Not on first load.
  else if (!FIRST && h1 && h1.focus) { window.scrollTo(0, 0); h1.focus({ preventScroll: true }); }
  FIRST = false;
}

window.addEventListener('hashchange', render);

var LEVELS = [
  ['company', 'Company', 'Sets the few outcomes that matter most this period as objectives and key results, and makes bets on them.'],
  ['department', 'Department', 'Sets its own key results, each aligned to company ones or its own, and bets that may align to company bets.'],
  ['group', 'Group', 'Has no key results: OKRs stop at department level. Makes bets on the department\'s key results, each aligned to a department bet or its own.']
];

function guideView() {
  var level = D.plan && D.plan.level ? String(D.plan.level) : '';
  var ups = (D.upstream || []).map(function (u) { return u.repo; });
  var here = level
    ? 'This is a ' + esc(level) + ' plan' + (D.plan.period ? ' for ' + esc(D.plan.period) : '') + (ups.length ? ', working toward ' + ups.map(esc).join(', ') : '') + '.'
    : 'This repo has no plan.yaml yet. Ask your agent to plan the period and it will set the level.';
  var stack = LEVELS.map(function (l, i) {
    return (i ? '<div class="alt-arrow" aria-hidden="true">↑ aligns to, read-only</div>' : '') +
      '<div class="alt' + (l[0] === level ? ' here' : '') + '"><div class="row"><strong>' + l[1] + '</strong>' + (l[0] === level ? chip('This plan', 'green') : '') +
      '<span class="muted">its own repo, planning/</span></div><div class="muted">' + l[2] + '</div></div>';
  }).join('') +
    '<div class="alt-arrow" aria-hidden="true">↑ specs a bet</div>' +
    '<div class="alt delivery"><div class="row"><strong>Story map</strong><span class="muted">intent/ or maps/ in the repo that builds it</span></div><div class="muted">Specs a bet as stories, organised by activity and step. Story status comes from the work itself.</div></div>';
  var steps = [
    ['Plan the period', 'Ask your agent to plan the quarter. It asks for the level, pillars, objectives and key results, and shows a draft. Nothing is written until you approve.'],
    ['Align upward', 'List the plans above you in planning/upstream.yaml. nikos planning sync keeps a read-only copy, so a key result can align to key results above, and a bet to bets above, by reference, without ever writing to that repo.'],
    ['Frame bets', 'A bet says what you believe will move a key result, and why, with the evidence. It has a review date, not a deadline.'],
    ['Deliver through the story map', 'A release in the story map names the bets it delivers. A group keeps one map per bet, under maps/. Delivery status (Not started, Building, Shipped) is worked out from its stories.'],
    ['Check in', 'Record the key result value as it moves, by chat or here. A key result with no recent check-in is flagged stale.'],
    ['Review and call the outcome', 'On the review date, continue, change, stop or complete the bet, with the reason. The outcome (won, lost) comes only from key result evidence: shipped is not won.']
  ].map(function (s, i) { return '<li><strong>' + esc(s[0]) + '.</strong> ' + esc(s[1]) + '</li>'; }).join('');
  var value = [
    ['Plans live next to the work', 'Objectives, key results and bets are plain files in the repo, reviewed in pull requests and versioned with the code.'],
    ['Delivery is never self-reported', 'Whether a bet is building or shipped comes from the story map and its stories, not from a status someone typed.'],
    ['Outcomes are kept honest', 'A bet is only won when its key result moves. A revised target keeps the original one.'],
    ['Every level lines up, and nobody loses control', 'Teams align to the plans above by reference. Repo access is the permission model, and no plan writes to another.'],
    ['Your agent runs the rituals', 'Planning, check-ins and reviews are conversations with your coding agent, with the same checks as the commands.']
  ].map(function (v) { return '<div class="panel"><h3>' + esc(v[0]) + '</h3><div class="muted">' + esc(v[1]) + '</div></div>'; }).join('');
  return '<header class="page-head"><h1 tabindex="-1">How it works</h1><p class="lede">' + here + '</p></header>' +
    '<div class="panel"><h3>One plan per level, each in its own repo</h3><div class="alts">' + stack + '</div></div>' +
    '<div class="panel"><h3>The loop</h3><ol class="steps">' + steps + '</ol></div>' +
    '<div class="section-title"><h2>What nikOS adds</h2></div><div class="cards">' + value + '</div>';
}

function opFieldHtml(f) {
  var attrs = ' data-field="' + esc(f.name) + '"' + (f.kind ? ' data-kind="' + esc(f.kind) + '"' : '') + (f.targetKey ? ' data-target-key="' + esc(f.targetKey) + '"' : '') + (f.multiple ? ' multiple' : '');
  var val = f.value === undefined || f.value === null ? '' : String(f.value);
  var input;
  if (f.options) {
    var picked = [].concat(f.value === undefined || f.value === null ? [] : f.value).map(String);
    input = '<select' + attrs + '>' + (f.multiple ? '' : '<option value="">-</option>') + f.options.map(function (o) {
      var v = typeof o === 'object' ? o.value : o;
      var label = typeof o === 'object' ? o.label : o;
      var on = f.multiple ? picked.indexOf(String(v)) >= 0 : String(v) === val;
      return '<option value="' + esc(v) + '"' + (on ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('') + '</select>';
  } else if (f.area) input = '<textarea' + attrs + ' rows="2">' + esc(val) + '</textarea>';
  else input = '<input' + attrs + ' type="' + (f.kind === 'number' ? 'number' : f.kind === 'date' ? 'date' : 'text') + '" step="any" value="' + esc(val) + '"' + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') + '>';
  return '<label>' + esc(f.label) + input + '</label>';
}
// A form that makes one op: its fields are read on submit, and an empty optional field deletes it.
function opForm(op, target, expect, fields, label, foot, extra) {
  return '<div class="panel form" data-op-form="' + esc(op) + '" data-target="' + esc(JSON.stringify(target || {})) + '" data-expect="' + esc(expect || '') + '"><h3>' + esc(label) + '</h3>' +
    '<div class="fields">' + fields.map(opFieldHtml).join('') + '</div>' + (extra || '') +
    '<div class="actions"><button type="button" class="primary" data-op-submit>' + esc(label) + '</button>' + (foot ? '<span class="muted">' + esc(foot) + '</span>' : '') + '</div></div>';
}
function upstreamOptions(kind) {
  var out = [];
  (D.upstream || []).forEach(function (u) {
    (u[kind] || []).forEach(function (x) { out.push({ value: u.repo + '#' + x.id, label: u.repo + '#' + x.id + ' · ' + (x.title || x.id) }); });
  });
  return out;
}
function ownKrOptions() { return D.krs.map(function (k) { return { value: k.id, label: k.id + ' · ' + k.title }; }); }
// What an align control says when there is nothing above to pick from: the live page syncs, a snapshot needs --with-linked.
function noAbove() { return LIVE ? 'Sync the plan above to align here.' : 'Export with --with-linked to choose from the plan above.'; }
function ownBetOptions() { return D.bets.map(function (b) { return { value: b.id, label: b.id }; }); }

// A tree of cards in columns, joined by curved lines: the OKRs and bets page and the OKR ladder.
// cols: [{ head, items: [{ key, title, sub, tone, href, group, dim }], empty }]; links: [[fromKey, toKey, tone, dim]].
var TREE = { w: 214, gap: 44, h: 52, step: 62, top: 34 };
function cut(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function tree(cols, links, label) {
  var pos = {}, out = '', H = 60, width = cols.length * TREE.w + (cols.length - 1) * TREE.gap;
  cols.forEach(function (c, i) {
    var x = i * (TREE.w + TREE.gap), y = TREE.top, last = null;
    out += '<text class="t-head" x="' + x + '" y="16">' + esc(cut(c.head, 30)) + '</text>';
    if (!c.items.length) out += '<text class="t-sub" x="' + x + '" y="' + (y + 18) + '">' + esc(cut(c.empty, 30)) + '</text>';
    c.items.forEach(function (it) {
      if (it.group && it.group !== last) { out += '<text class="t-group" x="' + x + '" y="' + (y + 10) + '"><title>' + esc(it.group) + '</title>' + esc(cut(it.group, 28)) + '</text>'; y += 22; last = it.group; }
      pos[it.key] = { x: x, y: y };
      var card = '<g class="t-card ' + it.tone + (it.dim ? ' dim' : '') + '"><title>' + esc(it.title + (it.sub ? '. ' + it.sub : '')) + '</title><rect x="' + x + '" y="' + y + '" width="' + TREE.w + '" height="' + TREE.h + '" rx="10"/>' +
        '<text class="t-title" x="' + (x + 12) + '" y="' + (y + 21) + '">' + esc(cut(it.title, 26)) + '</text><text class="t-sub" x="' + (x + 12) + '" y="' + (y + 39) + '">' + esc(cut(it.sub, 32)) + '</text></g>';
      out += it.href ? '<a href="' + esc(it.href) + '" aria-label="' + esc(it.title + (it.sub ? ', ' + it.sub : '')) + '">' + card + '</a>' : card;
      y += TREE.step;
    });
    H = Math.max(H, y);
  });
  var lines = links.map(function (l) {
    var a = pos[l[0]], b = pos[l[1]];
    if (!a || !b) return '';
    var x1 = a.x + TREE.w, y1 = a.y + TREE.h / 2, x2 = b.x, y2 = b.y + TREE.h / 2, mx = (x1 + x2) / 2;
    return '<path class="t-link ' + l[2] + (l[3] ? ' dim' : '') + '" d="M' + x1 + ' ' + y1 + 'C' + mx + ' ' + y1 + ',' + mx + ' ' + y2 + ',' + x2 + ' ' + y2 + '"/>';
  }).join('');
  // A region you can scroll sideways on a phone, and reach with the keyboard; the cards that link are links.
  return '<p class="scroll-hint" aria-hidden="true">Scroll sideways to see every column.</p>' +
    '<div class="tree" tabindex="0" role="region" aria-label="' + esc(label || 'Key results and bets, linked across plans') + '"><svg viewBox="0 0 ' + width + ' ' + (H + 4) + '" style="width:100%;max-width:' + width + 'px;min-width:' + Math.round(width * 0.78) + 'px" role="group">' + lines + out + '</svg></div>' +
    '<div class="legend" aria-hidden="true">' + cols.map(function (c) { return c.items[0] ? c.items[0].tone : ''; }).filter(function (t, i, a) { return t && a.indexOf(t) === i; }).map(function (t) {
      return '<span><i class="' + t + '"></i>' + (t === 'up' ? 'Plan above (read-only)' : t === 'kr' ? 'Key result' : 'Bet') + '</span>';
    }).join('') + '</div>';
}
function pct(p) { return typeof p === 'number' && isFinite(p) ? Math.round(p * 100) + '%' : 'No check-in'; }
// The plan and period this page shows, and the two views of it.
function viewBar(on, v) {
  var label = (v.name || 'This plan') + (D.plan && D.plan.level ? ' (' + D.plan.level + ')' : '');
  return '<div class="viewbar"><span class="field"><span class="muted">Plan</span><span class="pill">' + esc(label) + '</span></span>' +
    (D.plan && D.plan.period ? '<span class="field"><span class="muted">Period</span><span class="pill">' + esc(D.plan.period) + '</span></span>' : '') +
    '<nav class="seg" aria-label="OKR views"><a href="#/okrs"' + (on === 'okrs' ? ' aria-current="page"' : '') + '>OKRs and bets</a><a href="#/ladder"' + (on === 'ladder' ? ' aria-current="page"' : '') + '>OKR ladder</a></nav></div>';
}

// The OKRs and bets page: the key results above this plan's align to, its key results by objective,
// its bets, and the bets above they align to, left to right. Group bets aligned here sit below.
function okrsView() {
  var v = D.pages.okrsAndBets;
  var name = v.name || 'This plan', up = v.aboveName || 'the plan above', top = v.level === 'company';
  var cols = [], links = [];
  if (!top) cols.push({ head: 'Above: ' + up + ' KRs', empty: v.noneAbove, items: v.above.map(function (a) {
    return { key: 'k:' + a.ref, title: a.title || a.id, sub: a.found ? pct(a.progress) + ' · ' + (a.plan || a.repo) : 'Not in the synced copy yet', tone: 'up' };
  }) });
  var krItems = [];
  v.byObjective.forEach(function (g) {
    g.krs.forEach(function (k) {
      krItems.push({ key: 'k:' + k.id, title: k.title, sub: pct(k.progress) + ' this period', tone: 'kr', href: '#/kr/' + k.id, group: g.objective });
      k.aligned.forEach(function (ref) { links.push(['k:' + ref, 'k:' + k.id, 'kr']); });
    });
  });
  cols.push({ head: name + ' KRs', empty: 'No key results yet.', items: krItems });
  cols.push({ head: name + ' bets', empty: 'No bets yet.', items: v.bets.map(function (b) {
    b.krs.forEach(function (k) { links.push(['k:' + k, 'b:' + b.id, 'bet']); });
    b.alignsTo.forEach(function (ref) { links.push(['b:' + b.id, 'b:' + ref, 'bet', true]); });
    return { key: 'b:' + b.id, title: b.title || b.id, sub: (b.tag === 'aligned' ? 'Aligns up' : 'Own bet') + (b.note ? ' · ' + b.note : ''), tone: 'bet', href: '#/bets/' + b.id };
  }) });
  if (!top) cols.push({ head: 'Above: ' + up + ' bets', empty: 'Not aligned to a bet above yet.', items: v.betsAbove.map(function (b) {
    return { key: 'b:' + b.ref, title: b.title || b.id, sub: (b.found ? (b.plan || b.repo) + ' bet' : 'Not in the synced copy yet') + (b.stoppedOn ? ' · stopped on ' + b.stoppedOn : ''), tone: 'up' };
  }) });
  var groupNote = v.groupBetsNote ? '<div class="notice">' + esc(v.groupBetsNote) + '</div>' : '';
  var groupBets = v.groupBets.length ? '<ul class="checkins">' + v.groupBets.map(function (g) {
    return '<li><div class="row"><strong>' + esc(betTitle(g.id)) + '</strong>' + chip(g.plan, 'lock') + '</div><div class="muted">Aligns to ' + esc(g.aligns_to) + ' · ' + esc(g.delivery) + '</div>' + (g.note ? '<div class="notice">' + esc(g.note) + '</div>' : '') + '</li>';
  }).join('') + '</ul>' : '<p class="muted">No group bets are aligned to a bet here yet.</p>';
  var forms = '';
  if (EDIT && D.plan && D.plan.level !== 'company') {
    if (!upstreamOptions('bets').length) forms = '<p class="muted">' + noAbove() + '</p>';
    else forms = D.bets.map(function (b) {
      return opForm('bet.align', { bet: b.id }, b.hash, [{ name: 'aligns_to', label: 'Aligns to (bets above)', options: upstreamOptions('bets'), multiple: true, value: b.aligns_to }], 'Save alignment', 'Writes ' + b.file);
    }).join('');
  }
  return viewBar('okrs', v) + pageHead('OKRs and bets', v.foot) +
    '<div class="panel">' + tree(cols, links, 'Key results and the bets on them, linked across plans') + '</div>' +
    (top ? '' : '<div class="panel"><h3>Group bets aligned to a bet here</h3><p class="muted">Shows delivery only. Team status is not read on this page.</p>' + groupNote + groupBets + '</div>') +
    (EDIT && forms ? '<div class="panel"><h3>Align bets</h3>' + forms + '</div>' : '');
}

// The OKR ladder: the key results of the plan above in one column and this plan's in the other,
// with this plan's chain up to the company highlighted and the rest faded.
function ladderView() {
  var v = D.pages.okrLadder;
  var company = D.plan && D.plan.level === 'company', links = [];
  var cols = [];
  if (!company) cols.push({ head: (v.aboveName || 'Above this plan') + ' KRs', empty: v.emptyAbove, items: v.above.map(function (a) {
    return { key: 'k:' + a.ref, title: a.title || a.id, sub: pct(a.progress) + ' · ' + (a.onChain ? a.note : 'own check-ins'), tone: a.onChain ? 'up' : 'up', dim: !a.onChain };
  }) });
  cols.push({ head: (v.name || 'This plan') + ' KRs', empty: 'No key results yet.', items: v.own.map(function (k) {
    k.aligned.forEach(function (ref) { links.push(['k:' + ref, 'k:' + k.id, 'kr']); });
    return { key: 'k:' + k.id, title: k.title, sub: pct(k.progress) + (k.onChain ? ' · on the chain' : ' · not aligned yet'), tone: 'kr', href: '#/kr/' + k.id, dim: !company && !k.onChain };
  }) });
  return viewBar('ladder', v) + pageHead('OKR ladder', v.foot) + '<div class="panel">' + tree(cols, links, 'This plan\'s key results and the key results above them') + '</div>';
}

// The group's page: each bet, with the story maps that spec it under it, and each map's story rows.
function groupMapsView() {
  var v = D.pages.betsAndStoryMaps;
  var mapPanel = function (m) {
    var rows = m.stories.map(function (s) {
      var done = s.status === 'done' || s.status === 'approved';
      // The map id goes with the rename, so a group with several maps knows which one the story is in.
      var rename = EDIT ? opForm('story.rename', { story: s.id }, s.hash, [{ name: 'title', label: 'Title', value: s.title }], 'Rename', '',
        '<input type="hidden" data-field="map" value="' + esc(m.id) + '">' + (done ? '<label class="check"><input type="checkbox" data-confirm> This story is done. Rename it anyway</label>' : '')) : '';
      return '<li class="story-row"><span class="sid">' + esc(s.id) + '</span><span><strong>' + esc(s.title) + '</strong> ' + chip(statusWord(s.status), s.status === 'done' || s.status === 'approved' ? 'green' : s.status === 'in_progress' ? 'blue' : '') + '</span>' +
        (s.reason ? '<span class="muted">' + esc(s.reason) + '</span>' : '') +
        (EDIT ? '<details><summary>Rename</summary>' + rename + '</details>' : '') + '</li>';
    }).join('');
    return '<div class="panel"><div class="row"><span class="eyebrow">Story map</span>' + chip(m.key, 'id') + '</div><h3 style="margin-top:6px">' + esc(m.title) + '</h3>' +
      (m.problem ? '<div class="notice">' + esc(m.problem) + '</div>' : '') +
      (rows ? '<h4>Stories</h4><ul class="checkins">' + rows + '</ul>' : '<p class="muted">No stories in this map yet. Add one with <code>nikos story add</code>.</p>') + '</div>';
  };
  var block = function (b) {
    var mine = v.maps.filter(function (m) { return m.bet === b.id; });
    return '<section class="bet-block" aria-label="' + esc(betTitle(b.id)) + '"><a class="card" href="#/bets/' + esc(b.id) + '"><div class="card-head"><div><div class="eyebrow">Bet</div><div class="card-title">' + esc(betTitle(b.id)) + '</div></div>' + chip(cap(b.outcome), outcomeClass(b.outcome)) + '</div>' +
      '<p class="hyp" style="font-size:15px">' + esc(b.hypothesis) + '</p><div class="meta"><span>Delivery: ' + esc(b.delivery) + '</span>' +
      (b.alignsTo.length ? '<span>Aligns to ' + esc(b.alignsTo.join(', ')) + '</span>' : '') + '</div></a>' +
      (mine.length ? mine.map(mapPanel).join('') : '<p class="muted" style="margin-left:18px">No story map for this bet yet. Add one with <code>nikos map new --bet ' + esc(b.id) + '</code>.</p>') + '</section>';
  };
  var bets = v.bets.length ? v.bets.map(block).join('') : emptyState('No bets yet', 'A group makes bets on the key results above it. Each bet gets a story map that specs it.', 'Add one with <code>nikos planning bet new &lt;bet-id&gt;</code>' + (EDIT ? ', or on the Bets page' : '') + '.');
  var orphans = v.maps.filter(function (m) { return !v.bets.some(function (b) { return b.id === m.bet; }); });
  return pageHead('Bets and story maps', v.foot) + bets + (orphans.length ? '<div class="section-title"><h2>Story maps with no bet here</h2></div>' + orphans.map(mapPanel).join('') : '');
}

function krStatus(k) {
  return !k.checkins.length ? chip('No check-in yet', '') : k.stale ? chip('Needs a check-in', 'amber') : chip('Checked in recently', 'green');
}
function krCard(k) {
  var pct = Math.max(0, Math.min(100, Math.round(k.progress * 100)));
  return '<a class="card" href="#/kr/' + esc(k.id) + '">' +
    '<div class="card-head"><div class="card-title">' + esc(k.title) + '</div>' + krStatus(k) + '</div>' +
    '<div class="meta"><span>' + esc(k.owner) + '</span><span>By ' + esc(k.by) + '</span></div>' +
    '<div class="figure"><span class="big">' + esc(num(k.latestValue, k.unit)) + '</span><span class="muted num">Target ' + esc(num(k.target, k.unit)) + '</span></div>' +
    '<div class="progress' + (k.stale ? ' stale' : '') + '" role="img" aria-label="' + pct + '% of the way from baseline to target"><div style="width:' + pct + '%"></div></div>' +
    '<div class="card-foot"><span class="num">' + pct + '% of the way</span><span>' + (k.latest ? 'Last check-in ' + esc(k.latest.date) : 'No check-in yet') + '</span></div>' +
    (k.upstream ? '<div class="row" style="margin-top:10px">' + chip('Aligned to ' + k.upstream.ref, 'lock') + '</div>' : '') + '</a>';
}

function krsView() {
  var lv = D.plan && D.plan.level;
  var add = EDIT && (lv === 'company' || lv === 'department')
    ? '<details class="panel"><summary>New key result</summary>' + opForm('kr.new', {}, '', [
        { name: 'kr', targetKey: 'kr', label: 'Id (lowercase words joined by hyphens)', placeholder: 'checkout-conversion' },
        { name: 'title', label: 'Title' }, { name: 'owner', label: 'Owner' },
        { name: 'baseline', kind: 'number', label: 'Baseline' }, { name: 'target', kind: 'number', label: 'Target' },
        { name: 'by', kind: 'date', label: 'Target date' }, { name: 'unit', label: 'Unit (optional)', placeholder: '%' }, { name: 'objective', label: 'Objective' },
        ...(lv === 'department' && upstreamOptions('krs').length ? [{ name: 'aligns_to', label: 'Aligns to (key results above)', options: upstreamOptions('krs'), multiple: true }] : [])
      ], 'Add key result', '') + '</details>'
    : '';
  var head = pageHead('Key results', 'How far each key result has moved, from its baseline to its target.', D.plan && D.plan.period ? esc(D.plan.period) : '');
  if (!D.krs.length) return head + emptyState('No key results yet', lv === 'group' ? 'A group has no key results of its own. Its bets aim at the key results of the plan above.' : 'A key result is a number you want to move this period, from a baseline to a target.', lv === 'group' ? '' : (add ? esc('Use New key result below.') : 'Add one with <code>nikos planning kr new &lt;id&gt;</code>.')) + add;
  return head + '<div class="cards">' + D.krs.map(krCard).join('') + '</div>' + add;
}

function chartSvg(k) {
  // Drawn at the width it is shown at, so its text stays the size of the page's text.
  var W = Math.max(300, Math.min(1040, (main.clientWidth || 680) - 42)), H = W < 500 ? 220 : 280, L = 44, R = 12, T = 18, B = 28;
  var dates = k.checkins.map(function (c) { return c.date; }).concat([k.by, TODAY]);
  var start = dates.reduce(function (a, b) { return ts(b) < ts(a) ? b : a; });
  var end = dates.reduce(function (a, b) { return ts(b) > ts(a) ? b : a; });
  if (start === end) end = addDays(start, 1);
  var values = k.checkins.map(function (c) { return c.value; }).concat([k.baseline, k.target]);
  var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
  if (hi === lo) { lo -= 1; hi += 1; }
  var pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
  var x = function (d) { return L + (ts(d) - ts(start)) / (ts(end) - ts(start)) * (W - L - R); };
  var y = function (v) { return T + (1 - (v - lo) / (hi - lo)) * (H - T - B); };
  var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(k.checkins.length ? k.checkins.length + ' check-ins from ' + k.checkins[0].date + ' to ' + k.checkins[k.checkins.length - 1].date + ', latest ' + num(k.latestValue, k.unit) + '. Baseline ' + num(k.baseline, k.unit) + ', target ' + num(k.target, k.unit) + ' by ' + k.by + '.' : 'No check-ins yet. Baseline ' + num(k.baseline, k.unit) + ', target ' + num(k.target, k.unit) + ' by ' + k.by + '.') + '">';
  s += '<line class="base" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(k.baseline) + '" y2="' + y(k.baseline) + '"></line>';
  s += '<text class="ax" x="' + (W - R) + '" y="' + (y(k.baseline) - 5) + '" text-anchor="end">baseline ' + esc(num(k.baseline, k.unit)) + '</text>';
  s += '<line class="target" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(k.target) + '" y2="' + y(k.target) + '"></line>';
  s += '<text class="ax" x="' + (W - R) + '" y="' + (y(k.target) - 5) + '" text-anchor="end">target ' + esc(num(k.target, k.unit)) + ' by ' + esc(k.by) + '</text>';
  if (k.checkins.length) s += '<polyline class="line" points="' + k.checkins.map(function (c) { return x(c.date) + ',' + y(c.value); }).join(' ') + '"></polyline>';
  k.checkins.forEach(function (c) {
    s += '<circle class="pt" cx="' + x(c.date) + '" cy="' + y(c.value) + '" r="4"><title>' + esc(c.date + ': ' + num(c.value, k.unit)) + '</title></circle>';
  });
  s += '<text class="ax" x="' + L + '" y="' + (H - 8) + '">' + esc(start) + '</text>';
  s += '<text class="ax" x="' + (W - R) + '" y="' + (H - 8) + '" text-anchor="end">' + esc(end) + '</text>';
  s += '<text class="ax" x="' + (L - 6) + '" y="' + (y(hi) + 4) + '" text-anchor="end">' + esc(num(hi - pad, '')) + '</text>';
  s += '<text class="ax" x="' + (L - 6) + '" y="' + (y(lo) + 4) + '" text-anchor="end">' + esc(num(lo + pad, '')) + '</text>';
  return s + '</svg>';
}

function krDetail(id) {
  var k = krById(id);
  if (!k) return '<a class="back" href="#/krs">← Key results</a>' + pageHead('Key result not found', '') + emptyState('There is no key result called ' + id, 'It may have been renamed or removed since this page was made.', '<a href="#/krs">See every key result</a>');
  var upstream = (k.aligned || (k.upstream ? [k.upstream] : [])).map(function (u) {
    return '<div class="panel"><div class="label">Aligned to ' + esc(u.ref) + ' (a read-only copy)</div><div class="val">' +
      (u.kr ? esc(u.kr.title) : 'Not in the synced copy yet. Run nikos planning sync.') + '</div></div>';
  }).join('');
  var checkins = k.checkins.slice().reverse().map(function (c) {
    return '<li><div class="row"><strong class="num">' + esc(num(c.value, k.unit)) + '</strong><span class="muted num">' + esc(c.date) + '</span></div>' +
      (c.note ? '<div>' + esc(c.note) + '</div>' : '') + (c.evidence ? '<div class="muted">Evidence: ' + esc(c.evidence) + '</div>' : '') + '</li>';
  }).join('');
  var lv = D.plan && D.plan.level;
  var pct = Math.max(0, Math.min(100, Math.round(k.progress * 100)));
  var checkinForm = EDIT ? opForm('checkin', { kr: k.id }, k.hash, [
      { name: 'value', kind: 'number', label: 'New value' + (k.unit ? ' (' + k.unit + ')' : ''), value: k.latest ? k.latest.value : k.baseline },
      { name: 'evidence', label: 'Evidence link (optional)', placeholder: 'https://' }, { name: 'note', label: 'Note (optional)', area: true }
    ], 'Check in', 'Saves to ' + k.file) : '';
  var changes = EDIT ? '<details class="panel"><summary>Change this key result</summary>' + opForm('kr.edit', { kr: k.id }, k.hash, [
      { name: 'title', label: 'Title', value: k.title }, { name: 'owner', label: 'Owner', value: k.owner },
      { name: 'by', kind: 'date', label: 'Target date', value: k.by }, { name: 'unit', label: 'Unit', value: k.unit },
      { name: 'objective', label: 'Objective', value: k.objective }, { name: 'stale_after_days', kind: 'number', label: 'Ask for a check-in after (days)', value: k.stale_after_days }
    ], 'Save details', 'Saves to ' + k.file) +
    opForm('kr.target', { kr: k.id }, k.hash, [{ name: 'target', kind: 'number', label: 'New target', value: k.target }], 'Move target', 'The original target stays on record.') +
    (lv !== 'group' && upstreamOptions('krs').length ? opForm('kr.align', { kr: k.id }, k.hash, [{ name: 'aligns_to', label: 'Aligns to (key results above)', options: upstreamOptions('krs'), multiple: true, value: k.aligns_to }], 'Save alignment', 'Saves to ' + k.file) : (lv === 'department' ? '<p class="muted">' + noAbove() + '</p>' : '')) +
    '</details>' : '';
  return '<a class="back" href="#/krs">← Key results</a>' +
    pageHead(k.title, '', k.objective ? esc(k.objective) : 'Key result') +
    '<div class="meta" style="margin-top:-14px"><span>Owner ' + esc(k.owner) + '</span><span>Target date ' + esc(k.by) + '</span></div>' +
    '<div class="stats">' +
      '<div class="stat"><div class="label">Latest value</div><div class="big">' + esc(num(k.latestValue, k.unit)) + '</div><div class="muted">' + (k.latest ? 'Checked in ' + esc(k.latest.date) : 'No check-in yet') + '</div></div>' +
      '<div class="stat"><div class="label">Baseline to target</div><div class="val">' + esc(num(k.baseline, k.unit)) + ' → ' + esc(num(k.target, k.unit)) + '</div>' +
        '<div class="progress' + (k.stale ? ' stale' : '') + '" role="img" aria-label="' + pct + '% of the way"><div style="width:' + pct + '%"></div></div><div class="muted num" style="margin-top:6px">' + pct + '% of the way</div></div>' +
      '<div class="stat"><div class="label">Status</div><div class="val">' + (k.stale ? chip('Needs a check-in', 'amber') : k.checkins.length ? chip('Checked in recently', 'green') : chip('No check-in yet', '')) + '</div>' +
        '<div class="muted">' + (k.stale ? 'No check-in in the last ' + esc(k.stale_after_days || 14) + ' days.' : 'Asks for a check-in after ' + esc(k.stale_after_days || 14) + ' days.') + '</div></div>' +
    '</div>' + upstream +
    '<div class="panel"><h3>Over time</h3>' + chartSvg(k) + '<div class="legend" aria-hidden="true"><span><i class="kr"></i>Check-ins</span><span>- - Target</span><span>— Baseline</span></div></div>' +
    checkinForm +
    '<div class="panel"><h3>Check-ins</h3>' + (checkins ? '<ul class="checkins">' + checkins + '</ul>' : '<p class="muted">No check-ins yet. ' + (EDIT ? 'Add the first one above.' : 'Add one with <code>nikos planning checkin ' + esc(k.id) + ' &lt;value&gt;</code>.') + '</p>') + '</div>' +
    changes;
}

function betsView() {
  var lv = D.plan && D.plan.level;
  var add = EDIT && lv !== 'team'
    ? '<details class="panel"><summary>New bet</summary>' + opForm('bet.new', {}, '', [
        { name: 'bet', targetKey: 'bet', label: 'Id (lowercase words joined by hyphens)', placeholder: 'faster-checkout' },
        { name: 'owner', label: 'Owner' }, { name: 'hypothesis', label: 'Hypothesis: if we do this, we expect that, because…', area: true },
        { name: 'review_on', kind: 'date', label: 'Review date' }, { name: 'team', label: 'Team (optional)' },
        { name: 'primary', label: 'Key result it moves', options: ownKrOptions().concat(upstreamOptions('krs')) },
        ...(lv !== 'company' && upstreamOptions('bets').length ? [{ name: 'aligns_to', label: 'Aligns to (bets above)', options: upstreamOptions('bets'), multiple: true }] : [])
      ], 'Add bet', 'Saves a new file in planning/bets') + '</details>'
    : '';
  var head = pageHead('Bets', 'What we believe will move a key result, what has been delivered, and what it moved.');
  if (!D.bets.length) return head + emptyState('No bets yet', 'A bet says what you believe will move a key result, and why. It has a review date, not a deadline.', add ? esc('Use New bet below.') : 'Add one with <code>nikos planning bet new &lt;bet-id&gt;</code>.') + add;
  return head + add + D.bets.map(betCard).join('');
}

function betCard(b) {
  var d = b.delivery;
  var refs = [];
  if (b.krs.primary) refs.push(b.krs.primary);
  b.krs.also.forEach(function (r) { refs.push(r); });
  var krLinks = refs.map(function (r) {
    var k = krById(r);
    return k ? '<a class="chip" href="#/kr/' + esc(r) + '">' + esc(k.title) + '</a>' : chip(r, 'lock');
  }).join(' ') || '<span class="muted">No key result linked</span>';
  var releases = b.releases.length ? b.releases.map(function (r) {
    return LIVE ? '<a class="chip blue" href="' + esc(r.href) + '">Release ' + r.number + '</a>' : chip('Release ' + r.number, 'blue');
  }).join(' ') : '<span class="muted">Not on a release yet</span>';
  var stories = d.stories.map(function (s) {
    var fresh = s.freshness && s.freshness !== 'current' && s.freshness !== 'in-place' ? ' <span class="muted">(' + esc(s.freshness) + ')</span>' : '';
    return '<li><span class="sid">' + esc(s.id) + '</span>' + esc(statusWord(s.status)) + fresh + '</li>';
  }).join('');
  var reviews = b.reviews.length ? '<ol class="reviews">' + b.reviews.slice().reverse().map(function (r) {
    return '<li><span class="muted num">' + esc(r.date) + '</span> <strong>' + esc(cap(r.decision)) + '</strong>' + (r.outcome ? ' (' + esc(r.outcome) + ')' : '') + '<div>' + esc(r.reason) + '</div></li>';
  }).join('') + '</ol>' : '<p class="muted">No reviews yet. The first is due ' + esc(b.review_on) + '.</p>';
  var edit = EDIT ? opForm('bet.edit', { bet: b.id }, b.hash, [
      { name: 'owner', label: 'Owner', value: b.owner }, { name: 'team', label: 'Team', value: b.team },
      { name: 'hypothesis', label: 'Hypothesis', value: b.hypothesis, area: true },
      { name: 'starts', kind: 'date', label: 'Starts', value: b.starts }, { name: 'review_on', kind: 'date', label: 'Review date', value: b.review_on },
      { name: 'deadline', kind: 'date', label: 'Deadline (optional)', value: b.deadline },
      { name: 'confidence', label: 'Confidence', value: b.confidence, options: ['low', 'medium', 'high'] },
      { name: 'dependencies', kind: 'list', label: 'Dependencies (separate with commas)', value: b.dependencies.join(', ') }
    ], 'Save bet', 'Saves to ' + b.file) : '';
  var review = EDIT ? opForm('bet.review', { bet: b.id }, b.hash, [
      { name: 'decision', label: 'Decision', value: 'continue', options: ['continue', 'change', 'stop', 'complete'] },
      { name: 'outcome', label: 'Outcome (only when you complete it)', options: ['won', 'lost'] },
      { name: 'reason', label: 'Reason', area: true }
    ], 'Save review', 'Saves to ' + b.file) : '';
  return '<article class="card bet-card" id="bet-' + esc(b.id) + '" aria-labelledby="bet-title-' + esc(b.id) + '">' +
    '<div class="card-head"><div><div class="eyebrow">Bet · <span class="sid" style="margin:0">' + esc(b.id) + '</span></div><h2 class="card-title" id="bet-title-' + esc(b.id) + '">' + esc(betTitle(b.id)) + '</h2></div>' +
      '<div class="row" style="justify-content:flex-end">' + chip(cap(b.outcome), outcomeClass(b.outcome)) + chip(cap(b.confidence) + ' confidence', '') + '</div></div>' +
    '<p class="hyp">' + esc(b.hypothesis) + '</p>' +
    '<div class="meta"><span>Owner ' + esc(b.owner) + '</span>' + (b.team ? '<span>Team ' + esc(b.team) + '</span>' : '') + '<span>Review ' + esc(b.review_on) + '</span>' + (b.deadline ? '<span>Deadline ' + esc(b.deadline) + '</span>' : '') + '</div>' +
    '<div class="split">' +
      '<div class="box"><div class="label">Delivery</div><div class="val">' + esc(d.text) + '</div>' +
        (stories ? '<ul class="stories">' + stories + '</ul>' : '') + '<div class="row">' + releases + '</div></div>' +
      '<div class="box"><div class="label">Outcome</div><div class="val">' + esc(cap(b.outcome)) + '</div><div class="row">' + krLinks + '</div></div>' +
    '</div>' +
    ((b.aligns_to || []).length ? '<div class="row" style="margin-top:10px"><span class="muted">Aligns to</span>' + b.aligns_to.map(function (r) { return chip(r, 'lock'); }).join(' ') + '</div>' : '') +
    (b.body ? '<div class="prose">' + prose(b.body) + '</div>' : '') +
    '<h4>Reviews</h4>' + reviews +
    (EDIT ? '<div class="disclosures"><details><summary>Edit this bet</summary>' + edit + '</details><details><summary>Review this bet</summary>' + review + '</details></div>' : '') +
    '</article>';
}

// The bet card's notes: "## " lines become headings, the rest stays plain escaped text.
function prose(text) {
  // Headings are blocks, so the line breaks either side of them would show as blank lines.
  return text.trim().split('\n').map(function (l) {
    return /^#{2,3} /.test(l) ? '<h4>' + esc(l.replace(/^#+ /, '')) + '</h4>' : esc(l);
  }).join('\n').replace(/\n*(<h4>)/g, '$1').replace(/(<\/h4>)\n*/g, '$1');
}

function timelineView() {
  if (!D.bets.length) return pageHead('Timeline', '') + emptyState('Nothing to plot yet', 'The timeline shows each bet from its start to its deadline or review date. Add a bet and it appears here.', '<a href="#/bets">Go to Bets</a>');
  var rows = D.bets.map(function (b) {
    var s = b.starts || (b.reviews.length ? b.reviews[0].date : b.review_on);
    var e = b.deadline || b.review_on;
    if (ts(e) < ts(s)) e = s;
    return { b: b, s: s, e: e, group: b.team || b.owner };
  });
  var lo = ts(TODAY), hi = ts(TODAY);
  rows.forEach(function (r) { lo = Math.min(lo, ts(r.s)); hi = Math.max(hi, ts(r.e)); });
  lo -= 7 * DAY; hi += 14 * DAY;
  var pct = function (ms) { return ((ms - lo) / (hi - lo) * 100).toFixed(2); };
  var axis = '';
  var first = new Date(lo);
  for (var i = 0; i < 60; i++) {
    var m = Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, 1);
    if (m > hi) break;
    if (m >= lo) axis += '<span style="left:' + pct(m) + '%">' + MONTHS[new Date(m).getUTCMonth()] + ' ' + new Date(m).getUTCFullYear() + '</span>';
  }
  var todayPct = pct(ts(TODAY));
  var groups = {}, order = [];
  rows.forEach(function (r) {
    if (!groups[r.group]) { groups[r.group] = []; order.push(r.group); }
    groups[r.group].push(r);
  });
  var lanesHtml = order.map(function (g) {
    var ends = [];
    var placed = groups[g].slice().sort(function (a, b) { return ts(a.s) - ts(b.s); }).map(function (r) {
      var lane = 0;
      while (lane < ends.length && ends[lane] > ts(r.s)) lane++;
      ends[lane] = ts(r.e);
      return { r: r, lane: lane };
    });
    var out = '';
    for (var n = 0; n < ends.length; n++) {
      var bars = placed.filter(function (p) { return p.lane === n; }).map(function (p) {
        var r = p.r;
        var left = pct(ts(r.s));
        var width = Math.max(1.5, (ts(r.e) - ts(r.s)) / (hi - lo) * 100);
        return '<a class="tbar ' + barClass(r.b.outcome) + '" href="#/bets/' + esc(r.b.id) + '" style="left:' + left + '%;width:' + width.toFixed(2) + '%" title="' + esc(betTitle(r.b.id) + ': ' + r.b.hypothesis + ' (' + r.s + ' to ' + r.e + ')') + '" aria-label="' + esc(betTitle(r.b.id) + ', ' + cap(r.b.outcome) + ', ' + r.s + ' to ' + r.e) + '">' + esc(betTitle(r.b.id)) + '</a>';
      }).join('');
      out += '<div class="lane"><div class="tlabel">' + (n === 0 ? esc(g) : '') + '</div><div class="track"><div class="today" style="left:' + todayPct + '%"></div>' + bars + '</div></div>';
    }
    return out;
  }).join('');
  return pageHead('Timeline', 'One row per team, or owner. Each bar runs from the start of a bet to its deadline, or to its review date.') +
    '<div class="panel"><p class="scroll-hint" aria-hidden="true">Scroll sideways to see the whole period.</p><div class="timeline" tabindex="0" role="region" aria-label="Bets over time"><div class="timeline-inner"><div class="axis" aria-hidden="true">' + axis + '</div>' + lanesHtml + '</div></div>' +
    '<div class="legend"><span class="today-key">Today</span><span><i style="background:#1C5AA6;border-color:#1C5AA6"></i>Open</span><span><i style="background:#8A5300;border-color:#8A5300"></i>Awaiting evidence</span><span><i style="background:#12733F;border-color:#12733F"></i>Won</span><span><i style="background:#5B6267;border-color:#5B6267"></i>Lost or stopped</span></div></div>';
}
`;

// The form code, shared by the live dashboard and an editable snapshot: toasts, reading a form, and the clicks.
const FORM_JS = String.raw`
var toastEl = document.getElementById('toast');
// A short message in the corner, read out by screen readers. A problem stays longer, to be read.
function toast(text, bad) {
  toastEl.textContent = text;
  toastEl.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(function () { toastEl.className = 'toast'; }, bad ? 9000 : 4000);
}
// A button shows it is working until the save comes back, so it can't be clicked twice.
function busy(btn, text) {
  if (!btn) return function () {};
  var was = btn.textContent;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.textContent = text;
  return function () { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = was; };
}
function closest(el, sel) {
  while (el && el.nodeType === 1) {
    if (el.matches && el.matches(sel)) return el;
    el = el.parentNode;
  }
  return null;
}
// Reads a form's fields into the op's target and args. An empty optional field is sent as "", which deletes it on edit.
function submitForm(form) {
  var op = form.getAttribute('data-op-form');
  var target = JSON.parse(form.getAttribute('data-target') || '{}');
  var expect = form.getAttribute('data-expect') || '';
  var args = {};
  var els = form.querySelectorAll('[data-field]');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var name = el.getAttribute('data-field');
    var kind = el.getAttribute('data-kind');
    var value;
    if (el.multiple) value = Array.prototype.map.call(el.selectedOptions, function (o) { return o.value; });
    else if (kind === 'list') value = el.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    else if (kind === 'number') {
      if (el.value.trim() === '') { if (!el.getAttribute('data-target-key')) args[name] = ''; continue; }
      value = Number(el.value);
      if (!isFinite(value)) { if (el.focus) el.focus(); return toast('Enter a number for ' + name.replace(/_/g, ' '), true); }
    } else value = el.value.trim();
    if (el.getAttribute('data-target-key')) target[el.getAttribute('data-target-key')] = value;
    else args[name] = value;
  }
  var box = form.querySelector('[data-confirm]');
  if (box && box.checked) args.confirm = true;
  var done = busy(form.querySelector('[data-op-submit]'), 'Saving…');
  return Promise.resolve(apiOp(op, target, args, expect)).then(done, done);
}
// The clicks on forms, the reload button, the git buttons and copy.
document.addEventListener('click', function (e) {
  var t = e.target;
  var submit = closest(t, '[data-op-submit]');
  if (submit) return submitForm(closest(submit, '[data-op-form]'));
  var act = closest(t, '[data-act]');
  if (act && act.getAttribute('data-act') === 'reload') { NOTICE = ''; return reload(); }
  var git = closest(t, '[data-git]');
  if (git) { var ungit = busy(git, git.getAttribute('data-git') === 'commit' ? 'Committing…' : git.getAttribute('data-git') === 'push' ? 'Pushing…' : 'Opening…'); return Promise.resolve(gitAction(git.getAttribute('data-git'))).then(ungit, ungit); }
  var copy = closest(t, '[data-copy]');
  if (copy && navigator.clipboard) navigator.clipboard.writeText(copy.getAttribute('data-copy')).then(function () { toast('Copied'); }, function () { toast('Copying did not work. Select the command and copy it yourself.', true); });
});
`;

// Live-only code: saving through /api/op, the pending bar and its git buttons. Absent from the export.
const SAVE_JS = String.raw`
try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* the token is already in the page */ }
function parseReply(r) {
  return r.json().catch(function () { return {}; }).then(function (body) { return { ok: r.ok, status: r.status, body: body }; });
}
function postJson(path, body) {
  return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nikos-Token': TOKEN }, body: JSON.stringify(body) }).then(parseReply);
}
function reload() {
  return fetch('/api/data').then(function (r) { return r.json(); }).then(function (d) { D = d; render(); pendingRefresh(); })
    .catch(function () { NOTICE = 'Could not reach the dashboard. Is nikos serve still running? <button type="button" data-act="reload">Try again</button>'; render(); });
}
// One change, through the same write path as the command line. 409: the file moved on since it was loaded.
function apiOp(op, target, args, expect) {
  return postJson('/api/op', { op: op, target: target || {}, args: args || {}, expect: expect || '' })
    .then(function (res) {
      if (res.ok) {
        NOTICE = '';
        toast(res.body.message || 'Saved');
        return reload();
      }
      if (res.status === 409) {
        NOTICE = 'Someone changed this file since you opened the page, so your change was not saved. Reload to see the new version, then make your change again. <button type="button" data-act="reload">Reload</button>';
        render();
      }
      toast(res.body.error || 'Could not save. Nothing was changed.', true);
    })
    .catch(function () { toast('Could not reach the dashboard, so nothing was saved. Is nikos serve still running?', true); });
}
// The pending bar: what's saved but not committed, and the git buttons. Each button is its own click.
var PENDING = null;
function pendingRefresh() {
  return fetch('/api/pending', { headers: { 'X-Nikos-Token': TOKEN } }).then(function (r) { return r.json(); }).then(function (p) { PENDING = p; drawPending(); }).catch(function () {});
}
function drawPending() {
  var box = document.getElementById('pending');
  if (!box || !PENDING) return;
  var p = PENDING;
  if (!p.git) { box.innerHTML = '<div class="row"><span class="state">' + esc(p.message) + '</span></div>'; return; }
  var n = p.files.length;
  var html = '<div class="row"><span class="state ' + (n ? 'dirty' : 'clean') + '">' + (n ? n + (n === 1 ? ' saved change' : ' saved changes') + ' not committed yet' + (p.branch ? ', on branch <code>' + esc(p.branch) + '</code>' : '') : 'Everything is committed') + '</span><span class="spacer"></span>';
  if (n && p.branch) html += '<button type="button" data-git="commit">Commit</button>';
  if (p.branch && !p.onBase && p.hasOrigin) html += '<button type="button" data-git="push">Push branch</button>';
  if (p.branch && !p.onBase && p.forge.prCommand && p.forge.pushed) {
    if (p.forge.tool) html += '<button type="button" class="primary" data-git="pr">' + esc(p.forge.requestLabel) + '</button>';
    else html += '<code>' + esc(p.forge.prCommand) + '</code><button type="button" data-copy="' + esc(p.forge.prCommand) + '">Copy command</button>';
  }
  html += '</div>';
  if (p.branch && !p.onBase && p.hasOrigin && !p.forge.pushed) html += '<div class="muted">Push the branch first. Then you can open a request to merge it.</div>';
  if (n && p.paths && p.paths.length) html += '<details><summary>' + (n === 1 ? 'Show the file' : 'Show the ' + n + ' files') + '</summary><div class="muted">' + p.paths.map(function (x) { return '<code>' + esc(x) + '</code>'; }).join('<br>') + '</div></details>';
  if (p.notice) html += '<div class="muted">' + esc(p.notice) + '</div>';
  if (p.warning) html += '<div class="notice">' + esc(p.warning) + '</div>';
  box.innerHTML = html;
}
function gitAction(name) {
  var path = name === 'commit' ? '/api/git/commit' : name === 'push' ? '/api/git/push' : '/api/git/pr';
  var body = name === 'pr' ? { confirm: true } : {};
  return postJson(path, body).then(function (res) {
    if (res.ok) {
      if (name === 'commit') toast('Committed ' + String(res.body.committed || '').slice(0, 7));
      else if (name === 'push') toast('Pushed ' + res.body.pushed);
      else if (res.body.ran === false) toast(res.body.message || 'The request was not opened', true);
      else toast(res.body.output || 'Request opened');
    } else toast(res.body.error || 'That did not work. Nothing was changed.', true);
    return pendingRefresh();
  }, function () { toast('Could not reach the dashboard. Is nikos serve still running?', true); });
}
pendingRefresh();
`;

// An editable snapshot's changes: each form queues an op here instead of saving it. Nothing is
// sent anywhere. The page checks the fields with the shared rules, and downloads the change file.
const QUEUE_JS = String.raw`
var QUEUE = [];
var MADE_BY = '';
var KINDS = { kr: 'kr', bet: 'bet', story: 'story', activity: 'activity', step: 'step', release: 'release', map: 'map', team: 'team' };
// The field rules the commands share, checked here too. Ids and fields only: the full check runs at nikos apply.
function pageProblem(op, t, a) {
  var keys = Object.keys(t || {});
  for (var i = 0; i < keys.length; i++) {
    if (!KINDS[keys[i]]) return "'" + keys[i] + "' isn't a kind of target nikOS knows";
    var p = idProblem(KINDS[keys[i]], t[keys[i]]);
    if (p) return p;
  }
  if (op === 'checkin') return numberProblem('checkin', a.value);
  if (op === 'kr.new') return krFieldProblems(a, 'new')[0];
  if (op === 'kr.edit') return krFieldProblems(a, 'edit')[0];
  if (op === 'kr.target') return numberProblem('target', a.target);
  if (op === 'bet.edit') return betFieldProblems(a)[0];
  if (op === 'bet.review') return decisionProblem(a.decision) || reasonProblem(a.reason);
  if (op === 'story.rename') return titleProblem('story', a.title);
  if (op === 'activity.rename') return titleProblem('activity', a.title);
  if (op === 'step.rename') return titleProblem('step', a.title);
  return undefined;
}
function targetText(t) { return Object.keys(t || {}).map(function (k) { return t[k]; }).join(' '); }
function opLabel(op, t, a) {
  var rest = Object.keys(a || {}).filter(function (k) { return k !== 'confirm'; }).map(function (k) { return k + ' ' + JSON.stringify(a[k]); }).join(', ');
  return op + ' ' + targetText(t) + (rest ? ' · ' + (rest.length > 90 ? rest.slice(0, 89) + '…' : rest) : '');
}
function fileOf(op, t) {
  if (t && t.kr) { var k = krById(t.kr); return k ? k.file : ''; }
  if (t && t.bet) { for (var i = 0; i < D.bets.length; i++) if (D.bets[i].id === t.bet) return D.bets[i].file; }
  return '';
}
function apiOp(op, target, args, expect) {
  var problem = pageProblem(op, target, args);
  if (problem) return toast(problem, true);
  QUEUE.push({ op: op, target: target || {}, args: args || {}, expect: expect || '' });
  drawChanges();
  toast('Added to the changes: ' + op);
}
function drawChanges() {
  var box = document.getElementById('pending');
  if (!box) return;
  var n = QUEUE.length;
  var html = '<div class="row"><span class="state ' + (n ? 'dirty' : '') + '">' + (n ? n + (n === 1 ? ' change' : ' changes') + ' ready to download' : 'No changes yet') + '</span><span class="spacer"></span>' +
    '<label class="row muted" for="made-by">Your name</label><input id="made-by" maxlength="100" value="' + esc(MADE_BY) + '" style="width:auto;min-height:36px">' +
    '<button type="button" class="primary" data-download' + (n ? '' : ' disabled') + '>Download changes</button></div>' +
    '<div class="muted">Your name only records who made the changes. This page checks each field; the full check runs when someone runs nikos apply on the file. The pages still show the plan as it was exported.</div>';
  if (n) html += '<ul class="checkins">' + QUEUE.map(function (c, i) {
    var f = fileOf(c.op, c.target);
    return '<li class="row"><span>' + esc(opLabel(c.op, c.target, c.args)) + '<div class="muted">' + (f ? 'File ' + esc(f) + ' · ' : '') + (c.expect ? 'expect ' + esc(c.expect) : 'no expect') + '</div></span><span class="spacer"></span>' +
      '<button type="button" data-remove-change="' + i + '">Remove</button></li>';
  }).join('') + '</ul>';
  box.innerHTML = html;
}
function slug(s) { return String(s || 'plan').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'plan'; }
function downloadChanges() {
  var plan = D.plan || {};
  var doc = {
    format: 'nikos-planning-changes',
    format_version: 1,
    plan: { level: plan.level, name: String(plan.name || D.project).slice(0, 100) },
    source: D.snapshot.source,
    with_linked: !!D.snapshot.withLinked,
    operations: QUEUE.map(function (c) {
      var o = { op: c.op, target: c.target, args: c.args };
      if (c.expect) o.expect = c.expect;
      return o;
    })
  };
  if (MADE_BY.trim()) doc.made_by = MADE_BY.trim().slice(0, 100);
  var name = slug(plan.name || D.project) + '-changes-' + new Date().toISOString().slice(0, 10) + '.nikos.json';
  var blob = new Blob([JSON.stringify(doc, null, 2) + '\n'], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast('Downloaded ' + name);
}
document.addEventListener('input', function (e) { if (e.target && e.target.id === 'made-by') MADE_BY = e.target.value; });
document.addEventListener('click', function (e) {
  var t = e.target;
  var rm = closest(t, '[data-remove-change]');
  if (rm) { QUEUE.splice(Number(rm.getAttribute('data-remove-change')), 1); return drawChanges(); }
  if (closest(t, '[data-download]')) return downloadChanges();
});
drawChanges();
`;

export interface DashboardOptions {
  data: any;
  token?: string;
  /** The live dashboard is not read-only. An export is, unless it is editable. */
  readOnly: boolean;
  /** An export that queues changes for nikos apply. Only with readOnly: its saves are downloads. */
  editable?: boolean;
}

/** The sections a plan level shows, in the sidebar. */
function navFor(level: string | null): string {
  const items: [string, string][] =
    level === "group"
      ? [["groupmaps", "Bets and story maps"], ["bets", "Bets"], ["timeline", "Timeline"]]
      : level === "company" || level === "department"
        ? [["krs", "Key results"], ["okrs", "OKRs and bets"], ["ladder", "OKR ladder"], ["bets", "Bets"], ["timeline", "Timeline"]]
        : [["krs", "Key results"], ["bets", "Bets"], ["timeline", "Timeline"]];
  return items.map(([id, label]) => `<a data-nav="${id}" href="#/${id}">${label}</a>`).join("") + `<a data-nav="guide" href="#/guide">How it works</a>`;
}

/** The whole dashboard as one HTML page. Read-only renders carry no save code and no token. */
export function renderDashboard({ data, token, readOnly, editable = false }: DashboardOptions): string {
  const live = !readOnly;
  // Forms show on the live dashboard and in an editable snapshot. Only the live one saves.
  const edit = live || editable;
  const snapshot = edit && !live;
  const json = JSON.stringify(data).replace(/[<\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  const nav = navFor(data.plan?.level ?? null);
  // The link out appears only in the served dashboard: an export is a closed file with no outside links.
  const links = live
    ? `<div class="links"><a href="https://www.nikovijay.com/connect?from=nikos-planning" target="_blank" rel="noopener">Made by Niko Vijay</a></div>\n`
    : "";
  const extra = live
    ? `<h4>Story map</h4><a href="/map">Story map</a>` +
      ((data.views as string[]).length
        ? `<h4>Custom views</h4>${(data.views as string[]).map((v) => `<a href="/views/${esc(v)}">${esc(v)}</a>`).join("")}`
        : "")
    : "";
  // What this page is, in one tag and one line: live and saving, or a snapshot.
  const mode = live
    ? `<span class="mode-tag">Live</span><span>Changes save to this repo's files. Nothing is pushed until you click Push.</span>`
    : snapshot
      ? `<span class="mode-tag snap">Snapshot, editable</span><span>Your changes stay in this page until you download them. Nothing is written to the repo until someone runs nikos apply on the file.</span>`
      : `<span class="mode-tag snap">Snapshot, read only</span><span>The plans as they were when this file was made${data.snapshot?.source?.exported ? `, on ${esc(String(data.snapshot.source.exported).slice(0, 10))}` : ""}.</span>`;
  // The page's own field checks: the same functions the commands' rules are, as source.
  const rulesJs = snapshot ? Object.values(rules).map((f) => (f as Function).toString()).join("\n") : "";
  const script = [
    `var LIVE = ${live};`,
    `var EDIT = ${edit};`,
    `var SNAPSHOT = ${snapshot};`,
    live ? `var TOKEN = ${JSON.stringify(token ?? "")};` : "",
    rulesJs,
    VIEWS_JS,
    edit ? FORM_JS : "",
    live ? SAVE_JS : "",
    snapshot ? QUEUE_JS : "",
    "render();",
  ].join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.project)} · nikOS planning</title>
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to the content</a>
<div class="shell">
<aside class="side">
<div class="brand"><span class="mark" aria-hidden="true">n</span><div><div class="brand-name">nikOS planning</div><div class="project">${esc(data.project)}</div></div></div>
<nav aria-label="Pages">${nav}${extra}</nav>
${links}</aside>
<div class="content">
<div class="mode">${mode}</div>
${edit ? '<div id="pending" class="pending" aria-live="polite"></div>' : ""}
<main id="main" tabindex="-1"></main>
</div>
</div>
<div id="toast" class="toast" role="status" aria-live="polite" aria-atomic="true"></div>
<script type="application/json" id="nikos-data">${json}</script>
<script>
${script}
</script>
</body>
</html>
`;
}
