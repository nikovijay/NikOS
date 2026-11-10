// The server behind nikos plan serve and nikos serve: a server on 127.0.0.1 that answers with the pages
// it is given (PageSource). A server that gives saveIn also saves, through the same checks as the command
// line: every save needs the token printed at start, and the pages need none. On a git repo, saves go on
// a branch; nothing is pushed or opened as a request unless a person clicks for it.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { baseBranch, branchExists, commitPaths, currentBranch, firstLine, gitIn, isGit, onBaseBranch, pathOf, pushBranch, realRun, remoteHas, statusOf, switchNewBranch, unrelatedDirty, type Runner } from "../lib/git.js";
import { asLine, hostOf, requestArgv, runForge, toolFor } from "../lib/forge.js";
import { StaleError, today } from "./model.js";
import { runOp, vetOp, type Op } from "./ops.js";

const MAX_BODY = 100_000;

const HTML = "text/html; charset=utf-8";
const NOT_THIS_SITE = "A page on another site can't change this plan";
const TOKEN_ERROR = "Missing or wrong token. Open the dashboard from the link nikos plan serve printed.";
/** The POST routes. Every one passes the same checks, in the same order, before its body is read. */
const POSTS = new Set(["/api/op", "/api/git/commit", "/api/git/push", "/api/git/pr"]);

export interface RunningServer {
  url: string;
  token: string;
  port: number;
  close(): Promise<void>;
}

/** Where a change is saved: the folder it goes in, and the area it is. */
export interface SaveTarget {
  root: string;
  area?: string;
}

/** The pages a server answers with: / and, if given, /api/data. Given saveIn, it takes saves too. */
export interface PageSource {
  /** The page for a query. The token is the server's, for the page's own saves. */
  page(query: URLSearchParams, token: string): string;
  /** The JSON for /api/data. Without it that path is not found. */
  data?(query: URLSearchParams): unknown;
  /** Where the change in body goes. Without it the server takes no save, and the git buttons are not there. */
  saveIn?(body: Record<string, any>): SaveTarget;
}

export interface StartOptions {
  port?: number;
  /** Runs git and the forge tools. Tests pass a runner that records the calls. */
  run?: Runner;
  pages: PageSource;
}

interface Ctx {
  root: string;
  token: string;
  port: number;
  run: Runner;
  /** How many saves this server has made since it started. */
  session: { ops: number };
  pages: PageSource;
  /** The areas saved to since the last commit, by rel. The git buttons commit these areas' files and no others. */
  touched: Set<string>;
}

/** Start the server on 127.0.0.1 with a fresh token. The url carries the token for the browser. */
export async function startServer(root: string, opts: StartOptions): Promise<RunningServer> {
  const token = randomBytes(24).toString("hex");
  let port = 0;
  const ctx: Ctx = { root, token, port: 0, run: opts.run ?? realRun, session: { ops: 0 }, pages: opts.pages, touched: opts.pages.saveIn ? savedBefore(root) : new Set() };
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
  // Only this machine's own address: a page on another site can't reach the server by DNS rebinding.
  if (req.headers.host !== `127.0.0.1:${ctx.port}` && req.headers.host !== `localhost:${ctx.port}`) {
    return send(res, 403, { error: "The dashboard only answers on its own address on this machine" });
  }
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  if (req.method === "GET") return serveGet(ctx, path, req, res);
  // A server that takes saves answers /api/op and its git buttons only. Its other saves are refused.
  if (req.method === "POST" && ctx.pages.saveIn) {
    if (POSTS.has(path)) return postRequest(ctx, path, req, res);
    return send(res, 501, { error: "The plan dashboard saves through /api/op: this save isn't on there" });
  }
  return send(res, 404, { error: "Not found" });
}

function serveGet(ctx: Ctx, path: string, req: IncomingMessage, res: ServerResponse) {
  const { token, pages } = ctx;
  const query = new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
  if (path === "/") return send(res, 200, pages.page(query, token), HTML);
  if (path === "/api/data" && pages.data) return send(res, 200, pages.data(query));
  if (path === "/api/pending" && pages.saveIn) {
    const given = req.headers["x-nikos-token"];
    if (typeof given !== "string" || !sameToken(given, token)) return send(res, 403, { error: TOKEN_ERROR });
    return send(res, 200, pendingOf(ctx));
  }
  return send(res, 404, { error: "Not found" });
}

/** Names that look like a secret: an .env file, or a key or certificate. Never committed by a click. */
const looksSecret = (p: string) => /(^|\/)(\.env(\..*)?|[^/]*\.(pem|key|p12))$/i.test(p);

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
  return opRequest(ctx, body, res);
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
  const saveIn = ctx.pages.saveIn;
  if (!saveIn) return send(res, 404, { error: "Not found" });
  // The folder and the checks come first, and the dry run: a refused change never switches the branch.
  let where: SaveTarget;
  try {
    where = saveIn(body);
    vetOp(where.root, op);
  } catch (err) {
    return saveError(res, err);
  }
  const prep = beginSave(ctx, where.area);
  if (!prep.ok) return send(res, 400, { error: prep.error });
  try {
    const r = runOp(where.root, op, { strict: true });
    ctx.session.ops++;
    if (where.area) {
      ctx.touched.add(where.area);
      keepSaved(ctx.root, ctx.touched);
    }
    return send(res, 200, { ok: true, message: r.message, changed: r.changed, branch: prep.branch ?? null, ...(where.area ? { area: where.area } : {}), ...(prep.notice ? { notice: prep.notice } : {}) });
  } catch (err) {
    return saveError(res, err);
  }
}

/**
 * Before a save: on a git repo, a save made while the repo is on its base branch goes on a new
 * nikos branch first, named for the area it saves (nikos/plan-departments-finance-<date>) or else the
 * plan's level. A save on another branch writes onto it. Detached HEAD saves as plain files.
 */
function beginSave(ctx: Ctx, area?: string): { ok: true; branch?: string; notice?: string } | { ok: false; error: string } {
  const { root, run } = ctx;
  if (!isGit(root, run)) return { ok: true };
  const branch = currentBranch(root, run);
  if (!branch) return { ok: true, notice: "Saves aren't on a branch because HEAD is detached" };
  if (!onBaseBranch(branch, baseBranch(root, run))) return { ok: true, branch };
  const label = area ? area.split("/").join("-") : "plan";
  const stamp = today();
  let name = `nikos/plan-${label}-${stamp}`;
  for (let n = 2; branchExists(root, name, run); n++) name = `nikos/plan-${label}-${stamp}-${n}`;
  const made = switchNewBranch(root, name, run);
  if (!made.ok) return { ok: false, error: `Couldn't create a branch: ${made.error}` };
  return { ok: true, branch: name };
}

/** Where a plan dashboard keeps the areas it has saved to and not committed. It's under .nikos/, which git ignores. */
const savedFile = (root: string) => join(root, ".nikos", "saved-areas.json");

/** The areas saved to before this start, from that file. None when it's missing or unreadable. */
function savedBefore(root: string): Set<string> {
  try {
    const v = JSON.parse(readFileSync(savedFile(root), "utf8"));
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/** Keeps the list of areas saved to. A save is on disk already, so a list that can't be written costs only the restart. */
function keepSaved(root: string, areas: Set<string>): void {
  try {
    mkdirSync(join(root, ".nikos"), { recursive: true });
    writeFileSync(savedFile(root), `${JSON.stringify([...areas].sort())}\n`);
  } catch {
    // The save stands; only a restart would forget which areas it was in.
  }
}

/** The areas the git buttons commit: the ones saved to and not committed yet, and no other area's files. */
function savedAreas(ctx: Ctx): string[] {
  return [...ctx.touched].sort();
}

/** The paths the git buttons work on: the planning/ folders of the areas saved to. */
function savePaths(ctx: Ctx): string[] {
  return savedAreas(ctx).map((a) => `planning/${a}`);
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
    files: statusOf(root, savePaths(ctx), run),
    /** The files a commit would take, by name, for the pending bar. */
    paths: statusOf(root, savePaths(ctx), run).map(pathOf),
    unrelated,
    ...(unrelated.length && branch ? { warning: `Saving onto ${branch} with uncommitted changes outside planning/ and maps/. Commit or stash them before opening a pull request.` } : {}),
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
    // In a plan dashboard that is the areas saved to, and no other area's files.
    const files = statusOf(root, savePaths(ctx), run).map(pathOf);
    if (!files.length) return send(res, 400, { error: "Nothing to commit" });
    const secret = files.find(looksSecret);
    if (secret) return send(res, 400, { error: `Not committing ${secret}: it looks like a secret. Remove it from the repo, or commit it by hand` });
    const changed = files.length;
    const what = `plan changes to ${savedAreas(ctx).join(", ")}`;
    const message = typeof body.message === "string" && body.message.trim() ? body.message.trim() : `nikos: ${what} (${changed})`;
    const r = commitPaths(root, files, message, run);
    if (!r.ok) return send(res, 400, { error: r.error });
    // Committed: no area is waiting now, so a restart has none to remember.
    ctx.touched.clear();
    keepSaved(root, ctx.touched);
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

