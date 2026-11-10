// nikos plan serve, the server: the pages for each area on port 0, ?at= on the page and the data, the
// refusals (another host, any save) and the unknown area. Every server a test starts is closed after it.
import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { startPlanServe, type PlanServe } from "../src/plan/serve";
import { acmePlan } from "./plan-serve-fixture";

let open: PlanServe[] = [];
afterEach(async () => {
  await Promise.all(open.map((p) => p.srv.close()));
  open = [];
});

async function start(repo: string, opts: { at?: string; port?: number } = {}): Promise<PlanServe> {
  const plan = await startPlanServe(repo, { port: 0, offline: true, ...opts });
  open.push(plan);
  return plan;
}

/** A request with the headers given as they are sent: fetch would not let a test set Host. */
function get(port: number, path: string, opts: { headers?: Record<string, string>; method?: string; body?: string } = {}): Promise<{ status: number; text: string }> {
  return new Promise((ok, fail) => {
    const req = request({ host: "127.0.0.1", port, path, method: opts.method ?? "GET", headers: opts.headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (text += c));
      res.on("end", () => ok({ status: res.statusCode ?? 0, text }));
    });
    req.on("error", fail);
    req.end(opts.body);
  });
}

describe("the plan dashboard's pages", () => {
  it("shows the company at / with its key results and bets, and no form", async () => {
    const { srv } = await start(acmePlan());
    const r = await get(srv.port, "/");
    expect(r.status).toBe(200);
    expect(r.text).toContain("Acme");
    expect(r.text).toContain("Revenue");
    expect(r.text).toContain("one-inbox");
    expect(r.text).not.toContain("<form");
  });

  it("shows the area ?at= names, with its quarter, its check-ins and where it sits", async () => {
    const { srv } = await start(acmePlan());
    const r = await get(srv.port, "/?at=departments/finance");
    expect(r.text).toContain("Finance");
    expect(r.text).toContain("Close days");
    expect(r.text).toContain("2027-Q1");
    expect(r.text).toContain("last 9 on 2026-11-09");
    expect(r.text).toContain('href="?at=company"');
  });

  it("shows a group's key results as the ones its bets aim at", async () => {
    const { srv } = await start(acmePlan());
    const r = await get(srv.port, "/?at=groups/payments");
    expect(r.text).toContain("Key results its bets aim at");
    expect(r.text).toContain("Close days");
    expect(r.text).toContain("faster-checkout");
  });

  it("names an unknown area in a notice and shows the company", async () => {
    const { srv } = await start(acmePlan());
    const r = await get(srv.port, "/?at=bogus");
    expect(r.text).toContain("no area called");
    expect(r.text).toContain("Showing the company instead");
    expect(r.text).toContain("Acme");
  });

  it("gives the same area as JSON from /api/data?at=", async () => {
    const { srv } = await start(acmePlan());
    const data = JSON.parse((await get(srv.port, "/api/data?at=departments/finance")).text);
    expect(data.plan).toMatchObject({ rel: "departments/finance", level: "department" });
    expect(data.period).toBe("2027-Q1");
    expect(data.krs.map((k: { id: string }) => k.id)).toEqual(["close-days"]);
    expect(data.breadcrumb.map((c: { label: string }) => c.label)).toEqual(["Company", "Finance"]);
  });

  it("starts on the area --at names, in the link it prints", async () => {
    const plan = await start(acmePlan(), { at: "finance" });
    expect(plan.url).toContain(`at=${encodeURIComponent("departments/finance")}&token=`);
    expect(plan.url.startsWith(`http://127.0.0.1:${plan.srv.port}/`)).toBe(true);
  });

  it("refuses an unknown --at before it starts", async () => {
    const repo = acmePlan();
    await expect(startPlanServe(repo, { port: 0, offline: true, at: "nowhere" })).rejects.toThrow("There's no area called 'nowhere'");
  });
});

describe("what the plan dashboard refuses", () => {
  it("answers only on its own address", async () => {
    const { srv } = await start(acmePlan());
    const r = await get(srv.port, "/", { headers: { host: "evil.example" } });
    expect(r.status).toBe(403);
    expect(r.text).toContain("only answers on its own address");
  });

  it("takes no save: a POST gets a refusal and changes nothing", async () => {
    const { srv } = await start(acmePlan());
    const r = await get(srv.port, "/api/op", {
      method: "POST",
      headers: { "content-type": "application/json", "x-nikos-token": "wrong" },
      body: JSON.stringify({ op: "checkin", target: { kr: "close-days" }, args: { value: 8 }, expect: "x" }),
    });
    expect(r.status).toBe(501);
    expect(r.text).toContain("Saving from the plan dashboard isn't on yet");
  });

  it("has none of the planning dashboard's other pages", async () => {
    const { srv } = await start(acmePlan());
    expect((await get(srv.port, "/map")).status).toBe(404);
    expect((await get(srv.port, "/nikos-view.js")).status).toBe(404);
  });
});
