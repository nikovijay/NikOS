// The dashboard page: one HTML file with the data embedded as JSON. Inline CSS and vanilla
// JS draw the views, so the live dashboard and the offline export are the same page. A
// read-only render leaves out the save code and the token altogether.
import { esc } from "../commands/map.js";
import * as rules from "./rules.js";

const CSS = `
:root { --ground: #F2F3EF; --surface: #FFFFFF; --ink: #111411; --ink-2: #3F453F; --muted: #5C625C; --faint: #9AA19A; --line: #DCDFD8; --line-2: #B9BEB6; --accent: #14823E; --accent-soft: #E2EFE5; --amber: #A86A00; --amber-soft: #FBF1DC; --blue: #1F5FA8; --blue-soft: #E3ECF7; --grey-soft: #ECEEEA; --red: #8A2E1F; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--ground); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
.shell { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
.side { background: var(--surface); border-right: 1px solid var(--line); padding: 20px 14px; display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
.links { margin-top: auto; padding-top: 16px; }
.links a { padding: 0 10px; color: var(--muted); text-decoration: none; font-size: 12px; }
.links a:hover { color: var(--ink-2); text-decoration: underline; }
.brand { font-weight: 700; letter-spacing: .02em; }
.project { color: var(--muted); font-size: 13px; margin-bottom: 14px; }
nav a { display: block; padding: 6px 10px; border-radius: 6px; color: var(--ink-2); text-decoration: none; font-size: 14px; }
nav a.on, nav a:hover { background: var(--accent-soft); color: var(--ink); }
nav h4 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 16px 10px 4px; }
.content { padding: 24px 32px 60px; max-width: 980px; min-width: 0; }
.mode { font-size: 12px; color: var(--muted); margin-bottom: 4px; }
h1 { font-size: 22px; margin: 4px 0 6px; }
h2 { font-size: 17px; margin: 0; }
h3 { font-size: 14px; margin: 0 0 8px; }
h4 { font-size: 14px; margin: 14px 0 4px; }
a { color: var(--blue); }
.muted { color: var(--muted); font-size: 13px; }
.back { font-size: 13px; text-decoration: none; }
.card, .panel { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin-bottom: 12px; color: inherit; text-decoration: none; display: block; }
a.card:hover { border-color: var(--line-2); }
.cards { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.big { font-size: 26px; font-weight: 700; }
.progress { height: 8px; background: var(--line); border-radius: 99px; overflow: hidden; margin-top: 10px; }
.progress > div { height: 100%; background: var(--accent); }
.chip { display: inline-block; font-size: 12px; padding: 2px 9px; border-radius: 99px; background: var(--grey-soft); color: var(--ink-2); border: 1px solid transparent; text-decoration: none; }
.chip.green { background: var(--accent-soft); color: var(--accent); }
.chip.amber { background: var(--amber-soft); color: var(--amber); }
.chip.blue { background: var(--blue-soft); color: var(--blue); }
.chip.lock { background: var(--surface); border-color: var(--line-2); color: var(--muted); }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 14px 0; }
.stat { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
.label { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.viewbar { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; margin: 0 0 14px; }
.viewbar .field { display: inline-flex; gap: 8px; align-items: center; }
.pill { border: 1px solid var(--line-2); border-radius: 8px; background: var(--surface); padding: 4px 10px; font-size: 14px; }
.seg { display: inline-flex; border: 1px solid var(--line-2); border-radius: 8px; overflow: hidden; background: var(--surface); }
.seg a { padding: 4px 12px; font-size: 14px; color: var(--ink-2); text-decoration: none; }
.seg a + a { border-left: 1px solid var(--line-2); }
.seg a[aria-current] { background: var(--grey-soft); color: var(--ink); font-weight: 600; }
.tree { overflow-x: auto; }
.tree svg { display: block; min-width: 520px; font-family: inherit; }
.t-head { font-size: 12px; fill: var(--muted); }
.t-card rect { stroke-width: 1; }
.t-title { font-size: 14px; font-weight: 600; }
.t-sub { font-size: 12px; fill: var(--muted); }
.t-card.up rect { fill: #F1EFEA; stroke: #B9B4A8; } .t-card.up .t-title { fill: #44413A; } .t-card.up .t-sub { fill: #5F5B52; }
.t-card.kr rect { fill: #EEEDFB; stroke: #A9A2E8; } .t-card.kr .t-title { fill: #3B3194; } .t-card.kr .t-sub { fill: #5B4FC7; }
.t-card.bet rect { fill: var(--accent-soft); stroke: #7DBF97; } .t-card.bet .t-title { fill: #0E5A2B; } .t-card.bet .t-sub { fill: var(--accent); }
.t-card.dim { opacity: .4; }
a .t-card:hover rect { stroke-width: 2; }
.t-link { fill: none; stroke-width: 1.5; }
.t-link.kr { stroke: #7F77DD; opacity: .8; } .t-link.bet { stroke: #1D9E75; opacity: .75; } .t-link.dim { opacity: .45; }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 12px 0; }
.box { border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
.box.delivery { background: #F6F7F3; }
.box.outcome { background: var(--surface); }
.val { font-weight: 600; margin: 2px 0 6px; }
.hyp { font-size: 16px; margin: 10px 0 4px; }
.prose { white-space: pre-line; color: var(--ink-2); font-size: 14px; margin-top: 8px; }
.stories { list-style: none; padding: 0; margin: 6px 0; font-size: 13px; }
.sid { font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: var(--muted); margin-right: 4px; }
.reviews { padding-left: 18px; font-size: 13px; margin: 6px 0 0; }
.form { display: grid; gap: 10px; }
.form label { display: grid; gap: 4px; font-size: 13px; color: var(--ink-2); }
.fields { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
input, select, textarea { font: inherit; padding: 7px 9px; border: 1px solid var(--line-2); border-radius: 6px; background: var(--surface); color: var(--ink); width: 100%; }
textarea { resize: vertical; }
button { font: inherit; padding: 7px 14px; border-radius: 6px; border: 1px solid var(--line-2); background: var(--surface); color: var(--ink); cursor: pointer; }
button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.chart { width: 100%; height: auto; display: block; }
.chart .base { stroke: var(--faint); stroke-width: 1.5; }
.chart .target { stroke: var(--accent); stroke-width: 1.5; stroke-dasharray: 6 4; }
.chart .line { fill: none; stroke: var(--blue); stroke-width: 2.5; }
.chart .pt { fill: var(--blue); }
.chart .ax { font-size: 11px; fill: var(--muted); }
.checkins { list-style: none; padding: 0; margin: 0; font-size: 13px; }
.tree, .tree ul { list-style: none; margin: 0; padding: 0; font-size: 14px; }
.tree ul { margin-left: 9px; padding-left: 16px; border-left: 1px solid var(--line-2); }
.tree li { padding: 3px 0; }
.tree > li { padding: 8px 0; border-bottom: 1px solid var(--line); }
.tree > li:last-child { border-bottom: 0; }
.tree .kind { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-right: 6px; }
.checkins li { padding: 6px 0; border-bottom: 1px solid var(--line); }
.timeline { --label: 170px; overflow-x: auto; }
.axis { position: relative; height: 20px; margin-left: var(--label); font-size: 11px; color: var(--muted); }
.axis span { position: absolute; white-space: nowrap; }
.lane { display: flex; border-top: 1px solid var(--line); min-height: 36px; }
.tlabel { width: var(--label); flex: none; padding: 8px 10px 8px 0; font-size: 13px; color: var(--ink-2); }
.track { position: relative; flex: 1; min-height: 36px; }
.tbar { position: absolute; top: 7px; height: 22px; line-height: 22px; padding: 0 7px; border-radius: 5px; font-size: 12px; color: #fff; background: var(--blue); white-space: nowrap; overflow: hidden; text-decoration: none; }
.tbar.won { background: var(--accent); }
.tbar.awaiting { background: var(--amber); }
.tbar.closed { background: #7C827B; }
.today { position: absolute; top: 0; bottom: 0; border-left: 2px solid var(--ink); opacity: .45; }
.alts { display: flex; flex-direction: column; }
.alt { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; background: var(--surface); }
.alt.here { border-color: var(--accent); background: var(--accent-soft); }
.alt.delivery { background: #F6F7F3; }
.alt .row { margin-bottom: 2px; }
.alt-arrow { font-size: 12px; color: var(--muted); padding: 4px 12px; }
.steps { margin: 0; padding-left: 20px; font-size: 14px; color: var(--ink-2); display: grid; gap: 8px; }
.notice { background: var(--amber-soft); color: var(--amber); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; font-size: 13px; }
.toast { position: fixed; right: 20px; bottom: 20px; max-width: 360px; background: var(--ink); color: #fff; padding: 10px 14px; border-radius: 8px; opacity: 0; pointer-events: none; transition: opacity .2s; font-size: 14px; }
.toast.show { opacity: 1; }
.toast.bad { background: var(--red); }
.pending { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; margin-bottom: 12px; font-size: 14px; }
.pending .row { gap: 10px; }
.pending code { font-size: 12px; }
details { margin-bottom: 12px; }
details > summary { cursor: pointer; color: var(--ink-2); }
details .panel { margin-top: 8px; }
.form input[type=checkbox] { width: auto; }
@media (max-width: 720px) {
  .shell { grid-template-columns: 1fr; }
  .side { border-right: 0; border-bottom: 1px solid var(--line); position: static; height: auto; }
  .links { margin-top: 16px; }
  .content { padding: 16px 12px 48px; }
  .split, .fields { grid-template-columns: 1fr; }
  .timeline { --label: 96px; }
}
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
function outcomeClass(o) { return o === 'won' ? 'green' : o === 'awaiting evidence' ? 'amber' : o === 'open' ? 'blue' : ''; }
function barClass(o) { return o === 'won' ? 'won' : o === 'awaiting evidence' ? 'awaiting' : (o === 'lost' || o === 'stopped') ? 'closed' : ''; }
function defaultRoute() { return D.plan && D.plan.level === 'group' ? '#/groupmaps' : '#/krs'; }
function render() {
  var p = (location.hash || defaultRoute()).replace(/^#\/?/, '').split('/');
  var section = p[0] === 'kr' ? 'krs' : (p[0] || (D.plan && D.plan.level === 'group' ? 'groupmaps' : 'krs'));
  var links = document.querySelectorAll('[data-nav]');
  for (var i = 0; i < links.length; i++) links[i].classList.toggle('on', links[i].getAttribute('data-nav') === section);
  var html;
  if (p[0] === 'kr' && p[1]) html = krDetail(p[1]);
  else if (p[0] === 'okrs') html = okrsView();
  else if (p[0] === 'ladder') html = ladderView();
  else if (p[0] === 'groupmaps') html = groupMapsView();
  else if (p[0] === 'bets') html = betsView();
  else if (p[0] === 'timeline') html = timelineView();
  else if (p[0] === 'guide') html = guideView();
  else html = krsView();
  var notes = (D.problems && D.problems.length ? '<div class="notice">Some planning files could not be read: ' + esc(D.problems.join('; ')) + '</div>' : '') + (NOTICE ? '<div class="notice">' + NOTICE + '</div>' : '');
  main.innerHTML = notes + html;
  if (p[0] === 'bets' && p[1]) { var el = document.getElementById('bet-' + p[1]); if (el && el.scrollIntoView) el.scrollIntoView(); }
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
  return '<h1>How it works</h1><p class="muted">' + here + '</p>' +
    '<div class="panel"><h3>One plan per level, each in its own repo</h3><div class="alts">' + stack + '</div></div>' +
    '<div class="panel"><h3>The loop</h3><ol class="steps">' + steps + '</ol></div>' +
    '<h2 style="margin:20px 0 10px">What nikOS adds</h2><div class="cards">' + value + '</div>';
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
    '<div class="actions"><button class="primary" data-op-submit>' + esc(label) + '</button>' + (foot ? '<span class="muted">' + esc(foot) + '</span>' : '') + '</div></div>';
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
var TREE = { w: 170, gap: 34, h: 48, step: 58, top: 34 };
function cut(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function tree(cols, links) {
  var pos = {}, out = '', H = 60, width = cols.length * TREE.w + (cols.length - 1) * TREE.gap;
  cols.forEach(function (c, i) {
    var x = i * (TREE.w + TREE.gap), y = TREE.top, last = null;
    out += '<text class="t-head" x="' + x + '" y="16">' + esc(cut(c.head, 28)) + '</text>';
    if (!c.items.length) out += '<text class="t-sub" x="' + x + '" y="' + (y + 18) + '">' + esc(cut(c.empty, 30)) + '</text>';
    c.items.forEach(function (it) {
      if (it.group && it.group !== last) { out += '<text class="t-sub" x="' + x + '" y="' + (y + 10) + '"><title>' + esc(it.group) + '</title>' + esc(cut(it.group, 26)) + '</text>'; y += 20; last = it.group; }
      pos[it.key] = { x: x, y: y };
      var card = '<g class="t-card ' + it.tone + (it.dim ? ' dim' : '') + '"><title>' + esc(it.title) + '</title><rect x="' + x + '" y="' + y + '" width="' + TREE.w + '" height="' + TREE.h + '" rx="8"/>' +
        '<text class="t-title" x="' + (x + 10) + '" y="' + (y + 19) + '">' + esc(cut(it.title, 21)) + '</text><text class="t-sub" x="' + (x + 10) + '" y="' + (y + 36) + '">' + esc(cut(it.sub, 26)) + '</text></g>';
      out += it.href ? '<a href="' + esc(it.href) + '">' + card + '</a>' : card;
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
  return '<div class="tree"><svg viewBox="0 0 ' + width + ' ' + (H + 4) + '" style="width:100%;max-width:' + width + 'px" role="img" aria-label="Key results and bets, linked across plans">' + lines + out + '</svg></div>';
}
function pct(p) { return typeof p === 'number' && isFinite(p) ? Math.round(p * 100) + '%' : 'No check-in'; }
// The plan and period this page shows, and the two views of it.
function viewBar(on, v) {
  var label = (v.name || 'This plan') + (D.plan && D.plan.level ? ' (' + D.plan.level + ')' : '');
  return '<div class="viewbar"><span class="field"><span class="muted">Plan</span><span class="pill">' + esc(label) + '</span></span>' +
    (D.plan && D.plan.period ? '<span class="field"><span class="muted">Period</span><span class="pill">' + esc(D.plan.period) + '</span></span>' : '') +
    '<span class="seg"><a href="#/okrs"' + (on === 'okrs' ? ' aria-current="page"' : '') + '>OKRs and bets</a><a href="#/ladder"' + (on === 'ladder' ? ' aria-current="page"' : '') + '>OKR ladder</a></span></div>';
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
    return '<li><strong>' + esc(g.id) + '</strong> <span class="muted">' + esc(g.plan) + ' · aligns to ' + esc(g.aligns_to) + '</span>' + (g.note ? '<div class="notice">' + esc(g.note) + '</div>' : '') + '<div class="muted">' + esc(g.delivery) + '</div></li>';
  }).join('') + '</ul>' : '<p class="muted">No group bets aligned here yet.</p>';
  var forms = '';
  if (EDIT && D.plan && D.plan.level !== 'company') {
    if (!upstreamOptions('bets').length) forms = '<p class="muted">' + noAbove() + '</p>';
    else forms = D.bets.map(function (b) {
      return opForm('bet.align', { bet: b.id }, b.hash, [{ name: 'aligns_to', label: 'Aligns to (bets above)', options: upstreamOptions('bets'), multiple: true, value: b.aligns_to }], 'Save alignment', 'Writes ' + b.file);
    }).join('');
  }
  return viewBar('okrs', v) + '<h1>OKRs and bets</h1><p class="muted">' + esc(v.foot) + '</p>' +
    '<div class="panel">' + tree(cols, links) + '</div>' +
    (top ? '' : '<div class="panel"><h3>Group bets aligned to a bet here</h3><div class="muted">Delivery comes from the delivery.yaml each map owner commits. The date after each line shows how old it is.</div>' + groupNote + groupBets + '</div>') +
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
  return viewBar('ladder', v) + '<h1>OKR ladder</h1><p class="muted">' + esc(v.foot) + '</p><div class="panel">' + tree(cols, links) + '</div>';
}

// The group's page: each bet, with the story maps that spec it under it, and each map's parts and story rows.
function groupMapsView() {
  var v = D.pages.betsAndStoryMaps;
  var mapPanel = function (m) {
    var parts = m.parts.map(function (p) {
      var what = p.releases ? 'releases ' + p.releases.join(', ') : p.activities ? 'activities ' + p.activities.join(', ') : p.stories ? 'stories ' + p.stories.join(', ') : 'the whole map';
      return '<li>' + esc(p.team) + ' <span class="muted">' + esc(p.repo) + ' · ' + esc(what) + '</span>' +
        (EDIT ? ' <button data-op-unassign="' + esc(p.repo) + '" data-map="' + esc(m.id) + '">Take back this part</button>' : '') + '</li>';
    }).join('');
    var rows = m.stories.map(function (s) {
      var done = s.status === 'done' || s.status === 'approved';
      // The map id goes with the rename, so a group with several maps knows which one the story is in.
      var rename = EDIT ? opForm('story.rename', { story: s.id }, s.hash, [{ name: 'title', label: 'Title', value: s.title }], 'Rename', '',
        '<input type="hidden" data-field="map" value="' + esc(m.id) + '">' + (done ? '<label class="muted"><input type="checkbox" data-confirm style="width:auto"> A team has finished this: rename it anyway</label>' : '')) : '';
      return '<li><span class="sid">' + esc(s.id) + '</span>' + esc(s.title) + ' <span class="muted">' + esc(s.team || 'no team') + ' · ' + esc(String(s.status).replace(/_/g, ' ')) + ' · ' + esc(s.reason) + '</span>' +
        (EDIT ? '<details><summary class="muted">Rename</summary>' + rename + '</details>' : '') + '</li>';
    }).join('');
    return '<div class="panel"><h3>' + esc(m.title) + ' <span class="muted">' + esc(m.key) + '</span></h3>' +
      (m.problem ? '<div class="notice">' + esc(m.problem) + '</div>' : '') +
      (parts ? '<h4>Teams</h4><ul class="checkins">' + parts + '</ul>' : '<p class="muted">No team has a part yet. Assign one with nikos assign.</p>') +
      (rows ? '<h4>Stories</h4><ul class="checkins">' + rows + '</ul>' : '<p class="muted">No stories yet.</p>') +
      (EDIT ? opForm('assign', { team: '' }, '', [
        { name: 'team', targetKey: 'team', label: 'Team repo (owner/repo, or .)' }, { name: 'name', label: 'Team name' },
        { name: 'map', label: 'Map', value: m.id }, { name: 'releases', kind: 'list', label: 'Releases (blank for the whole map)' }
      ], 'Assign', 'Writes ' + m.id + ' assignments') : '') + '</div>';
  };
  var block = function (b) {
    var mine = v.maps.filter(function (m) { return m.bet === b.id; });
    return '<div class="bet-block"><a class="card" href="#/bets/' + esc(b.id) + '"><div class="row"><strong>' + esc(b.id) + '</strong>' + chip(b.outcome, outcomeClass(b.outcome)) + '</div>' +
      '<div class="muted">' + esc(b.hypothesis) + '</div><div style="margin-top:8px">' + esc(b.delivery) + '</div>' +
      (b.alignsTo.length ? '<div class="muted">Aligns to ' + esc(b.alignsTo.join(', ')) + '</div>' : '') + '</a>' +
      (mine.length ? mine.map(mapPanel).join('') : '<p class="muted">No story map for this bet yet.</p>') + '</div>';
  };
  var bets = v.bets.length ? v.bets.map(block).join('') : '<p class="muted">No bets yet. Write one with nikos planning bet new.</p>';
  var orphans = v.maps.filter(function (m) { return !v.bets.some(function (b) { return b.id === m.bet; }); });
  return '<h1>Bets and story maps</h1><p class="muted">' + esc(v.foot) + '</p>' + bets + (orphans.length ? '<h2>Story maps with no bet here</h2>' + orphans.map(mapPanel).join('') : '');
}

function krCard(k) {
  var chips = '';
  if (!k.checkins.length) chips += chip('No check-ins yet', '');
  else if (k.stale) chips += chip('Stale', 'amber');
  if (k.upstream) chips += chip('Aligned to ' + k.upstream.ref, 'lock');
  var pct = Math.max(0, Math.min(100, Math.round(k.progress * 100)));
  return '<a class="card" href="#/kr/' + esc(k.id) + '">' +
    '<div class="row"><strong>' + esc(k.title) + '</strong>' + chips + '</div>' +
    '<div class="muted">' + esc(k.owner) + ' · by ' + esc(k.by) + '</div>' +
    '<div class="row" style="margin-top:8px"><span class="big">' + esc(num(k.latestValue, k.unit)) + '</span><span class="muted">target ' + esc(num(k.target, k.unit)) + '</span></div>' +
    '<div class="progress"><div style="width:' + pct + '%"></div></div>' +
    '<div class="muted" style="margin-top:6px">' + (k.latest ? 'Latest check-in ' + esc(k.latest.date) : 'No check-ins yet') + '</div></a>';
}

function krsView() {
  var lv = D.plan && D.plan.level;
  var add = EDIT && (lv === 'company' || lv === 'department')
    ? '<details class="panel"><summary>New key result</summary>' + opForm('kr.new', {}, '', [
        { name: 'kr', targetKey: 'kr', label: 'Id (lowercase words)', placeholder: 'checkout-conversion' },
        { name: 'title', label: 'Title' }, { name: 'owner', label: 'Owner' },
        { name: 'baseline', kind: 'number', label: 'Baseline' }, { name: 'target', kind: 'number', label: 'Target' },
        { name: 'by', kind: 'date', label: 'By (YYYY-MM-DD)' }, { name: 'unit', label: 'Unit' }, { name: 'objective', label: 'Objective' },
        ...(lv === 'department' && upstreamOptions('krs').length ? [{ name: 'aligns_to', label: 'Aligns to (key results above)', options: upstreamOptions('krs'), multiple: true }] : [])
      ], 'Add key result', '') + '</details>'
    : '';
  if (!D.krs.length) return '<h1>Key results</h1><p class="muted">No key results yet. Add one with nikos planning kr new.</p>' + add;
  return '<h1>Key results</h1><p class="muted">Progress runs from the baseline to the target.</p><div class="cards">' + D.krs.map(krCard).join('') + '</div>' + add;
}

function chartSvg(k) {
  var W = 640, H = 260, L = 56, R = 16, T = 16, B = 30;
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
  var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Check-ins over time against baseline and target">';
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
  s += '<text class="ax" x="' + (L - 6) + '" y="' + (y(hi) + 4) + '" text-anchor="end">' + esc(num(Math.round(hi - pad), '')) + '</text>';
  s += '<text class="ax" x="' + (L - 6) + '" y="' + (y(lo) + 4) + '" text-anchor="end">' + esc(num(Math.round(lo + pad), '')) + '</text>';
  return s + '</svg>';
}

function krDetail(id) {
  var k = krById(id);
  if (!k) return '<p>No key result called ' + esc(id) + '.</p>';
  var upstream = (k.aligned || (k.upstream ? [k.upstream] : [])).map(function (u) {
    return '<div class="panel"><div class="label">Aligned to ' + esc(u.ref) + ' (read-only copy)</div><div class="val">' +
      (u.kr ? esc(u.kr.title) : 'Not in the synced copy yet') + '</div></div>';
  }).join('');
  var checkins = k.checkins.slice().reverse().map(function (c) {
    return '<li><span class="muted">' + esc(c.date) + '</span> <strong>' + esc(num(c.value, k.unit)) + '</strong>' +
      (c.note ? ' · ' + esc(c.note) : '') + (c.evidence ? ' · <span class="muted">' + esc(c.evidence) + '</span>' : '') + '</li>';
  }).join('');
  var lv = D.plan && D.plan.level;
  var editing = EDIT ? (opForm('kr.edit', { kr: k.id }, k.hash, [
      { name: 'title', label: 'Title', value: k.title }, { name: 'owner', label: 'Owner', value: k.owner },
      { name: 'by', kind: 'date', label: 'By', value: k.by }, { name: 'unit', label: 'Unit', value: k.unit },
      { name: 'objective', label: 'Objective', value: k.objective }, { name: 'stale_after_days', kind: 'number', label: 'Stale after (days)', value: k.stale_after_days }
    ], 'Save details', 'Writes ' + k.file) +
    opForm('kr.target', { kr: k.id }, k.hash, [{ name: 'target', kind: 'number', label: 'New target', value: k.target }], 'Move target', 'The original target stays recorded.') +
    (lv !== 'group' && upstreamOptions('krs').length ? opForm('kr.align', { kr: k.id }, k.hash, [{ name: 'aligns_to', label: 'Aligns to (key results above)', options: upstreamOptions('krs'), multiple: true, value: k.aligns_to }], 'Save alignment', 'Writes ' + k.file) : (EDIT && lv === 'department' ? '<p class="muted">' + noAbove() + '</p>' : '')) +
    opForm('checkin', { kr: k.id }, k.hash, [
      { name: 'value', kind: 'number', label: 'Value' + (k.unit ? ' (' + k.unit + ')' : ''), value: k.latest ? k.latest.value : k.baseline },
      { name: 'evidence', label: 'Evidence link (optional)' }, { name: 'note', label: 'Note (optional)', area: true }
    ], 'Check in', 'Writes ' + k.file)) : '';
  return '<a class="back" href="#/krs">← Key results</a>' +
    '<h1>' + esc(k.title) + '</h1>' +
    '<div class="muted">' + esc(k.objective) + (k.objective ? ' · ' : '') + 'Owner ' + esc(k.owner) + ' · by ' + esc(k.by) + '</div>' +
    '<div class="stats">' +
      '<div class="stat"><div class="label">Latest</div><div class="big">' + esc(num(k.latestValue, k.unit)) + '</div><div class="muted">' + (k.latest ? 'on ' + esc(k.latest.date) : 'no check-ins') + '</div></div>' +
      '<div class="stat"><div class="label">Baseline to target</div><div class="val">' + esc(num(k.baseline, k.unit)) + ' to ' + esc(num(k.target, k.unit)) + '</div><div class="muted">' + Math.round(k.progress * 100) + '% of the way</div></div>' +
      '<div class="stat"><div class="label">Status</div><div class="val">' + (k.stale ? chip('Stale: no recent check-in', 'amber') : chip('Checked in recently', 'green')) + '</div></div>' +
    '</div>' + upstream +
    '<div class="panel"><h3>Over time</h3>' + chartSvg(k) + '</div>' +
    editing +
    '<div class="panel"><h3>Check-ins</h3>' + (checkins ? '<ul class="checkins">' + checkins + '</ul>' : '<p class="muted">No check-ins yet.</p>') + '</div>';
}

function betsView() {
  var lv = D.plan && D.plan.level;
  var add = EDIT && lv !== 'team'
    ? '<details class="panel"><summary>New bet</summary>' + opForm('bet.new', {}, '', [
        { name: 'bet', targetKey: 'bet', label: 'Id (lowercase words)', placeholder: 'faster-checkout' },
        { name: 'owner', label: 'Owner' }, { name: 'hypothesis', label: 'Hypothesis', area: true },
        { name: 'review_on', kind: 'date', label: 'Review on (YYYY-MM-DD)' }, { name: 'team', label: 'Team (optional)' },
        { name: 'primary', label: 'Key result it moves', options: ownKrOptions().concat(upstreamOptions('krs')) },
        ...(lv !== 'company' && upstreamOptions('bets').length ? [{ name: 'aligns_to', label: 'Aligns to (bets above)', options: upstreamOptions('bets'), multiple: true }] : [])
      ], 'Add bet', 'Writes planning/bets') + '</details>'
    : '';
  if (!D.bets.length) return '<h1>Bets</h1><p class="muted">No bets yet. Write one with nikos planning bet new.</p>' + add;
  return '<h1>Bets</h1><p class="muted">What we believe, what is delivered, and what it moved.</p>' + add + D.bets.map(betCard).join('');
}

function betCard(b) {
  var d = b.delivery;
  var refs = [];
  if (b.krs.primary) refs.push(b.krs.primary);
  b.krs.also.forEach(function (r) { refs.push(r); });
  var krLinks = refs.map(function (r) {
    return krById(r) ? '<a class="chip" href="#/kr/' + esc(r) + '">' + esc(r) + '</a>' : chip(r, 'lock');
  }).join(' ') || '<span class="muted">No key result linked</span>';
  var releases = b.releases.length ? b.releases.map(function (r) {
    return LIVE ? '<a class="chip blue" href="' + esc(r.href) + '">Release ' + r.number + '</a>' : chip('Release ' + r.number, 'blue');
  }).join(' ') : '<span class="muted">Not on any release</span>';
  var stories = d.stories.map(function (s) {
    var fresh = s.freshness && s.freshness !== 'current' && s.freshness !== 'in-place' ? ' <span class="muted">(' + esc(s.freshness) + ')</span>' : '';
    return '<li><span class="sid">' + esc(s.id) + '</span>' + esc(s.status.replace(/_/g, ' ')) + fresh + '</li>';
  }).join('');
  var reviews = b.reviews.length ? '<ol class="reviews">' + b.reviews.slice().reverse().map(function (r) {
    return '<li><span class="muted">' + esc(r.date) + '</span> <strong>' + esc(r.decision) + '</strong>' + (r.outcome ? ' (' + esc(r.outcome) + ')' : '') + ': ' + esc(r.reason) + '</li>';
  }).join('') + '</ol>' : '<p class="muted">No reviews yet.</p>';
  var edit = EDIT ? opForm('bet.edit', { bet: b.id }, b.hash, [
      { name: 'owner', label: 'Owner', value: b.owner }, { name: 'team', label: 'Team', value: b.team },
      { name: 'hypothesis', label: 'Hypothesis', value: b.hypothesis, area: true },
      { name: 'starts', kind: 'date', label: 'Starts', value: b.starts }, { name: 'review_on', kind: 'date', label: 'Review on', value: b.review_on },
      { name: 'deadline', kind: 'date', label: 'Deadline', value: b.deadline },
      { name: 'confidence', label: 'Confidence', value: b.confidence, options: ['low', 'medium', 'high'] },
      { name: 'dependencies', kind: 'list', label: 'Dependencies (comma-separated)', value: b.dependencies.join(', ') }
    ], 'Save bet', 'Writes ' + b.file) : '';
  var review = EDIT ? opForm('bet.review', { bet: b.id }, b.hash, [
      { name: 'decision', label: 'Decision', value: 'continue', options: ['continue', 'change', 'stop', 'complete'] },
      { name: 'outcome', label: 'Outcome, when completing', options: ['won', 'lost'] },
      { name: 'reason', label: 'Reason', area: true }
    ], 'Save review', 'Writes ' + b.file) : '';
  return '<article class="card" id="bet-' + esc(b.id) + '" style="cursor:default">' +
    '<div class="row"><h2>' + esc(b.id) + '</h2>' + chip(b.outcome, outcomeClass(b.outcome)) + chip('Confidence ' + b.confidence, '') + '</div>' +
    '<p class="hyp">' + esc(b.hypothesis) + '</p>' +
    '<div class="muted">Owner ' + esc(b.owner) + (b.team ? ' · Team ' + esc(b.team) : '') + ' · Review ' + esc(b.review_on) + (b.deadline ? ' · Deadline ' + esc(b.deadline) : '') + '</div>' +
    '<div class="split">' +
      '<div class="box delivery"><div class="label">Delivery</div><div class="val">' + esc(d.text) + '</div>' +
        (stories ? '<ul class="stories">' + stories + '</ul>' : '') + '<div class="row">' + releases + '</div></div>' +
      '<div class="box outcome"><div class="label">Outcome</div><div class="val">' + esc(b.outcome) + '</div><div class="row">' + krLinks + '</div></div>' +
    '</div>' +
    ((b.aligns_to || []).length ? '<div class="muted" style="margin-top:8px">Aligns to ' + b.aligns_to.map(function (r) { return chip(r, 'lock'); }).join(' ') + '</div>' : '') +
    (b.body ? '<div class="prose">' + prose(b.body) + '</div>' : '') +
    '<h4>Reviews</h4>' + reviews +
    (EDIT ? '<details><summary class="muted">Edit this bet</summary>' + edit + '</details><details><summary class="muted">Review this bet</summary>' + review + '</details>' : '') +
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
  if (!D.bets.length) return '<h1>Timeline</h1><p class="muted">No bets to plot yet.</p>';
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
        return '<a class="tbar ' + barClass(r.b.outcome) + '" href="#/bets" style="left:' + left + '%;width:' + width.toFixed(2) + '%" title="' + esc(r.b.id + ': ' + r.b.hypothesis + ' (' + r.s + ' to ' + r.e + ')') + '">' + esc(r.b.id) + '</a>';
      }).join('');
      out += '<div class="lane"><div class="tlabel">' + (n === 0 ? esc(g) : '') + '</div><div class="track"><div class="today" style="left:' + todayPct + '%"></div>' + bars + '</div></div>';
    }
    return out;
  }).join('');
  return '<h1>Timeline</h1><p class="muted">One row per team, or owner. Bars run from the start to the deadline, or to the review date. The line is today.</p>' +
    '<div class="panel timeline"><div class="axis">' + axis + '</div>' + lanesHtml + '</div>';
}
`;

// The form code, shared by the live dashboard and an editable snapshot: toasts, reading a form, and the clicks.
const FORM_JS = String.raw`
var toastEl = document.getElementById('toast');
function toast(text, bad) {
  toastEl.textContent = text;
  toastEl.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(function () { toastEl.className = 'toast'; }, 4000);
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
      if (!isFinite(value)) return toast('Enter a number for ' + name, true);
    } else value = el.value.trim();
    if (el.getAttribute('data-target-key')) target[el.getAttribute('data-target-key')] = value;
    else args[name] = value;
  }
  var box = form.querySelector('[data-confirm]');
  if (box && box.checked) args.confirm = true;
  return apiOp(op, target, args, expect);
}
// The clicks on forms, the unassign button, the reload button, the git buttons and copy.
document.addEventListener('click', function (e) {
  var t = e.target;
  var submit = closest(t, '[data-op-submit]');
  if (submit) return submitForm(closest(submit, '[data-op-form]'));
  var un = closest(t, '[data-op-unassign]');
  if (un) return apiOp('unassign', { team: un.getAttribute('data-op-unassign') }, { map: un.getAttribute('data-map') }, '');
  var act = closest(t, '[data-act]');
  if (act && act.getAttribute('data-act') === 'reload') { NOTICE = ''; return reload(); }
  var git = closest(t, '[data-git]');
  if (git) return gitAction(git.getAttribute('data-git'));
  var copy = closest(t, '[data-copy]');
  if (copy && navigator.clipboard) navigator.clipboard.writeText(copy.getAttribute('data-copy')).then(function () { toast('Copied'); }, function () { toast('Copy did not work: select the command and copy it', true); });
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
  return fetch('/api/data').then(function (r) { return r.json(); }).then(function (d) { D = d; render(); pendingRefresh(); });
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
        NOTICE = 'This changed since you loaded this. <button data-act="reload">Reload</button>';
        render();
      }
      toast(res.body.error || 'Save failed', true);
    })
    .catch(function (err) { toast('Could not save: ' + err.message, true); });
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
  if (!p.git) { box.innerHTML = '<div class="muted">' + esc(p.message) + '</div>'; return; }
  var n = p.files.length;
  var html = '<div class="row"><span>' + (n ? n + (n === 1 ? ' change' : ' changes') + (p.branch ? ' on branch ' + esc(p.branch) : '') + ', not committed.' : 'No unsaved planning changes.') + '</span>';
  if (n && p.branch) html += '<button data-git="commit">Commit</button>';
  if (p.branch && !p.onBase && p.hasOrigin) html += '<button data-git="push">Push branch</button>';
  if (p.branch && !p.onBase && p.hasOrigin && !p.forge.pushed) html += '<span class="muted">Push the branch first, then open the request</span>';
  if (p.branch && !p.onBase && p.forge.prCommand && p.forge.pushed) {
    if (p.forge.tool) html += '<button class="primary" data-git="pr">' + esc(p.forge.requestLabel) + '</button>';
    else html += '<span class="muted">' + esc(p.forge.prCommand) + '</span><button data-copy="' + esc(p.forge.prCommand) + '">Copy this command</button>';
  }
  html += '</div>';
  if (n && p.paths && p.paths.length) html += '<details class="muted"><summary>' + n + (n === 1 ? ' file' : ' files') + ' to commit</summary>' + p.paths.map(esc).join('<br>') + '</details>';
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
    } else toast(res.body.error || 'Could not do that', true);
    return pendingRefresh();
  });
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
  var html = '<div class="row"><span>' + (n ? n + (n === 1 ? ' change' : ' changes') + ' ready to download' : 'No changes yet') + '</span>' +
    '<label class="muted">Your name <input id="made-by" maxlength="100" value="' + esc(MADE_BY) + '" style="width:auto"></label>' +
    '<button data-download' + (n ? '' : ' disabled') + '>Download changes</button></div>' +
    '<div class="muted">Attribution only. It is not checked. Checked here: field rules only. The full check runs at nikos apply. The views still show the plan as it was exported.</div>';
  if (n) html += '<ul class="checkins">' + QUEUE.map(function (c, i) {
    var f = fileOf(c.op, c.target);
    return '<li>' + esc(opLabel(c.op, c.target, c.args)) + '<div class="muted">' + (f ? 'File ' + esc(f) + ' · ' : '') + (c.expect ? 'expect ' + esc(c.expect) : 'no expect') +
      ' · <button data-remove-change="' + i + '">Remove</button></div></li>';
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
    ? `<h4>Story map</h4><a href="/map">Open the story map</a>` +
      ((data.views as string[]).length
        ? `<h4>Custom views</h4>${(data.views as string[]).map((v) => `<a href="/views/${esc(v)}">${esc(v)}</a>`).join("")}`
        : "")
    : "";
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
<title>${esc(data.project)} · planning</title>
<style>${CSS}</style>
</head>
<body>
<div class="shell">
<aside class="side">
<div class="brand">nikOS planning</div>
<div class="project">${esc(data.project)}</div>
<nav>${nav}${extra}</nav>
${links}</aside>
<div class="content">
<div class="mode">${live ? "Saves change this repo's planning, maps and assignments. Nothing is pushed unless you click Push." : snapshot ? "Snapshot, editable. Changes are queued in this page and downloaded as a file. Nothing is written to the repo until nikos apply runs." : "Snapshot, read only. The plans are as they were when this file was made."}</div>
${edit ? '<div id="pending" class="pending"></div>' : ""}
<main id="main"></main>
</div>
</div>
<div id="toast" class="toast" role="status"></div>
<script type="application/json" id="nikos-data">${json}</script>
<script>
${script}
</script>
</body>
</html>
`;
}
