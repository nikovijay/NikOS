// The drill-downs with a story map: a planning repo whose code repo is listed and read on start (a real local
// git repo, no network). A key result's page shows the maps that deliver its bets, each with its read age, and
// a bet's page shows its own map and the chain above it.
import { request } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startPlanServe, type PlanServe } from "../src/plan/serve";
import { acmePlan } from "./plan-serve-fixture";
import { groupRepo } from "./repo-fixture";

let open: PlanServe[] = [];
afterEach(async () => {
  await Promise.all(open.map((p) => p.srv.close()));
  open = [];
  vi.useRealTimers();
});

/** The clock the read ages are measured against: the copy is read at this moment, and the page is read then. */
const NOW = new Date("2026-11-10T12:00:00Z");

function get(port: number, path: string): Promise<string> {
  return new Promise((ok, fail) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (text += c));
      res.on("end", () => ok(text));
    });
    req.on("error", fail);
    req.end();
  });
}

describe("a drill-down with a story map", () => {
  it("shows the map that delivers a key result's bet, with the copy's read age, and the bet's own page the same", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const code = groupRepo("PAY");
    const plan = await startPlanServe(acmePlan(code), { port: 0 });
    open.push(plan);
    expect(plan.notices).toEqual([]);
    const kr = await get(plan.srv.port, "/?at=departments/finance&kr=close-days");
    expect(kr).toContain("acme/payments-web");
    expect(kr).toContain("read today (2026-11-10)");
    const bet = await get(plan.srv.port, "/?at=groups/payments&bet=faster-checkout");
    expect(bet).toContain("<h3>Story maps that deliver it</h3>");
    expect(bet).toContain("acme/payments-web · chk");
    expect(bet).toContain("read today (2026-11-10)");
  });

  it("says a map was not read yet when the copy was never refreshed, and the page still works", async () => {
    const code = groupRepo("PAY");
    const plan = await startPlanServe(acmePlan(code), { port: 0, offline: true });
    open.push(plan);
    const bet = await get(plan.srv.port, "/?at=groups/payments&bet=faster-checkout");
    expect(bet).toContain("no story map yet");
    expect(bet).toContain("<h2>Up the chain</h2>");
  });
});
