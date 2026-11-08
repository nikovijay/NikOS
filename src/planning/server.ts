// The local planning dashboard: a server on 127.0.0.1 that shows the planning/ folder and
// saves through the same model functions as the command line. Every save needs the token
// printed at start; the static pages and the export need none. Also the one-file export and
// the contract custom views are written against.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { renderMap, storyMapOf } from "../commands/map.js";
import { BET_ID } from "../lib/bets.js";
import { editBet, reviewBet } from "./bets.js";
import { delivery, describeDelivery } from "./delivery.js";
import { checkIn, isStale, latest, progress } from "./krs.js";
import { betIds, krIds, loadBet, loadKr, loadPlan, paths, StaleError, today } from "./model.js";
import { rollout } from "./rollout.js";
import { loadUpstream } from "./upstream.js";
import { alignsList } from "./levels.js";
import { renderDashboard } from "./ui.js";

const MAX_BODY = 100_000;
const VIEW_NAME = /^[a-z0-9-]+$/;
const VIEW_FILE = /^[a-z0-9-]+\.html$/;
const HTML = "text/html; charset=utf-8";
const JS = "application/javascript; charset=utf-8";

/** What a custom view can rely on. Keep this in step with VIEW_SCRIPT and the save kinds below. */
export const VIEW_CONTRACT = `# Custom planning views

A custom view is a page at planning/views/<name>.html (lowercase letters, digits and hyphens). It is served at /views/<name>, and the server adds /nikos-view.js and the dashboard token to it.

window.nikos.data(): Promise<object>
  The dashboard data: { project, today, plan, krs, bets, story, upstream, views, problems }.
  krs[]: id, title, owner, unit, baseline, target, by, latest, latestValue, progress, stale, hash, checkins,
    aligns_to (a list), upstream (the first key result it aligns to) and aligned (every one).
  bets[] also carry aligns_to: the bets in the plan above they align to, as a list.
  bets[]: id, owner, team, hypothesis, krs, starts, review_on, deadline, confidence, outcome, reviews, body, hash, delivery, releases.
  upstream[] is read-only: plans synced from other repos. Never save to it.

window.nikos.save(kind, payload): Promise<{ wrote: string }>
  "checkin": { id, expect, value, note?, evidence? }
  "bet": { id, expect, fields: { owner?, team?, hypothesis?, starts?, review_on?, deadline?, confidence?, dependencies?, outcome? } }
  "review": { id, expect, decision: "continue" | "change" | "stop" | "complete", reason, outcome?: "won" | "lost" }

expect is the hash of the item as data() returned it. A save rejected with status 409 means the file changed on disk: call data() again and apply the change to the new version. Other rejections carry the reason. Saves only ever write inside planning/.
`;

/** The script every custom view gets. It saves through the same endpoints, with the same token and hash checks. */
const VIEW_SCRIPT = `(function () {
  var meta = document.querySelector('meta[name="nikos-token"]');
  var token = meta ? meta.getAttribute('content') : (new URLSearchParams(location.search).get('token') || '');
  var paths = { checkin: '/api/checkin', bet: '/api/bet', review: '/api/review' };
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
      return fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Nikos-Token': token },
        body: JSON.stringify(payload || {})
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

/** Everything the views need, as JSON. Files that fail to load are listed in `problems`, not thrown. */
export function planningData(root: string, mapId?: string) {
  const plan = loadPlan(root) ?? null;
  const story = storyMapOf(root, mapId);
  const upstream = loadUpstream(root);
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
          delivery: { ...d, text: describeDelivery(d) },
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
  return {
    project: plan?.name ?? (story.project || basename(root)),
    today: today(),
    plan,
    krs,
    bets,
    story: { activities: story.activities, releases: story.releases, unreleased: story.unreleased },
    upstream,
    // The plans below this one, from the copies the last rollout fetched: loading never fetches.
    downstream: existsSync(join(root, "planning", "downstream.yaml")) ? rollout(root, { offline: true }) : null,
    views,
    problems,
  };
}

/** Write the whole dashboard as one offline HTML file. Warns first when other repos' plans are inside. */
export function exportSnapshot(root: string, file: string): { wrote: string; warned: boolean } {
  const out = resolve(file);
  const data = planningData(root);
  const names = [...loadUpstream(root).map((u) => u.repo), ...(data.downstream?.plans ?? []).filter((p) => p.repo && p.state !== "unreachable").map((p) => p.repo!)];
  const warned = names.length > 0;
  if (warned) {
    process.stderr.write(`! This snapshot includes plans from other repos (${names.join(", ")}); share it only with people allowed to see them.\n`);
  }
  writeFileSync(out, renderDashboard({ data, readOnly: true }));
  return { wrote: out, warned };
}

export interface RunningServer {
  url: string;
  token: string;
  port: number;
  close(): Promise<void>;
}

/** Start the dashboard on 127.0.0.1 with a fresh token. The url carries the token for the browser. */
export async function startServer(root: string, opts: { port?: number; map?: string } = {}): Promise<RunningServer> {
  const token = randomBytes(24).toString("hex");
  let port = 0;
  const server = createServer((req, res) => {
    route(root, token, port, req, res, opts.map).catch((err) => send(res, 500, { error: (err as Error).message }));
  });
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(opts.port ?? 0, "127.0.0.1", () => ok());
  });
  port = (server.address() as AddressInfo).port;
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
export async function runServe(root: string, opts: { port?: number; exportTo?: string; map?: string } = {}): Promise<number> {
  if (opts.exportTo) {
    const { wrote } = exportSnapshot(root, opts.exportTo);
    console.log(`Wrote ${wrote}`);
    return 0;
  }
  const srv = await startServer(root, { port: opts.port, map: opts.map });
  console.log(`nikOS planning dashboard: ${srv.url}`);
  console.log(`Saves write to ${relative(process.cwd(), paths(root).planning) || "planning"}/ only. Press Ctrl+C to stop.`);
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

async function route(root: string, token: string, port: number, req: IncomingMessage, res: ServerResponse, mapId?: string) {
  // Only this machine's own address: a page on another site can't reach the dashboard by DNS rebinding.
  if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
    return send(res, 403, { error: "The dashboard only answers on its own address on this machine" });
  }
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  if (req.method === "GET") return serveGet(root, token, path, res, mapId);
  if (req.method === "POST" && SAVES.has(path)) return saveRequest(root, token, path, req, res);
  return send(res, 404, { error: "Not found" });
}

function serveGet(root: string, token: string, path: string, res: ServerResponse, mapId?: string) {
  if (path === "/") return send(res, 200, renderDashboard({ data: planningData(root, mapId), token, readOnly: false }), HTML);
  if (path === "/api/data") return send(res, 200, planningData(root, mapId));
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

const numberOf = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
const textOf = (v: unknown) => (typeof v === "string" ? v : undefined);

const SAVES = new Map<string, (root: string, b: Record<string, any>) => string>([
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

async function saveRequest(root: string, token: string, path: string, req: IncomingMessage, res: ServerResponse) {
  const given = req.headers["x-nikos-token"];
  if (typeof given !== "string" || !sameToken(given, token)) {
    return send(res, 403, { error: "Missing or wrong token. Open the dashboard from the link nikos planning serve printed." });
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
  if (typeof body.id !== "string" || !BET_ID.test(body.id)) return send(res, 400, { error: `'${String(body.id)}' is not an id` });
  if (typeof body.expect !== "string") return send(res, 400, { error: "expect (the hash of the version you loaded) is required. Reload the dashboard." });
  try {
    return send(res, 200, { wrote: SAVES.get(path)!(root, body) });
  } catch (err) {
    if (err instanceof StaleError) return send(res, 409, { error: err.message });
    return send(res, 400, { error: (err as Error).message.split("\n")[0] });
  }
}
