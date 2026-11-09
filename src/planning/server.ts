// The local planning dashboard: a server on 127.0.0.1 that shows the planning/ folder and
// saves through the same commands as the command line. Every save needs the token printed at
// start; the static pages and the export need none. Also the one-file export and the contract
// custom views are written against. On a git repo, saves go on a branch; nothing is pushed or
// opened as a request unless a person clicks for it.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { renderMap, storyMapOf, storyMapOfRef } from "../commands/map.js";
import { featureOf } from "../commands/story.js";
import { BET_ID } from "../lib/bets.js";
import { keyOfMap, mapDirs, resolveStoryMap } from "../lib/maps.js";
import { loadMapData, mapStoryIds } from "../lib/map-data.js";
import { readDeliverySummary } from "../lib/delivery-summary.js";
import { read, walk } from "../lib/project.js";
import { store } from "../lib/store.js";
import { baseBranch, branchExists, commitPaths, currentBranch, firstLine, gitIn, headOf, isGit, nikosPaths, onBaseBranch, ownRepo, pathOf, pushBranch, realRun, remoteHas, statusOf, switchNewBranch, unrelatedDirty, type Runner } from "../lib/git.js";
import { asLine, hostOf, requestArgv, runForge, toolFor } from "../lib/forge.js";
import { editBet, reviewBet } from "./bets.js";
import { delivery } from "./delivery.js";
import { checkIn, isStale, latest, progress } from "./krs.js";
import { betIds, hash, krIds, loadBet, loadKr, loadPlan, paths, StaleError, today } from "./model.js";
import { betDeliveryText, rollout } from "./rollout.js";
import { loadUpstream, upstreamEntries } from "./upstream.js";
import { alignsList } from "./levels.js";
import { renderDashboard } from "./ui.js";
import { runOp, vetOp, type Op } from "./ops.js";
import { parse } from "yaml";
import { betsAndStoryMaps, okrLadder, okrsAndBets } from "./views.js";

const MAX_BODY = 100_000;

/** What planningData includes. An editable snapshot is own-only unless it's --with-linked. */
export interface DataOptions {
  ownOnly?: boolean;
  linked?: boolean;
}
const VIEW_NAME = /^[a-z0-9-]+$/;
const VIEW_FILE = /^[a-z0-9-]+\.html$/;
const HTML = "text/html; charset=utf-8";
const JS = "application/javascript; charset=utf-8";
const NOT_THIS_SITE = "A page on another site can't change this plan";
const TOKEN_ERROR = "Missing or wrong token. Open the dashboard from the link nikos planning serve printed.";
/** The POST routes. Every one passes the same checks, in the same order, before its body is read. */
const POSTS = new Set(["/api/checkin", "/api/bet", "/api/review", "/api/op", "/api/git/commit", "/api/git/push", "/api/git/pr"]);

/** What a custom view can rely on. Keep this in step with VIEW_SCRIPT and the save kinds below. */
export const VIEW_CONTRACT = `# Custom planning views

A custom view is a page at planning/views/<name>.html (lowercase letters, digits and hyphens). It is served at /views/<name>, and the server adds /nikos-view.js and the dashboard token to it.

window.nikos.data(): Promise<object>
  The dashboard data: { project, today, plan, krs, bets, story, upstream, views, problems, maps, pages }.
  krs[]: id, title, owner, unit, baseline, target, by, latest, latestValue, progress, stale, hash, checkins,
    aligns_to (a list), upstream (the first key result it aligns to) and aligned (every one).
  bets[] also carry aligns_to: the bets in the plan above they align to, as a list.
  bets[]: id, owner, team, hypothesis, krs, starts, review_on, deadline, confidence, outcome, reviews, body, hash, delivery, releases.
  upstream[] is read-only: plans synced from other repos. Never save to it.

window.nikos.save(kind, payload): Promise<{ wrote: string }>
  "checkin": { id, expect, value, note?, evidence? }
  "bet": { id, expect, fields: { owner?, team?, hypothesis?, starts?, review_on?, deadline?, confidence?, dependencies?, outcome? } }
  "review": { id, expect, decision: "continue" | "change" | "stop" | "complete", reason, outcome?: "won" | "lost" }

window.nikos.op(op, target, args, expect): Promise<{ ok, message, changed, branch }>
  The same change the dashboard makes: POST /api/op, with { op, target, args, expect }. The op names and their
  levels are in src/planning/ops.ts. Story and activity ids are checked the way the commands check them.

expect is the hash of the item as data() returned it. A save rejected with status 409 means the file changed on disk: call data() again and apply the change to the new version. Other rejections carry the reason. Saves write only the planning, maps and assignments paths of this repo.
`;

/** The script every custom view gets. It saves through the same endpoints, with the same token and hash checks. */
const VIEW_SCRIPT = `(function () {
  var meta = document.querySelector('meta[name="nikos-token"]');
  var token = meta ? meta.getAttribute('content') : (new URLSearchParams(location.search).get('token') || '');
  if (location.search.indexOf('token=') >= 0 && window.history && history.replaceState) history.replaceState(null, '', location.pathname);
  var paths = { checkin: '/api/checkin', bet: '/api/bet', review: '/api/review' };
  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Nikos-Token': token },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (!r.ok) {
          var err = new Error(body.error || 'HTTP ' + r.status);
          err.status = r.status;
          throw err;
        }
        return body;
      });
    });
  }
  window.nikos = {
    data: function () {
      return fetch('/api/data').then(function (r) {
        if (!r.ok) throw new Error('Could not load the planning data (HTTP ' + r.status + ')');
        return r.json();
      });
    },
    save: function (kind, payload) {
      var path = paths[kind];
      if (!path) return Promise.reject(new Error('Unknown save kind "' + kind + '": use checkin, bet or review'));
      return post(path, payload);
    },
    op: function (op, target, args, expect) {
      return post('/api/op', { op: op, target: target || {}, args: args || {}, expect: expect });
    }
  };
})();
`;

type Upstream = ReturnType<typeof loadUpstream>;

/** The upstream KR a KR aligns to, found in the read-only copies. */
function upstreamRef(upstream: Upstream, ref: string | undefined) {
  if (!ref) return null;
  const [repo, id] = ref.split("#");
  const plan = upstream.find((u) => u.repo === repo);
  const kr = plan?.krs?.find((k: any) => k.id === id) ?? null;
  return { ref, repo, commit: plan?.commit ?? null, found: kr !== null, kr, readOnly: true };
}

/**
 * The story maps of this repo, each with every story's status from the map's delivery summary
 * (maps/<key>/delivery.yaml), so the page reads what was committed, never a live file. A map that
 * doesn't read is listed with its problem.
 */
function mapsData(root: string) {
  if (!mapDirs(root).length) return [];
  return mapDirs(root).map((dir) => {
    const id = basename(dir);
    const key = keyOfMap(dir) ?? id;
    try {
      const ref = resolveStoryMap(root, id);
      const sm = storyMapOfRef(ref);
      const info = new Map<string, { title: string; activity: string; release: number }>();
      for (const r of sm.releases) for (const s of r.stories) info.set(s.id, { title: s.title, activity: s.activity, release: r.number });
      for (const s of sm.unreleased) info.set(s.id, { title: s.title, activity: s.activity, release: 0 });
      const summary = readDeliverySummary(dir);
      const byId = new Map((summary?.stories ?? []).map((s) => [s.id, s]));
      const stories = mapStoryIds(loadMapData(dir)).map((sid) => {
        const i = info.get(sid);
        const s = byId.get(sid);
        const file = featureOf(ref, sid);
        return {
          id: sid,
          title: i?.title ?? sid,
          activity: i?.activity ?? "",
          release: i?.release ?? 0,
          status: s?.status ?? "todo",
          freshness: s ? (s.proof ?? "summary") : "no-summary",
          reason: s?.proof ? "not current with its feature: nikos map status says what to run" : s ? "" : "no summary yet: run nikos map status",
          hash: file ? hash(read(file)) : "",
        };
      });
      return {
        id,
        key,
        title: sm.project || key,
        storymapHash: hash(read(join(ref.dir, "storymap.yaml"))),
        // The bet this map specs: the storymap.yaml's own bet key, so the page can show each map under its bet.
        bet: (parse(read(join(ref.dir, "storymap.yaml"))) as any)?.bet ?? null,
        stories,
      };
    } catch (err) {
      return { id, key, title: key, storymapHash: "", stories: [], problem: (err as Error).message.split("\n")[0] };
    }
  });
}

/** Everything the views need, as JSON. Files that fail to load are listed in `problems`, not thrown. */
export function planningData(root: string, mapId?: string, opts: DataOptions = {}) {
  const plan = loadPlan(root) ?? null;
  const story = storyMapOf(root, mapId);
  // An editable snapshot embeds the other plans only with --with-linked.
  const copies = !opts.ownOnly || !!opts.linked;
  const upstream = copies ? loadUpstream(root) : [];
  const problems: string[] = [];
  const krs = krIds(root).flatMap((id) => {
    try {
      const kr = loadKr(root, id);
      const d = kr.data;
      const last = latest(d) ?? null;
      return [
        {
          id: d.id ?? id,
          title: d.title,
          objective: d.objective ?? "",
          owner: d.owner,
          unit: d.unit ?? "",
          baseline: d.baseline,
          target: d.target,
          original_target: d.original_target,
          by: d.by,
          stale_after_days: d.stale_after_days ?? 14,
          aligns_to: alignsList(d.aligns_to),
          checkins: d.checkins ?? [],
          latest: last,
          latestValue: last ? last.value : d.baseline,
          progress: progress(d),
          stale: isStale(d),
          hash: kr.hash,
          file: kr.file,
          upstream: upstreamRef(upstream, alignsList(d.aligns_to)[0]),
          aligned: alignsList(d.aligns_to).map((r) => upstreamRef(upstream, r)),
        },
      ];
    } catch (err) {
      problems.push((err as Error).message.split("\n")[0]);
      return [];
    }
  });
  const bets = betIds(root).flatMap((id) => {
    try {
      const bet = loadBet(root, id);
      const m = bet.meta;
      const d = delivery(root, id);
      return [
        {
          id: m.id ?? id,
          owner: m.owner,
          team: m.team ?? "",
          hypothesis: m.hypothesis,
          krs: { primary: m.krs?.primary ?? null, also: m.krs?.also ?? [] },
          aligns_to: alignsList(m.aligns_to),
          starts: m.starts ?? null,
          review_on: m.review_on,
          deadline: m.deadline ?? null,
          confidence: m.confidence,
          dependencies: m.dependencies ?? [],
          outcome: m.outcome,
          reviews: m.reviews ?? [],
          body: bet.body.trim(),
          hash: bet.hash,
          file: bet.file,
          delivery: { ...d, text: betDeliveryText(root, id, d) },
          releases: d.releases.map((n) => ({
            number: n,
            title: story.releases.find((r) => r.number === n)?.title ?? `Release ${n}`,
            href: `/map#release-${n}`,
          })),
        },
      ];
    } catch (err) {
      problems.push((err as Error).message.split("\n")[0]);
      return [];
    }
  });
  const viewsDir = paths(root).views;
  const views = existsSync(viewsDir)
    ? readdirSync(viewsDir)
        .filter((f) => VIEW_FILE.test(f))
        .map((f) => f.slice(0, -".html".length))
        .sort()
    : [];
  const out: any = {
    project: plan?.name ?? (story.project || basename(root)),
    today: today(),
    // Null when there is no planning/plan.yaml, as the export always had it.
    plan: plan ? { ...plan, level: plan.level ?? null, name: plan.name ?? (story.project || basename(root)), repo: ownRepo(root) ?? null } : null,
    krs,
    bets,
    story: { activities: story.activities, releases: story.releases, unreleased: story.unreleased },
    upstream,
    // The plans below this one, from the copies the last rollout fetched: loading never fetches.
    downstream: copies && existsSync(join(root, "planning", "downstream.yaml")) ? rollout(root, { offline: true }) : null,
    maps: mapsData(root),
    views,
    problems,
  };
  // Without copies, the snapshot has no upstream or downstream keys at all.
  if (!copies) {
    delete out.upstream;
    delete out.downstream;
  }
  return { ...out, pages: { okrsAndBets: okrsAndBets(out), okrLadder: okrLadder(out), betsAndStoryMaps: betsAndStoryMaps(out) } };
}

/** Write the whole dashboard as one offline HTML file. Warns first when other repos' plans are inside. */
export function exportSnapshot(root: string, file: string): { wrote: string; warned: boolean } {
  const out = resolve(file);
  const data = planningData(root);
  const names = [...loadUpstream(root).map((u) => u.repo), ...(data.downstream?.plans ?? []).filter((p: any) => p.repo && p.state !== "unreachable").map((p: any) => p.repo as string)];
  const warned = names.length > 0;
  if (warned) {
    process.stderr.write(`! This snapshot includes plans from other repos (${names.join(", ")}); share it only with people allowed to see them.\n`);
  }
  writeFileSync(out, renderDashboard({ data, readOnly: true }));
  return { wrote: out, warned };
}

/** Every planning and story map file the snapshot holds, with its hash: the expect values a change file carries. */
function hashesOf(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (abs: string) => {
    out[relative(root, abs).split(sep).join("/")] = hash(read(abs));
  };
  if (store().exists(paths(root).plan)) add(paths(root).plan);
  for (const f of walk(paths(root).krs, ".yaml")) add(f);
  for (const f of walk(paths(root).bets, ".md")) add(f);
  for (const dir of mapDirs(root)) for (const f of walk(dir)) add(f);
  if (store().isDir(join(root, "intent"))) for (const f of walk(join(root, "intent"))) add(f);
  return out;
}

/** The commit a snapshot was made from, and whether the nikOS files had changes not in it. */
function sourceOf(root: string): { commit: string | null; dirty: boolean; exported: string; warning?: string } {
  const exported = new Date().toISOString();
  if (!isGit(root)) return { commit: null, dirty: false, exported, warning: "Not a git repo: the snapshot records no commit." };
  return { commit: headOf(root) ?? null, dirty: statusOf(root, nikosPaths(root)).length > 0, exported };
}

export interface EditableOptions {
  /** Embed the copies of the plans above and below, read-only. */
  withLinked?: boolean;
  /** Told each line before the file is written: the warnings, and the count of other plans. */
  notice?: (line: string) => void;
}

/**
 * Write the dashboard as one file that edits: changes are queued in the page and downloaded as a
 * change file for nikos apply. By default only this level's own files are in it. With withLinked,
 * the copies of the plans above and below are too, read-only. Team status is never in it.
 */
export function exportEditable(root: string, file: string, opts: EditableOptions = {}): { wrote: string; withLinked: boolean; copies: number } {
  const out = resolve(file);
  const linked = !!opts.withLinked;
  if (linked) {
    for (const e of upstreamEntries(root)) {
      if (!store().isDir(join(paths(root).cache, ...e.repo.split("/")))) {
        throw new Error(`No synced copy of ${e.repo}: run nikos planning sync first, or leave out --with-linked`);
      }
    }
  }
  const data: any = planningData(root, undefined, { ownOnly: true, linked });
  const source = sourceOf(root);
  const copies = linked
    ? [...new Set([...loadUpstream(root).map((u) => u.repo), ...(data.downstream?.plans ?? []).filter((p: any) => p.repo && p.state !== "unreachable").map((p: any) => p.repo as string)])]
    : [];
  const { warning, ...snapshotSource } = source;
  if (warning) opts.notice?.(`! ${warning}`);
  if (linked) opts.notice?.(`This file includes read-only copies of ${copies.length} other plans.`);
  data.snapshot = { editable: true, withLinked: linked, source: snapshotSource, hashes: hashesOf(root) };
  writeFileSync(out, renderDashboard({ data, readOnly: true, editable: true }));
  return { wrote: out, withLinked: linked, copies: copies.length };
}

export interface RunningServer {
  url: string;
  token: string;
  port: number;
  close(): Promise<void>;
}

export interface StartOptions {
  port?: number;
  map?: string;
  /** Runs git and the forge tools. Tests pass a runner that records the calls. */
  run?: Runner;
}

interface Ctx {
  root: string;
  token: string;
  port: number;
  mapId?: string;
  run: Runner;
  /** How many saves this server has made since it started. */
  session: { ops: number };
}

/** Start the dashboard on 127.0.0.1 with a fresh token. The url carries the token for the browser. */
export async function startServer(root: string, opts: StartOptions = {}): Promise<RunningServer> {
  const token = randomBytes(24).toString("hex");
  let port = 0;
  const ctx: Ctx = { root, token, port: 0, mapId: opts.map, run: opts.run ?? realRun, session: { ops: 0 } };
  const server = createServer((req, res) => {
    ctx.port = port;
    route(ctx, req, res).catch((err) => send(res, 500, { error: (err as Error).message }));
  });
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(opts.port ?? 0, "127.0.0.1", () => ok());
  });
  port = (server.address() as AddressInfo).port;
  ctx.port = port;
  return {
    url: `http://127.0.0.1:${port}/?token=${token}`,
    token,
    port,
    close: () =>
      new Promise<void>((ok) => {
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}

/** `nikos planning serve`: run the dashboard until Ctrl+C, or export it to one file. */
export async function runServe(root: string, opts: { port?: number; exportTo?: string; map?: string; editable?: boolean; withLinked?: boolean } = {}): Promise<number> {
  if (opts.withLinked && !opts.editable) {
    console.error("✗ --with-linked only works with --editable. Try: nikos serve --export plan.html --editable --with-linked");
    return 1;
  }
  if (opts.editable) {
    if (!opts.exportTo) {
      console.error("✗ --editable needs a file to save to. Try: nikos serve --export plan.html --editable");
      return 1;
    }
    try {
      const { wrote } = exportEditable(root, opts.exportTo, { withLinked: opts.withLinked, notice: (line) => console.log(line) });
      console.log(`Saved an editable copy of the dashboard: ${wrote}`);
      console.log("Send it to the people you plan with. They open it in a browser, make changes and download a changes file.");
      console.log("When they send that file back, apply it here with nikos apply and the file's name.");
      return 0;
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`);
      return 1;
    }
  }
  if (opts.exportTo) {
    const { wrote } = exportSnapshot(root, opts.exportTo);
    console.log(`Saved the dashboard as one page: ${wrote}`);
    console.log("It opens in any browser, works offline and can't change anything.");
    return 0;
  }
  const srv = await startServer(root, { port: opts.port, map: opts.map });
  console.log("The dashboard is running. Open this link in your browser:");
  console.log(`  ${srv.url}`);
  console.log("");
  console.log("The link has a private key in it, so keep it to yourself.");
  console.log(isGit(root)
    ? "Changes you make there are saved on a new branch in this repo. Nothing is pushed until you click Push."
    : "Changes you make there are saved to the files in this folder.");
  console.log("Press Ctrl+C to stop the dashboard.");
  return new Promise<number>((ok) => {
    const stop = () => {
      srv.close().then(() => ok(0));
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

function send(res: ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8") {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(text);
}

const sameToken = (given: string, token: string) => {
  const a = Buffer.from(given), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
};

async function route(ctx: Ctx, req: IncomingMessage, res: ServerResponse) {
  // Only this machine's own address: a page on another site can't reach the dashboard by DNS rebinding.
  if (req.headers.host !== `127.0.0.1:${ctx.port}` && req.headers.host !== `localhost:${ctx.port}`) {
    return send(res, 403, { error: "The dashboard only answers on its own address on this machine" });
  }
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  if (req.method === "GET") return serveGet(ctx, path, req, res);
  if (req.method === "POST" && POSTS.has(path)) return postRequest(ctx, path, req, res);
  return send(res, 404, { error: "Not found" });
}

function serveGet(ctx: Ctx, path: string, req: IncomingMessage, res: ServerResponse) {
  const { root, token, mapId } = ctx;
  if (path === "/") return send(res, 200, renderDashboard({ data: planningData(root, mapId), token, readOnly: false }), HTML);
  if (path === "/api/data") return send(res, 200, planningData(root, mapId));
  if (path === "/api/pending") {
    const given = req.headers["x-nikos-token"];
    if (typeof given !== "string" || !sameToken(given, token)) return send(res, 403, { error: TOKEN_ERROR });
    return send(res, 200, pendingOf(ctx));
  }
  if (path === "/map") return send(res, 200, renderMap(root, { live: true, map: mapId }), HTML);
  if (path === "/nikos-view.js") return send(res, 200, VIEW_SCRIPT, JS);
  const m = /^\/views\/([^/]+)$/.exec(path);
  if (m && VIEW_NAME.test(m[1])) {
    const file = join(paths(root).views, `${m[1]}.html`);
    if (existsSync(file)) return send(res, 200, withViewScript(readFileSync(file, "utf8"), token), HTML);
  }
  return send(res, 404, { error: "Not found" });
}

/** Add the token and the contract script to a custom view's page. */
function withViewScript(html: string, token: string): string {
  const tags = `<meta name="nikos-token" content="${token}"><script src="/nikos-view.js"></script>`;
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${tags}</head>`) : tags + html;
}

/** Names that look like a secret: an .env file, or a key or certificate. Never committed by a click. */
const looksSecret = (p: string) => /(^|\/)(\.env(\..*)?|[^/]*\.(pem|key|p12))$/i.test(p);

const numberOf = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
const textOf = (v: unknown) => (typeof v === "string" ? v : undefined);

/**
 * The op each legacy save is, checked before anything else: the same checks as /api/op, so a team
 * repo, a wrong level or a stale expect refuse here too. outcome is left out of the check: the
 * legacy bet save still writes it, as it always has.
 */
function legacyOp(path: string, b: Record<string, any>): Op {
  if (path === "/api/checkin") return { op: "checkin", target: { kr: b.id }, args: { value: numberOf(b.value), note: textOf(b.note), evidence: textOf(b.evidence) }, expect: b.expect };
  if (path === "/api/bet") {
    if (!b.fields || typeof b.fields !== "object" || Array.isArray(b.fields)) throw new Error("fields must be an object of bet fields to change");
    const { outcome: _outcome, ...fields } = b.fields;
    return { op: "bet.edit", target: { bet: b.id }, args: fields, expect: b.expect };
  }
  return { op: "bet.review", target: { bet: b.id }, args: { decision: b.decision, reason: textOf(b.reason) ?? "", outcome: b.outcome }, expect: b.expect };
}

/** The legacy saves. They call the commands directly, as before, after legacyOp has checked them. */
const LEGACY = new Map<string, (root: string, b: Record<string, any>) => string>([
  ["/api/checkin", (root, b) => checkIn(root, b.id, { value: numberOf(b.value), note: textOf(b.note), evidence: textOf(b.evidence), expect: b.expect })],
  [
    "/api/bet",
    (root, b) => {
      if (!b.fields || typeof b.fields !== "object" || Array.isArray(b.fields)) throw new Error("fields must be an object of bet fields to change");
      return editBet(root, b.id, b.fields, b.expect);
    },
  ],
  ["/api/review", (root, b) => reviewBet(root, b.id, { decision: b.decision, reason: textOf(b.reason) ?? "", outcome: b.outcome, expect: b.expect })],
]);

class TooLarge extends Error {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) return fail(new TooLarge("The request is too large"));
      chunks.push(c);
    });
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}

/**
 * Every POST: the checks run before the body is read, in this order. Host (in route), Origin,
 * Sec-Fetch-Site, the token, then the content type. A page on another site can't pass the first three.
 */
async function postRequest(ctx: Ctx, path: string, req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://127.0.0.1:${ctx.port}` && origin !== `http://localhost:${ctx.port}`) {
    return send(res, 403, { error: NOT_THIS_SITE });
  }
  const site = req.headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin" && site !== "none") return send(res, 403, { error: NOT_THIS_SITE });
  const given = req.headers["x-nikos-token"];
  if (typeof given !== "string" || !sameToken(given, ctx.token)) return send(res, 403, { error: TOKEN_ERROR });
  if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
    return send(res, 415, { error: "Send the change as JSON (Content-Type: application/json)." });
  }
  let raw: string;
  try {
    raw = await readBody(req);
  } catch (err) {
    res.setHeader("connection", "close");
    return send(res, err instanceof TooLarge ? 413 : 400, { error: (err as Error).message });
  }
  let body: Record<string, any>;
  try {
    body = JSON.parse(raw);
  } catch {
    return send(res, 400, { error: "The request body must be JSON" });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return send(res, 400, { error: "The request body must be a JSON object" });
  if (path.startsWith("/api/git/")) return gitRequest(ctx, path, body, res);
  if (path === "/api/op") return opRequest(ctx, body, res);
  if (typeof body.id !== "string" || !BET_ID.test(body.id)) return send(res, 400, { error: `'${String(body.id)}' is not an id` });
  if (typeof body.expect !== "string") return send(res, 400, { error: "expect (the hash of the version you loaded) is required. Reload the dashboard." });
  // Checked before any branch is made, so a refused save leaves the repo where it was.
  try {
    vetOp(ctx.root, legacyOp(path, body));
  } catch (err) {
    return saveError(res, err);
  }
  const prep = beginSave(ctx);
  if (!prep.ok) return send(res, 400, { error: prep.error });
  try {
    const wrote = LEGACY.get(path)!(ctx.root, body);
    ctx.session.ops++;
    return send(res, 200, { wrote, ...(prep.branch ? { branch: prep.branch } : {}) });
  } catch (err) {
    return saveError(res, err);
  }
}

function saveError(res: ServerResponse, err: unknown) {
  if (err instanceof StaleError) return send(res, 409, { error: err.message });
  return send(res, 400, { error: (err as Error).message.split("\n")[0] });
}

/** POST /api/op: one change, through the same write path as the command line. */
function opRequest(ctx: Ctx, body: Record<string, any>, res: ServerResponse) {
  if (typeof body.op !== "string") return send(res, 400, { error: "op is the name of the change to make" });
  if (typeof body.expect !== "string") return send(res, 400, { error: "expect (the hash of the version you loaded) is required. Reload the dashboard." });
  if (body.target !== undefined && (!body.target || typeof body.target !== "object" || Array.isArray(body.target))) return send(res, 400, { error: "target must be an object" });
  if (body.args !== undefined && (!body.args || typeof body.args !== "object" || Array.isArray(body.args))) return send(res, 400, { error: "args must be an object" });
  const op: Op = { op: body.op as Op["op"], ...(body.target ? { target: body.target } : {}), args: body.args ?? {}, expect: body.expect };
  // The checks and the dry run come first: a refused change never switches the branch.
  try {
    vetOp(ctx.root, op);
  } catch (err) {
    return saveError(res, err);
  }
  const prep = beginSave(ctx);
  if (!prep.ok) return send(res, 400, { error: prep.error });
  try {
    const r = runOp(ctx.root, op, { strict: true });
    ctx.session.ops++;
    return send(res, 200, { ok: true, message: r.message, changed: r.changed, branch: prep.branch ?? null, ...(prep.notice ? { notice: prep.notice } : {}) });
  } catch (err) {
    return saveError(res, err);
  }
}

/**
 * Before a save: on a git repo, a save made while the repo is on its base branch goes on a new
 * nikos branch first. A save on another branch writes onto it. Detached HEAD saves as plain files.
 */
function beginSave(ctx: Ctx): { ok: true; branch?: string; notice?: string } | { ok: false; error: string } {
  const { root, run } = ctx;
  if (!isGit(root, run)) return { ok: true };
  const branch = currentBranch(root, run);
  if (!branch) return { ok: true, notice: "Saves aren't on a branch because HEAD is detached" };
  if (!onBaseBranch(branch, baseBranch(root, run))) return { ok: true, branch };
  const level = loadPlan(root)?.level ?? "plan";
  const stamp = today();
  let name = `nikos/plan-${level}-${stamp}`;
  for (let n = 2; branchExists(root, name, run); n++) name = `nikos/plan-${level}-${stamp}-${n}`;
  const made = switchNewBranch(root, name, run);
  if (!made.ok) return { ok: false, error: `Couldn't create a branch: ${made.error}` };
  return { ok: true, branch: name };
}

/** What the pending bar shows: the saved files not yet committed, the branch, and the forge's commands. */
function pendingOf(ctx: Ctx) {
  const { root, run } = ctx;
  if (!isGit(root, run)) {
    return { git: false, ops: ctx.session.ops, files: [], unrelated: [], message: "This folder is not a git repo: changes are saved to files only." };
  }
  const branch = currentBranch(root, run);
  const base = baseBranch(root, run);
  const url = gitIn(root, ["remote", "get-url", "origin"], run).stdout.trim();
  const kind = hostOf(url);
  const argv = branch && base ? requestArgv(kind, base, branch) : undefined;
  const unrelated = unrelatedDirty(root, run);
  return {
    git: true,
    branch: branch ?? null,
    base: base ?? null,
    onBase: !!branch && branch === base,
    hasOrigin: !!url,
    detached: !branch,
    ops: ctx.session.ops,
    files: statusOf(root, nikosPaths(root), run),
    /** The files a commit would take, by name, for the pending bar. */
    paths: statusOf(root, nikosPaths(root), run).map(pathOf),
    unrelated,
    ...(unrelated.length && branch ? { warning: `Saving onto ${branch} with uncommitted changes outside planning/, maps/ and intent/. Commit or stash them before opening a pull request.` } : {}),
    ...(branch ? {} : { notice: "Saves aren't on a branch because HEAD is detached" }),
    forge: {
      host: kind ?? null,
      tool: toolFor(kind, run, root),
      pushCommand: branch ? `git push -u origin ${branch}` : null,
      prCommand: asLine(argv) ?? null,
      pushed: branch ? remoteHas(root, branch, run) : false,
      requestLabel: kind === "gitlab" ? "Open merge request" : "Open pull request",
    },
  };
}

/** The git buttons: commit the planning paths, push the branch, open the request. Each only on its own click. */
function gitRequest(ctx: Ctx, path: string, body: Record<string, any>, res: ServerResponse) {
  const { root, run } = ctx;
  if (!isGit(root, run)) return send(res, 400, { error: "This folder is not a git repo: there is nothing to commit or push" });
  const branch = currentBranch(root, run);
  if (!branch) return send(res, 400, { error: "HEAD is detached: check out a branch first" });
  const base = baseBranch(root, run);
  if (path === "/api/git/commit") {
    if (onBaseBranch(branch, base)) return send(res, 400, { error: `Saves are on ${branch}, the base branch. Make a save first, so it goes on a nikos branch` });
    // Exactly the files the pending bar lists: never a whole folder, so an untracked stray file is not taken.
    const files = statusOf(root, nikosPaths(root), run).map(pathOf);
    if (!files.length) return send(res, 400, { error: "Nothing to commit" });
    const secret = files.find(looksSecret);
    if (secret) return send(res, 400, { error: `Not committing ${secret}: it looks like a secret. Remove it from the repo, or commit it by hand` });
    const changed = files.length;
    const message = typeof body.message === "string" && body.message.trim() ? body.message.trim() : `nikos: ${loadPlan(root)?.level ?? "plan"} changes (${changed})`;
    const r = commitPaths(root, files, message, run);
    if (!r.ok) return send(res, 400, { error: r.error });
    return send(res, 200, { committed: r.sha, message, branch });
  }
  if (path === "/api/git/push") {
    if (onBaseBranch(branch, base)) return send(res, 400, { error: `Push a nikos branch, not ${branch}` });
    const r = pushBranch(root, branch, run);
    if (!r.ok) return send(res, 400, { error: r.error });
    return send(res, 200, { pushed: branch });
  }
  // /api/git/pr
  if (onBaseBranch(branch, base)) return send(res, 400, { error: `Push a nikos branch, not ${branch}` });
  if (!remoteHas(root, branch, run)) return send(res, 400, { error: "Push the branch first, then open the request" });
  const kind = hostOf(gitIn(root, ["remote", "get-url", "origin"], run).stdout.trim());
  const argv = requestArgv(kind, base ?? "main", branch);
  if (!argv) return send(res, 200, { ran: false, command: null, message: "This forge isn't one nikOS knows: open the request in its web interface" });
  const command = asLine(argv);
  if (!toolFor(kind, run, root)) return send(res, 200, { ran: false, command, message: `${argv[0]} isn't installed here: copy this command and run it in the repo` });
  if (body.confirm !== true) return send(res, 200, { ran: false, command, needsConfirm: true, message: `Run ${command}?` });
  const r = runForge(argv, run, root);
  return send(res, r.ok ? 200 : 400, { ran: true, ok: r.ok, output: firstLine(r.output) || r.output, ...(r.ok ? {} : { error: firstLine(r.output) }) });
}

