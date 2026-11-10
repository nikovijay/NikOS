// nikos plan serve's saves: an edit goes in the area's own folder, on a nikos branch named for the area, and
// the git buttons commit only the areas saved to. Real git repos with a bare origin. A dry run against an area
// folder sees the files of the whole planning/ folder.
import { request } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hash } from "../src/planning/model";
import { runOps } from "../src/planning/ops";
import { realRun, type Runner } from "../src/lib/git";
import { startPlanServe, type PlanServe } from "../src/plan/serve";
import { findArea } from "../src/plan/repo";
import { acmePlan } from "./plan-serve-fixture";
import { bareOrigin, commitAll, git } from "./planning-fixture";

let open: PlanServe[] = [];
afterEach(async () => {
  await Promise.all(open.map((p) => p.srv.close()));
  open = [];
});

const today = () => new Date().toISOString().slice(0, 10);

/** The company's plan in a git repo, its base branch main, pushed to a bare origin. */
function gitPlan(): string {
  const repo = acmePlan();
  git(repo, "init", "-q", "-b", "main");
  git(repo, "remote", "add", "origin", bareOrigin());
  commitAll(repo, "the company's plan");
  git(repo, "push", "-q", "-u", "origin", "main");
  return repo;
}

async function start(repo: string, run?: Runner): Promise<PlanServe> {
  const plan = await startPlanServe(repo, { port: 0, offline: true, run });
  open.push(plan);
  return plan;
}

function post(plan: PlanServe, path: string, body: unknown): Promise<{ status: number; body: any }> {
  const payload = JSON.stringify(body);
  return new Promise((ok, fail) => {
    const req = request(
      { host: "127.0.0.1", port: plan.srv.port, path, method: "POST", headers: { host: `127.0.0.1:${plan.srv.port}`, "content-type": "application/json", "x-nikos-token": plan.srv.token, "content-length": Buffer.byteLength(payload) } },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (text += c));
        res.on("end", () => ok({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : {} }));
      },
    );
    req.on("error", fail);
    req.end(payload);
  });
}

/** The version of a file a save must carry: its hash, as the page loads it. */
const versionOf = (repo: string, rel: string) => hash(readFileSync(join(repo, rel), "utf8"));

/** A runner that passes git through and records every call. */
function recorder(): { calls: string[][]; run: Runner } {
  const calls: string[][] = [];
  return { calls, run: (cmd, args, cwd) => (calls.push([cmd, ...args]), realRun(cmd, args, cwd)) };
}

const CLOSE = "planning/departments/finance/krs/close-days.yaml";

describe("a save from the plan dashboard", () => {
  it("the check-in form carries the version the page read, so what the browser sends is accepted", async () => {
    const repo = gitPlan();
    const plan = await start(repo);
    const html = await fetch(`http://127.0.0.1:${plan.srv.port}/?at=departments/finance`).then((r) => r.text());
    const form = html.match(/<form class="save" data-op="checkin"[^>]*>/)?.[0] ?? "";
    const attr = (name: string) => (form.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? "").replace(/&quot;/g, '"');
    expect(attr("data-expect")).toBe(versionOf(repo, CLOSE));
    const r = await post(plan, "/api/op", { op: attr("data-op"), area: attr("data-area"), target: JSON.parse(attr("data-target")), args: { value: 8 }, expect: attr("data-expect") });
    expect(r.status).toBe(200);
    expect(readFileSync(join(repo, CLOSE), "utf8")).toContain("value: 8");
  });

  it("writes the area's own file, on a nikos branch named for the area", async () => {
    const repo = gitPlan();
    const plan = await start(repo);
    const r = await post(plan, "/api/op", { op: "checkin", target: { kr: "close-days" }, args: { value: 8, date: today() }, expect: versionOf(repo, CLOSE) });
    expect(r.status).toBe(200);
    expect(r.body.area).toBe("departments/finance");
    expect(r.body.branch).toBe(`nikos/plan-departments-finance-${today()}`);
    expect(r.body.changed).toEqual([CLOSE]);
    expect(git(repo, "branch", "--show-current")).toBe(`nikos/plan-departments-finance-${today()}`);
    expect(readFileSync(join(repo, CLOSE), "utf8")).toContain("value: 8");
  });

  it("refuses a stale version with a 409, and changes nothing", async () => {
    const repo = gitPlan();
    const plan = await start(repo);
    const r = await post(plan, "/api/op", { op: "checkin", target: { kr: "close-days" }, args: { value: 8, date: today() }, expect: "0000000000000000" });
    expect(r.status).toBe(409);
    expect(git(repo, "status", "--porcelain")).toBe("");
  });

  it("a group's bet takes key results above it, and names the group's branch", async () => {
    const repo = gitPlan();
    const plan = await start(repo);
    const bet = "planning/groups/payments/bets/faster-checkout.md";
    const r = await post(plan, "/api/op", { op: "bet.krs", target: { bet: "faster-checkout" }, args: { primary: "close-days", also: ["revenue"] }, expect: versionOf(repo, bet) });
    expect(r.status).toBe(200);
    expect(r.body.branch).toBe(`nikos/plan-groups-payments-${today()}`);
    expect(readFileSync(join(repo, bet), "utf8")).toContain("revenue");
  });

  it("a team's bet may aim at a company key result too", async () => {
    const repo = gitPlan();
    const plan = await start(repo);
    const bet = "planning/teams/WEB/bets/web-bet.md";
    const r = await post(plan, "/api/op", { op: "bet.krs", target: { bet: "web-bet" }, args: { primary: "revenue", also: [] }, expect: versionOf(repo, bet) });
    expect(r.status).toBe(200);
    expect(r.body.branch).toBe(`nikos/plan-teams-WEB-${today()}`);
  });

  it("refuses a key result that isn't in the company's plan", async () => {
    const repo = gitPlan();
    const plan = await start(repo);
    const bet = "planning/groups/payments/bets/faster-checkout.md";
    const r = await post(plan, "/api/op", { op: "bet.krs", target: { bet: "faster-checkout" }, args: { primary: "no-such-kr", also: [] }, expect: versionOf(repo, bet) });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("There's no key result called 'no-such-kr'");
  });

  it("a team makes a bet in its own folder, and a team's key result is refused", async () => {
    const repo = gitPlan();
    const plan = await start(repo);
    const made = await post(plan, "/api/op", {
      op: "bet.new",
      area: "teams/WEB",
      target: { bet: "web-copy" },
      args: { owner: "Ana", hypothesis: "Copy that converts.", review_on: "2027-03-14", primary: "close-days", aligns_to: ["faster-checkout"] },
      expect: "",
    });
    expect(made.status).toBe(200);
    expect(made.body.area).toBe("teams/WEB");
    expect(made.body.changed).toEqual(["planning/teams/WEB/bets/web-copy.md"]);
    const kr = await post(plan, "/api/op", { op: "kr.new", area: "teams/WEB", target: { kr: "web-kr" }, args: { title: "x", owner: "Ana", baseline: 0, target: 1, by: "2027-03-31" }, expect: "" });
    expect(kr.status).toBe(400);
    expect(kr.body.error).toContain("Key results stop at department level");
  });

  it("names the area a new bet goes in, and refuses an area that isn't one", async () => {
    const repo = gitPlan();
    const plan = await start(repo);
    const none = await post(plan, "/api/op", { op: "bet.new", target: { bet: "lost-bet" }, args: { owner: "Ana", hypothesis: "h", review_on: "2027-03-14" }, expect: "" });
    expect(none.status).toBe(400);
    expect(none.body.error).toContain("Say which area the bet goes in");
    const nowhere = await post(plan, "/api/op", { op: "bet.new", area: "teams/NOPE", target: { bet: "lost-bet" }, args: { owner: "Ana", hypothesis: "h", review_on: "2027-03-14" }, expect: "" });
    expect(nowhere.status).toBe(400);
    expect(nowhere.body.error).toContain("There's no area called 'teams/NOPE'");
  });

  it("refuses a story map change: maps stay in the code repos", async () => {
    const repo = gitPlan();
    const plan = await start(repo);
    const r = await post(plan, "/api/op", { op: "story.new", area: "groups/payments", args: { title: "x", activity: "a" }, expect: "" });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("story.new isn't a change a planning area makes");
  });

  it("never pushes on a save: only the Push button does", async () => {
    const repo = gitPlan();
    const rec = recorder();
    const plan = await start(repo, rec.run);
    const r = await post(plan, "/api/op", { op: "checkin", target: { kr: "close-days" }, args: { value: 8, date: today() }, expect: versionOf(repo, CLOSE) });
    expect(r.status).toBe(200);
    expect(rec.calls.some((c) => c.includes("push"))).toBe(false);
    await post(plan, "/api/git/commit", {});
    expect(rec.calls.some((c) => c.includes("push"))).toBe(false);
    const pushed = await post(plan, "/api/git/push", {});
    expect(pushed.status).toBe(200);
    expect(rec.calls.some((c) => c.includes("push"))).toBe(true);
  });

  it("a commit takes only the areas saved to: another area's edit stays unstaged", async () => {
    const repo = gitPlan();
    const plan = await start(repo);
    const other = "planning/teams/WEB/team.yaml";
    const { appendFileSync } = await import("node:fs");
    appendFileSync(join(repo, other), "# a hand edit\n");
    const r = await post(plan, "/api/op", { op: "checkin", target: { kr: "close-days" }, args: { value: 8, date: today() }, expect: versionOf(repo, CLOSE) });
    expect(r.status).toBe(200);
    const pending = await fetch(`http://127.0.0.1:${plan.srv.port}/api/pending`, { headers: { "x-nikos-token": plan.srv.token } }).then((x) => x.json());
    expect(pending.paths).toEqual([CLOSE]);
    const committed = await post(plan, "/api/git/commit", {});
    expect(committed.status).toBe(200);
    expect(git(repo, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean)).toEqual([CLOSE]);
    expect(git(repo, "status", "--porcelain")).toBe(`M ${other}`);
  });

  it("a dry run against an area's folder sees the files, and a stale one is skipped", () => {
    const repo = acmePlan();
    const area = findArea(repo, "departments/finance").dir;
    const expect1 = versionOf(repo, CLOSE);
    const res = runOps(area, [{ op: "checkin", target: { kr: "close-days" }, args: { value: 8, date: today() }, expect: expect1 }]);
    expect(res.results[0]).toMatchObject({ ok: true });
    expect([...res.changes.keys()].map((p) => p.split("/").slice(-5).join("/"))).toEqual(["planning/departments/finance/krs/close-days.yaml"]);
    const stale = runOps(area, [{ op: "checkin", target: { kr: "close-days" }, args: { value: 8, date: today() }, expect: "0000000000000000" }]);
    expect(stale.results[0]).toMatchObject({ ok: false, skipped: expect.any(String) });
  });
});

describe("a restart of the plan dashboard", () => {
  it("keeps the saves not yet committed: the pending bar lists them, and a commit takes them", async () => {
    const repo = gitPlan();
    const first = await start(repo);
    const made = await post(first, "/api/op", { op: "checkin", target: { kr: "close-days" }, args: { value: 8, date: today() }, expect: versionOf(repo, CLOSE) });
    expect(made.status).toBe(200);
    await first.srv.close();
    open = open.filter((p) => p !== first);
    const second = await start(repo);
    const pending = await fetch(`http://127.0.0.1:${second.srv.port}/api/pending`, { headers: { "x-nikos-token": second.srv.token } }).then((x) => x.json());
    expect(pending.paths).toEqual([CLOSE]);
    const committed = await post(second, "/api/git/commit", {});
    expect(committed.status).toBe(200);
    expect(git(repo, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean)).toEqual([CLOSE]);
  });
});
