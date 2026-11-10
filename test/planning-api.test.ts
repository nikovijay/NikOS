// The dashboard's write endpoints: /api/op through the one write path, the legacy saves kept as
// they were, and the checks every POST passes before its body is read.
import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { companyInit } from "../src/commands/start";
import { newBet } from "../src/planning/bets";
import { newKr } from "../src/planning/krs";
import { hash, loadBet, loadKr } from "../src/planning/model";
import { startServer, type RunningServer } from "../src/planning/server";
import type { Runner } from "../src/lib/git";
import { groupRepo, readText } from "./planning-fixture";

let running: RunningServer[] = [];
afterEach(async () => {
  await Promise.all(running.map((s) => s.close()));
  running = [];
});

/** A company plan that isn't a git repo, with one key result and one bet. */
function plainCompany(): string {
  const dir = mkdtempSync(join(tmpdir(), "nikos-plain-"));
  companyInit(dir, { name: "Acme", period: "Q1 2027", repo: "acme/company-plan" });
  newKr({ id: "kr-1", title: "Grow revenue", owner: "Board", baseline: 1, target: 2, by: "2027-03-31" }, dir);
  newBet({ id: "faster", owner: "Board", hypothesis: "Faster checkout pays", reviewOn: "2027-02-01" }, dir);
  return dir;
}

async function start(root: string, run?: Runner): Promise<RunningServer> {
  const srv = await startServer(root, run ? { run } : {});
  running.push(srv);
  return srv;
}

interface Raw {
  status: number;
  body: any;
}

/** A request with exactly the headers given, so a test can send a Host, Origin or Content-Type it chooses. */
function raw(srv: RunningServer, method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<Raw> {
  const payload = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  return new Promise((ok, fail) => {
    const req = http.request({ host: "127.0.0.1", port: srv.port, path, method, headers: { ...(payload ? { "content-length": Buffer.byteLength(payload) } : {}), ...headers } }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => {
        let parsed: any = text;
        try {
          parsed = text ? JSON.parse(text) : {};
        } catch {
          // a page, not JSON
        }
        ok({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    req.on("error", fail);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

/** A JSON POST from this machine's own page, with the token. */
const ok = (srv: RunningServer, path: string, body: unknown, extra: Record<string, string> = {}) =>
  raw(srv, "POST", path, { host: `127.0.0.1:${srv.port}`, "content-type": "application/json", "x-nikos-token": srv.token, ...extra }, body);

const opBody = (op: string, target: Record<string, string>, args: Record<string, unknown>, expect = "") => ({ op, target, args, expect });

describe("POST /api/op", () => {
  it("applies a change and reports what it wrote, under planning/ only", async () => {
    const root = plainCompany();
    const srv = await start(root);
    const h = hash(readText(root, "planning/krs/kr-1.yaml"));
    const res = await ok(srv, "/api/op", opBody("checkin", { kr: "kr-1" }, { value: 1.5, note: "Week 1" }, h));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, message: "Checked in kr-1: 1.5", changed: ["planning/krs/kr-1.yaml"], branch: null });
    expect(loadKr(root, "kr-1").data.checkins.at(-1)).toMatchObject({ value: 1.5, note: "Week 1" });
  });

  it("returns the command's refusal, verbatim, as a 400", async () => {
    const root = plainCompany();
    const srv = await start(root);
    const res = await ok(srv, "/api/op", opBody("kr.edit", { kr: "kr-1" }, { title: "" }, hash(readText(root, "planning/krs/kr-1.yaml"))));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("A key result needs a title (--title)");
  });

  it("refuses an op at the wrong level with a 400", async () => {
    const srv = await start(plainCompany());
    const res = await ok(srv, "/api/op", opBody("story.rename", { story: "HT-1" }, { title: "x" }, "0000000000000000"));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("story.rename isn't a change the company plan makes here");
  });

  it("refuses an id that is a path, and accepts a group's story id", async () => {
    const srv = await start(plainCompany());
    const bad = await ok(srv, "/api/op", opBody("kr.edit", { kr: "../../etc" }, { title: "x" }, "0000000000000000"));
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("'../../etc' is not a key result id (lowercase words joined by hyphens)");

    const g = groupRepo("PAY");
    const gsrv = await start(g);
    const story = await ok(gsrv, "/api/op", opBody("story.rename", { story: "PAY-CHK-1" }, { map: "chk", title: "Pay by debit card" }, hash(readText(g, "maps/chk/features/pay/pay-by-card.feature"))));
    expect(story.status).toBe(200);
  });

  it("answers 409 when the file changed since the page loaded it", async () => {
    const root = plainCompany();
    const srv = await start(root);
    const res = await ok(srv, "/api/op", opBody("kr.edit", { kr: "kr-1" }, { title: "Again" }, "0000000000000000"));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/changed on disk since it was loaded/);
  });

  it("refuses outcome through /api/op: only a review sets it", async () => {
    const root = plainCompany();
    const srv = await start(root);
    const h = hash(readText(root, "planning/bets/faster.md"));
    const res = await ok(srv, "/api/op", opBody("bet.edit", { bet: "faster" }, { outcome: "won" }, h));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("'outcome' can't be edited here");
  });

  it("keeps the legacy /api/bet accepting outcome", async () => {
    const root = plainCompany();
    const srv = await start(root);
    const h = hash(readText(root, "planning/bets/faster.md"));
    const res = await ok(srv, "/api/bet", { id: "faster", expect: h, fields: { outcome: "lost" } });
    expect(res.status).toBe(200);
    expect(loadBet(root, "faster").meta.outcome).toBe("lost");
  });

  it("refuses a body that is too large with a 413", async () => {
    const srv = await start(plainCompany());
    const res = await ok(srv, "/api/op", { op: "checkin", expect: "x", args: { note: "x".repeat(120_000) } });
    expect(res.status).toBe(413);
  });

  it("needs the token, on /api/op and on each git route", async () => {
    const srv = await start(plainCompany());
    for (const path of ["/api/op", "/api/git/commit", "/api/git/push", "/api/git/pr"]) {
      const res = await raw(srv, "POST", path, { host: `127.0.0.1:${srv.port}`, "content-type": "application/json" }, { op: "checkin", expect: "x" });
      expect(res.status, path).toBe(403);
    }
    const pending = await raw(srv, "GET", "/api/pending", { host: `127.0.0.1:${srv.port}` });
    expect(pending.status).toBe(403);
  });
});

describe("cross-site checks on every POST", () => {
  const base = (srv: RunningServer) => ({ host: `127.0.0.1:${srv.port}`, "content-type": "application/json", "x-nikos-token": srv.token });
  const body = () => opBody("checkin", { kr: "kr-1" }, { value: 2 }, "0000000000000000");

  it("refuses another site's Origin, and accepts a missing one or this machine's own", async () => {
    const srv = await start(plainCompany());
    const evil = await raw(srv, "POST", "/api/op", { ...base(srv), origin: "http://evil.test" }, body());
    expect(evil.status).toBe(403);
    expect(evil.body.error).toBe("A page on another site can't change this plan");
    // The body's expect is stale on purpose, so an accepted request reaches the checks and comes back 409.
    expect((await raw(srv, "POST", "/api/op", base(srv), body())).status).toBe(409);
    expect((await raw(srv, "POST", "/api/op", { ...base(srv), origin: `http://localhost:${srv.port}` }, body())).status).toBe(409);
  });

  it("refuses Sec-Fetch-Site cross-site, and accepts same-origin and none", async () => {
    const srv = await start(plainCompany());
    expect((await raw(srv, "POST", "/api/op", { ...base(srv), "sec-fetch-site": "cross-site" }, body())).status).toBe(403);
    expect((await raw(srv, "POST", "/api/op", { ...base(srv), "sec-fetch-site": "same-origin" }, body())).status).toBe(409);
    expect((await raw(srv, "POST", "/api/op", { ...base(srv), "sec-fetch-site": "none" }, body())).status).toBe(409);
  });

  it("needs a JSON content type", async () => {
    const srv = await start(plainCompany());
    const text = await raw(srv, "POST", "/api/op", { ...base(srv), "content-type": "text/plain" }, body());
    expect(text.status).toBe(415);
    expect((await raw(srv, "POST", "/api/op", base(srv), body())).status).toBe(409);
  });

  it("refuses a Host that isn't this machine's own address", async () => {
    const srv = await start(plainCompany());
    const res = await raw(srv, "POST", "/api/op", { ...base(srv), host: "evil.test:" + srv.port }, body());
    expect(res.status).toBe(403);
  });
});

describe("pending and the page", () => {
  it("reports a folder that isn't a git repo, and creates no .git", async () => {
    const root = plainCompany();
    const srv = await start(root);
    const res = await raw(srv, "GET", "/api/pending", { host: `127.0.0.1:${srv.port}`, "x-nikos-token": srv.token });
    expect(res.body).toMatchObject({ git: false, files: [], unrelated: [] });
    expect(res.body.message).toBe("This folder is not a git repo: changes are saved to files only.");
    expect(existsSync(join(root, ".git"))).toBe(false);
  });

  it("the page drops the token from its address, and saves through /api/op", async () => {
    const srv = await start(plainCompany());
    const html = (await raw(srv, "GET", "/", { host: `127.0.0.1:${srv.port}` })).body as string;
    expect(html).toContain("history.replaceState");
    expect(html).toContain("/api/op");
    expect(html).toContain('id="pending"');
    expect(html).not.toContain("<form");
  });

  it("shows the planning levels' own navigation: OKRs and bets for a company", async () => {
    const srv = await start(plainCompany());
    const html = (await raw(srv, "GET", "/", { host: `127.0.0.1:${srv.port}` })).body as string;
    expect(html).toContain('data-nav="okrs" href="#/okrs">OKRs and bets');
    expect(html).toContain('data-nav="ladder" href="#/ladder">OKR ladder');
    expect(html).not.toContain("Rollout");
  });
});

describe("the snapshot of the same page", () => {
  it("is not in the live page: no save code leaves the export", async () => {
    const { exportSnapshot } = await import("../src/planning/server");
    const dir = mkdtempSync(join(tmpdir(), "nikos-export-"));
    const out = join(dir, "snap.html");
    exportSnapshot(plainCompany(), out);
    const html = readText(dir, "snap.html");
    expect(html).not.toContain("fetch(");
    expect(html).not.toContain("/api/op");
    expect(html).not.toContain("X-Nikos-Token");
    rmSync(dir, { recursive: true, force: true });
  });
});

