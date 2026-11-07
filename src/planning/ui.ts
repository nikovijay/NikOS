// The dashboard page: one HTML file with the data embedded as JSON. Inline CSS and vanilla
// JS draw the views, so the live dashboard and the offline export are the same page. A
// read-only render leaves out the save code and the token altogether.
import { esc } from "../commands/map.js";

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
function render() {
  var p = (location.hash || '#/krs').replace(/^#\/?/, '').split('/');
  var section = p[0] === 'kr' ? 'krs' : (p[0] || 'krs');
  var links = document.querySelectorAll('[data-nav]');
  for (var i = 0; i < links.length; i++) links[i].classList.toggle('on', links[i].getAttribute('data-nav') === section);
  var html;
  if (p[0] === 'kr' && p[1]) html = krDetail(p[1]);
  else if (p[0] === 'bets') html = betsView();
  else if (p[0] === 'timeline') html = timelineView();
  else if (p[0] === 'guide') html = guideView();
  else if (p[0] === 'rollout') html = rolloutView();
  else html = krsView();
  main.innerHTML = (D.problems && D.problems.length ? '<div class="notice">Some planning files could not be read: ' + esc(D.problems.join('; ')) + '</div>' : '') + html;
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
    '<div class="alt delivery"><div class="row"><strong>Story map</strong><span class="muted">intent/ in the repo that builds it</span></div><div class="muted">Specs a bet as stories, organised by activity and step. Story status comes from the work itself.</div></div>';
  var steps = [
    ['Plan the period', 'Ask your agent to plan the quarter. It asks for the level, pillars, objectives and key results, and shows a draft. Nothing is written until you approve.'],
    ['Align upward', 'List the plans above you in planning/upstream.yaml. nikos planning sync keeps a read-only copy, so a key result can align to key results above, and a bet to bets above, by reference, without ever writing to that repo.'],
    ['Frame bets', 'A bet says what you believe will move a key result, and why, with the evidence. It has a review date, not a deadline.'],
    ['Deliver through the story map', 'A release in intent/storymap.yaml names the bets it delivers. Delivery status (Not started, Building, Shipped) is worked out from its stories.'],
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

function rolloutView() {
  var r = D.downstream;
  if (!r || !r.plans.length) return '<h1>Rollout</h1><p class="muted">No plans below this one yet. List departments and teams in planning/downstream.yaml.</p>';
  var joined = r.plans.filter(function (p) { return p.state === 'joined'; }).length;
  var cls = { 'joined': 'green', 'not joined': 'amber', 'unreachable': '', 'no repo yet': '' };
  var cards = r.plans.map(function (p) {
    var rows = [];
    if (p.synced) rows.push('Synced ' + esc(p.synced.on) + ' at <code>' + esc(p.synced.commit.slice(0, 7)) + '</code>' + (p.synced.current === false ? ', behind ' + esc(p.via || 'this plan') + ': ask them to run nikos planning sync' : ''));
    else if (p.state === 'joined') rows.push('Not synced yet');
    if (p.delivery) {
      var pct = p.delivery.stories ? Math.round(p.delivery.done / p.delivery.stories * 100) : 0;
      rows.push(esc(p.delivery.done) + ' of ' + esc(p.delivery.stories) + ' stories done' + (p.delivery.approved ? ', ' + esc(p.delivery.approved) + ' approved' : '') + '<div class="progress"><div style="width:' + pct + '%"></div></div>');
    }
    if (p.next) rows.push('<span class="muted">Next</span> ' + esc(p.next.id) + ' ' + esc(p.next.title));
    (p.blockers || []).forEach(function (b) { rows.push(chip('Blocked', 'amber') + ' ' + esc(b.story) + ' ' + esc(b.title) + '<div class="muted">' + b.blockers.map(esc).join('; ') + '</div>'); });
    if ((p.decisions || []).length) rows.push('<span class="muted">Latest decisions</span><ul class="checkins">' + p.decisions.map(function (d) { return '<li>' + esc(d.title) + '</li>'; }).join('') + '</ul>');
    var refs = p.krs.map(function (k) { return '<li>KR ' + esc(k.title) + ', ' + Math.round(k.progress * 100) + '%' + (!k.checkedIn ? ' ' + chip('No check-ins yet', '') : k.stale ? ' ' + chip('Stale', 'amber') : '') + ((k.aligns_to || []).length ? ' <span class="muted">→ ' + esc([].concat(k.aligns_to).join(', ')) + '</span>' : '') + '</li>'; })
      .concat(p.bets.map(function (b) { return '<li>Bet ' + esc(b.id) + ', ' + esc(b.delivery) + (b.krs.length ? ' <span class="muted">→ ' + esc(b.krs.join(', ')) + '</span>' : '') + ((b.aligns_to || []).length ? ' <span class="muted">· aligns to ' + esc(b.aligns_to.join(', ')) + '</span>' : '') + '</li>'; }));
    return '<div class="card"><div class="row"><strong>' + esc(p.name) + '</strong>' + chip(p.state, cls[p.state] || '') + '</div>' +
      (p.repo ? '<div class="muted">' + esc(p.repo) + (p.via ? ' · below ' + esc(p.via) : '') + (p.fetched ? ' · read ' + esc(p.fetched) : '') + '</div>' : '') +
      (p.reason ? '<div class="muted" style="margin-top:6px">' + esc(p.reason) + '</div>' : '') +
      rows.map(function (x) { return '<div style="margin-top:8px">' + x + '</div>'; }).join('') +
      (refs.length ? '<ul class="checkins" style="margin-top:8px">' + refs.join('') + '</ul>' : '') + '</div>';
  }).join('');
  return '<h1>Rollout</h1><p class="muted">' + joined + ' of ' + r.plans.length + ' plans below this one have joined. Read from copies fetched by nikos planning rollout.</p>' + alignmentTree(r.tree) + ownDecisions(r.decisions) + '<div class="cards">' + cards + '</div>';
}

function ownDecisions(ds) {
  if (!ds || !ds.length) return '';
  return '<div class="panel"><h3>Latest decisions here</h3><ul class="checkins">' + ds.map(function (d) { return '<li>' + esc(d.title) + '</li>'; }).join('') + '</ul></div>';
}

// Links only: a key result's place in the tree says nothing about how it is doing.
function alignmentTree(t) {
  if (!t || (!t.roots.length && !t.unaligned.length)) return '';
  function node(n) {
    var label = n.kind === 'kr' ? '<span class="kind">KR</span>' + esc(n.title) : '<span class="kind">Bet</span>' + esc(n.id);
    return '<li>' + label + ' <span class="muted">' + esc(n.plan) + ((n.aligns_to || []).length ? ' · points at ' + esc([].concat(n.aligns_to).join(', ')) + ', not in this rollout' : '') + '</span>' +
      (n.children.length ? '<ul>' + n.children.map(node).join('') + '</ul>' : '') + '</li>';
  }
  return '<div class="panel"><h3>Alignment</h3><div class="muted">Key results here, the ones below that align to them, and the bets on each. It shows links only: progress stays with each key result and never adds up from the ones below.</div>' +
    (t.roots.length ? '<ul class="tree" style="margin-top:8px">' + t.roots.map(node).join('') + '</ul>' : '') +
    (t.unaligned.length ? '<h4>Not aligned to a key result in this rollout</h4><ul class="tree">' + t.unaligned.map(node).join('') + '</ul>' : '') + '</div>';
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
  if (!D.krs.length) return '<h1>Key results</h1><p class="muted">No key results yet. Add one with nikos planning kr new.</p>';
  return '<h1>Key results</h1><p class="muted">Progress runs from the baseline to the target.</p><div class="cards">' + D.krs.map(krCard).join('') + '</div>';
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
  return '<a class="back" href="#/krs">← Key results</a>' +
    '<h1>' + esc(k.title) + '</h1>' +
    '<div class="muted">' + esc(k.objective) + (k.objective ? ' · ' : '') + 'Owner ' + esc(k.owner) + ' · by ' + esc(k.by) + '</div>' +
    '<div class="stats">' +
      '<div class="stat"><div class="label">Latest</div><div class="big">' + esc(num(k.latestValue, k.unit)) + '</div><div class="muted">' + (k.latest ? 'on ' + esc(k.latest.date) : 'no check-ins') + '</div></div>' +
      '<div class="stat"><div class="label">Baseline to target</div><div class="val">' + esc(num(k.baseline, k.unit)) + ' to ' + esc(num(k.target, k.unit)) + '</div><div class="muted">' + Math.round(k.progress * 100) + '% of the way</div></div>' +
      '<div class="stat"><div class="label">Status</div><div class="val">' + (k.stale ? chip('Stale: no recent check-in', 'amber') : chip('Checked in recently', 'green')) + '</div></div>' +
    '</div>' + upstream +
    '<div class="panel"><h3>Over time</h3>' + chartSvg(k) + '</div>' +
    (LIVE ? checkinForm(k) : '') +
    '<div class="panel"><h3>Check-ins</h3>' + (checkins ? '<ul class="checkins">' + checkins + '</ul>' : '<p class="muted">No check-ins yet.</p>') + '</div>';
}

function checkinForm(k) {
  var last = k.latest ? k.latest.value : k.baseline;
  return '<div class="panel form" data-form="checkin" data-id="' + esc(k.id) + '" data-hash="' + esc(k.hash) + '"><h3>Check in</h3>' +
    '<div class="fields"><label>Value' + (k.unit ? ' (' + esc(k.unit) + ')' : '') + '<input name="value" type="number" step="any" value="' + esc(last) + '"></label>' +
    '<label>Evidence link (optional)<input name="evidence" type="text"></label></div>' +
    '<label>Note (optional)<textarea name="note" rows="2"></textarea></label>' +
    '<div class="actions"><button class="primary" data-act="checkin">Check in</button><span class="muted">Writes ' + esc(k.file) + '</span></div></div>';
}

function betsView() {
  if (!D.bets.length) return '<h1>Bets</h1><p class="muted">No bets yet. Write one with nikos planning bet new.</p>';
  return '<h1>Bets</h1><p class="muted">What we believe, what is delivered, and what it moved.</p>' + D.bets.map(betCard).join('');
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
    return '<li><span class="sid">' + esc(s.id) + '</span>' + esc(s.status.replace(/_/g, ' ')) + '</li>';
  }).join('');
  var reviews = b.reviews.length ? '<ol class="reviews">' + b.reviews.slice().reverse().map(function (r) {
    return '<li><span class="muted">' + esc(r.date) + '</span> <strong>' + esc(r.decision) + '</strong>' + (r.outcome ? ' (' + esc(r.outcome) + ')' : '') + ': ' + esc(r.reason) + '</li>';
  }).join('') + '</ol>' : '<p class="muted">No reviews yet.</p>';
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
    (LIVE ? reviewForm(b) : '') +
    '</article>';
}

// The bet card's notes: "## " lines become headings, the rest stays plain escaped text.
function prose(text) {
  // Headings are blocks, so the line breaks either side of them would show as blank lines.
  return text.trim().split('\n').map(function (l) {
    return /^#{2,3} /.test(l) ? '<h4>' + esc(l.replace(/^#+ /, '')) + '</h4>' : esc(l);
  }).join('\n').replace(/\n*(<h4>)/g, '$1').replace(/(<\/h4>)\n*/g, '$1');
}

function reviewForm(b) {
  return '<div class="panel form" data-form="review" data-id="' + esc(b.id) + '" data-hash="' + esc(b.hash) + '"><h3>Review</h3>' +
    '<div class="fields"><label>Decision<select name="decision"><option>continue</option><option>change</option><option>stop</option><option>complete</option></select></label>' +
    '<label>Outcome, when completing<select name="outcome"><option value="">-</option><option value="won">won</option><option value="lost">lost</option></select></label></div>' +
    '<label>Reason<textarea name="reason" rows="2"></textarea></label>' +
    '<div class="actions"><button class="primary" data-act="review">Save review</button><span class="muted">Writes ' + esc(b.file) + '</span></div></div>';
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

// Live-only code: saving, reloading after a save, and the toast. Absent from the export.
const SAVE_JS = String.raw`
var toastEl = document.getElementById('toast');
function toast(text, bad) {
  toastEl.textContent = text;
  toastEl.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(function () { toastEl.className = 'toast'; }, 4000);
}
function reload() {
  return fetch('/api/data').then(function (r) { return r.json(); }).then(function (d) { D = d; render(); });
}
function save(kind, payload) {
  var path = { checkin: '/api/checkin', bet: '/api/bet', review: '/api/review' }[kind];
  return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nikos-Token': TOKEN }, body: JSON.stringify(payload) })
    .then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) { return { ok: r.ok, status: r.status, body: body }; });
    })
    .then(function (res) {
      if (res.ok) { toast('Wrote ' + res.body.wrote); return reload(); }
      toast(res.body.error || 'Save failed', true);
      if (res.status === 409) return reload();
    })
    .catch(function (err) { toast('Could not save: ' + err.message, true); });
}
main.addEventListener('click', function (e) {
  var btn = e.target.closest ? e.target.closest('[data-act]') : null;
  if (!btn) return;
  var form = btn.closest('[data-form]');
  var val = function (name) { var el = form.querySelector('[name="' + name + '"]'); return el ? el.value : ''; };
  var id = form.getAttribute('data-id');
  var expect = form.getAttribute('data-hash');
  if (btn.getAttribute('data-act') === 'checkin') {
    if (val('value').trim() === '' || !isFinite(Number(val('value')))) return toast('Enter a number for the value', true);
    save('checkin', { id: id, expect: expect, value: Number(val('value')), evidence: val('evidence'), note: val('note') });
  } else if (btn.getAttribute('data-act') === 'review') {
    if (!val('reason').trim()) return toast('A review needs a reason', true);
    save('review', { id: id, expect: expect, decision: val('decision'), reason: val('reason').trim(), outcome: val('outcome') || undefined });
  }
});
`;

export interface DashboardOptions {
  data: any;
  token?: string;
  readOnly: boolean;
}

/** The whole dashboard as one HTML page. Read-only renders carry no save code and no token. */
export function renderDashboard({ data, token, readOnly }: DashboardOptions): string {
  const live = !readOnly;
  const json = JSON.stringify(data).replace(/[<\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  const nav =
    `<a data-nav="krs" href="#/krs">Key results</a><a data-nav="bets" href="#/bets">Bets</a><a data-nav="timeline" href="#/timeline">Timeline</a>${data.downstream ? `<a data-nav="rollout" href="#/rollout">Rollout</a>` : ""}<a data-nav="guide" href="#/guide">How it works</a>`;
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
  const script = [
    `var LIVE = ${live};`,
    live ? `var TOKEN = ${JSON.stringify(token ?? "")};` : "",
    VIEWS_JS,
    live ? SAVE_JS : "",
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
<div class="mode">${live ? "Saves write to planning/ in this repo, and nothing else." : "Snapshot, read only. The plans are as they were when this file was made."}</div>
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
