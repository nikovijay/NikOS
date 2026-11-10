// The planning dashboard's page data: areaPage for the company, a department, a group and a team, with
// the delivery copies plan refresh keeps (a real local code repo, no network). A group's and team's key
// result columns are the ones their bets aim at: primary and also.
import { describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { areaPage, drillBet } from "../src/plan/dashboard";
import { planDeliveries } from "../src/plan/delivery";
import { refreshDelivery } from "../src/plan/refresh";
import { addArea, findArea, initPlanRepo } from "../src/plan/repo";
import { newBet } from "../src/planning/bets";
import { checkIn, newKr } from "../src/planning/krs";
import { groupRepo, write } from "./repo-fixture";
import { acmePlan } from "./plan-serve-fixture";

const NOW = new Date("2026-11-10T12:00:00Z");
const NOW_ISO = NOW.toISOString();
const kr = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `${id} title`, owner: "Mira", baseline: 11, target: 7, by: "", ...extra });
const bet = (id: string, extra: Record<string, unknown> = {}) => ({ id, owner: "Sam", hypothesis: "We believe it.", reviewOn: "2027-02-14", ...extra });

/**
 * Acme, with a code repo listed and read: the payments group's map names faster-checkout as a whole, so
 * that bet has a map of its own, and the bets above it are delivered through it.
 */
function acmeRead(): { repo: string; at: (ref: string) => string } {
  const code = groupRepo("PAY", mkdtempSync(join(tmpdir(), "nikos-adapter-code-")));
  const repo = mkdtempSync(join(tmpdir(), "nikos-adapter-plan-"));
  initPlanRepo(repo, { name: "Acme", year: "2027" });
  addArea(repo, "department", "finance", { name: "Finance", owner: "Mira" });
  addArea(repo, "group", "payments", { name: "Payments", department: "finance" });
  addArea(repo, "team", "WEB", { name: "Checkout web", home: "payments" });
  const at = (ref: string) => findArea(repo, ref).dir;
  newKr(kr("revenue", { baseline: 0, target: 60000 }), at("company"));
  newKr(kr("close-days", { period: "2027-Q1", alignsTo: ["revenue"] }), at("finance"));
  checkIn(at("finance"), "close-days", { value: 9, date: "2026-11-09" });
  newBet(bet("one-inbox", { primary: "revenue" }), at("company"));
  newBet(bet("inbox-match", { primary: "close-days", alignsTo: ["one-inbox"] }), at("finance"));
  newBet(bet("faster-checkout", { primary: "close-days", alignsTo: ["inbox-match"] }), at("payments"));
  newBet(bet("web-bet", { primary: "close-days", alignsTo: ["faster-checkout", "inbox-match"] }), at("WEB"));
  write(join(repo, "planning/repos.yaml"), `version: 1\nrepos:\n  - repo: acme/payments-web\n    host: github.com\n    url: "${code}"\n`);
  refreshDelivery(repo, { now: NOW });
  return { repo, at };
}

const page = (repo: string, rel: string, extra: { period?: string; notices?: string[] } = {}) => {
  const area = findArea(repo, rel);
  return areaPage(repo, area, { ...extra, deliveries: planDeliveries(repo, NOW), now: NOW });
};

describe("the company's page", () => {
  it("shows the company's own key results and bets, with nothing above and no quarter", () => {
    const { repo } = acmeRead();
    const p = page(repo, "company");
    expect(p.plan).toMatchObject({ rel: "company", level: "company", name: "Acme", period: "2027", reportsTo: null });
    expect(p.period).toBeUndefined();
    expect(p.today).toBe("2026-11-10");
    expect(p.breadcrumb.map((c) => c.label)).toEqual(["Company"]);
    expect(p.periods).toEqual(["2027-Q1"]);
    expect(p.krs.map((k) => k.id)).toEqual(["revenue"]);
    expect(p.aboveKrs).toEqual([]);
    expect(p.bets.map((b) => b.id)).toEqual(["one-inbox"]);
    expect(p.aboveBets).toEqual([]);
    expect(p.notices).toEqual([]);
  });
});

describe("a department's page", () => {
  it("shows its quarter, its key results with what they align to above, and its bets above", () => {
    const { repo } = acmeRead();
    const p = page(repo, "departments/finance");
    expect(p.period).toBe("2027-Q1");
    expect(p.notices).toEqual(["There are no key results for 2026-Q4 yet. Showing 2027-Q1, the latest quarter with key results."]);
    expect(p.krs).toEqual([
      expect.objectContaining({
        id: "close-days",
        rel: "departments/finance",
        period: "2027-Q1",
        progress: (9 - 11) / (7 - 11),
        latest: { value: 9, date: "2026-11-09" },
        stale: false,
        aligns_to: ["revenue"],
        above: [expect.objectContaining({ id: "revenue", rel: "company", owner: "Mira" })],
      }),
    ]);
    expect(p.aboveKrs.map((k) => k.id)).toEqual(["revenue"]);
    expect(p.bets).toEqual([
      expect.objectContaining({ id: "inbox-match", rel: "departments/finance", krs: { primary: "close-days", also: [] }, aligns_to: [expect.objectContaining({ id: "one-inbox", rel: "company" })] }),
    ]);
    expect(p.aboveBets.map((b) => b.id)).toEqual(["one-inbox"]);
    // inbox-match has no map of its own: its figures come from the bet below it, faster-checkout.
    expect(p.bets[0].delivery).toMatchObject({ source: "via", via: [expect.objectContaining({ bet: "faster-checkout" })] });
    expect(p.breadcrumb.map((c) => c.label)).toEqual(["Company", "Finance"]);
    expect(p.plan.reportsTo).toBe("company");
  });

  it("shows a requested quarter that has no key results as the latest one that does, with a notice", () => {
    const { repo } = acmeRead();
    const p = page(repo, "departments/finance", { period: "2027-Q3" });
    expect(p.period).toBe("2027-Q1");
    expect(p.notices).toEqual(["There are no key results for 2027-Q3 yet. Showing 2027-Q1, the latest quarter with key results."]);
  });
});

describe("a group's and a team's pages", () => {
  it("gives a group the key results its bets aim at, with its own bet's delivery from the copy", () => {
    const { repo } = acmeRead();
    const p = page(repo, "groups/payments");
    expect(p.krs.map((k) => [k.id, k.rel])).toEqual([["close-days", "departments/finance"]]);
    expect(p.bets.map((b) => b.id)).toEqual(["faster-checkout"]);
    const d = p.bets[0].delivery;
    expect(d).toMatchObject({ source: "own", delivery: { status: "Not started", total: 3, maps: [{ host: "github.com", repo: "acme/payments-web", key: "chk" }] } });
    expect(p.repos).toEqual([expect.objectContaining({ repo: "acme/payments-web", state: "ok", age: "read today (2026-11-10)" })]);
    // Every story of the map counts for the bet its map names, as the delivery tests show.
    expect(p.bets[0].stories).toEqual(expect.arrayContaining([expect.objectContaining({ id: "PAY-CHK-1", map: expect.objectContaining({ key: "chk" }) })]));
    expect(p.breadcrumb.map((c) => c.label)).toEqual(["Company", "Finance", "Payments"]);
  });

  it("gives a team the key results its bets aim at, and the company's above them", () => {
    const { repo } = acmeRead();
    const p = page(repo, "teams/WEB");
    expect(p.krs.map((k) => k.id)).toEqual(["close-days"]);
    expect(p.aboveKrs.map((k) => k.id)).toEqual(["revenue"]);
    expect(p.bets[0]).toMatchObject({ id: "web-bet", team: "", krs: { primary: "close-days", also: [] } });
    expect(p.bets[0].aligns_to.map((b) => b.id).sort()).toEqual(["faster-checkout", "inbox-match"]);
    expect(p.aboveBets.map((b) => b.id).sort()).toEqual(["faster-checkout", "inbox-match"]);
    expect(p.breadcrumb.map((c) => c.label)).toEqual(["Company", "Finance", "Payments", "WEB"]);
  });

  it("gives a bet's drill-down its map with the read age, and the bets below it", () => {
    const { repo } = acmeRead();
    const drill = drillBet(repo, "faster-checkout", planDeliveries(repo, NOW));
    expect(drill?.maps).toEqual([expect.objectContaining({ host: "github.com", repo: "acme/payments-web", key: "chk", age: "read today (2026-11-10)" })]);
    expect(drill?.children.map((c) => c.id)).toEqual(["web-bet"]);
  });
});

describe("a page with a file that won't load", () => {
  it("lists the problem and still shows the rest of the area", () => {
    const { repo, at } = acmeRead();
    write(join(at("payments"), "bets/broken.md"), "no details block here\n");
    const p = page(repo, "groups/payments");
    expect(p.problems.join("\n")).toContain("broken.md is missing its details block");
    expect(p.bets.map((b) => b.id)).toEqual(["faster-checkout"]);
  });
});

describe("a page that names what won't load", () => {
  it("leaves out only the key result above that won't load: the area's own still shows, and the problem is named", () => {
    const repo = acmePlan();
    // close-days aligns to revenue, and revenue's file is broken.
    appendFileSync(join(findArea(repo, "departments/finance").dir, "krs", "close-days.yaml"), "aligns_to:\n  - revenue\n");
    write(join(findArea(repo, "company").dir, "krs", "revenue.yaml"), "title: [unclosed\n");
    const p = page(repo, "departments/finance");
    expect(p.krs.map((k) => k.id)).toEqual(["close-days"]);
    expect(p.aboveKrs).toEqual([]);
    expect(p.problems.length).toBeGreaterThan(0);
  });
});

describe("the bets below a group, when it widens down", () => {
  it("lists only the bets below it: not the bets above it, nor its own", () => {
    const repo = acmePlan();
    const p = areaPage(repo, findArea(repo, "groups/payments"), { deliveries: planDeliveries(repo, NOW), now: NOW, widen: { up: false, down: true } });
    expect(p.belowBets.map((b) => [b.id, b.how])).toEqual([["web-bet", "child"]]);
    expect(p.belowBets.map((b) => b.id)).not.toContain("one-inbox");
    expect(p.belowBets.map((b) => b.id)).not.toContain("inbox-match");
  });
});
