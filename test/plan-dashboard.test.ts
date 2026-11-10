// The planning dashboard's data, pure parts: the area tree, which area a ?at= names, the breadcrumb, the
// quarter a page shows, a key result's and a bet's drill-down, and the chain of bets above a bet. The
// fixture is one three-level chain of bets (one-inbox, inbox-match, faster-checkout) and a team bet that
// aligns to two of them. Real planning files, no delivery copies.
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { areaTree, aboveKr, breadcrumbOf, drillBet, drillKr, pickPeriod, periodsOf, resolveAt, upChain } from "../src/plan/dashboard";
import { planDeliveries } from "../src/plan/delivery";
import { addArea, findArea, initPlanRepo } from "../src/plan/repo";
import { newBet } from "../src/planning/bets";
import { newKr } from "../src/planning/krs";

const kr = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `${id} title`, owner: "Mira", baseline: 11, target: 7, by: "", ...extra });
const bet = (id: string, extra: Record<string, unknown> = {}) => ({ id, owner: "Sam", hypothesis: "We believe it.", reviewOn: "2027-02-14", ...extra });
const NOW = new Date("2026-11-10T12:00:00Z");

/** Acme: the company, finance, payments in finance, team WEB reporting to payments, and the chain of bets. */
function acme(): string {
  const repo = mkdtempSync(join(tmpdir(), "nikos-dashboard-"));
  initPlanRepo(repo, { name: "Acme", year: "2027" });
  addArea(repo, "department", "finance", { name: "Finance", owner: "Mira" });
  addArea(repo, "group", "payments", { name: "Payments", department: "finance" });
  addArea(repo, "team", "WEB", { name: "Checkout web", home: "payments" });
  const at = (ref: string) => findArea(repo, ref).dir;
  newKr(kr("revenue", { baseline: 0, target: 60000 }), at("company"));
  newKr(kr("close-days", { period: "2027-Q1", alignsTo: ["revenue"] }), at("finance"));
  newBet(bet("one-inbox", { primary: "revenue" }), at("company"));
  newBet(bet("inbox-match", { primary: "close-days", alignsTo: ["one-inbox"] }), at("finance"));
  newBet(bet("faster-checkout", { primary: "close-days", alignsTo: ["inbox-match"] }), at("payments"));
  newBet(bet("web-bet", { primary: "revenue", also: ["close-days"], alignsTo: ["faster-checkout", "inbox-match"] }), at("WEB"));
  return repo;
}

describe("the area tree", () => {
  it("lists every area company first, with its name, parent, children and path", () => {
    const tree = areaTree(acme());
    expect(tree.map((n) => n.rel)).toEqual(["company", "departments/finance", "groups/payments", "teams/WEB"]);
    expect(tree[0]).toMatchObject({ level: "company", name: "Acme", parent: null, children: ["departments/finance"], path: ["company"] });
    expect(tree[1]).toMatchObject({ level: "department", id: "finance", name: "Finance", parent: "company", children: ["groups/payments"] });
    expect(tree[2]).toMatchObject({ level: "group", name: "Payments", parent: "departments/finance", children: ["teams/WEB"] });
    expect(tree[3]).toMatchObject({ level: "team", id: "WEB", name: "Checkout web", parent: "groups/payments", children: [], path: ["company", "departments/finance", "groups/payments", "teams/WEB"] });
  });
});

describe("which area a page shows", () => {
  it("takes the company when there is no ?at=, the area it names, or the bare id", () => {
    const repo = acme();
    expect(resolveAt(repo).area.rel).toBe("company");
    expect(resolveAt(repo, "departments/finance")).toEqual({ area: expect.objectContaining({ rel: "departments/finance" }) });
    expect(resolveAt(repo, "web").area.rel).toBe("teams/WEB");
    expect(resolveAt(repo, "company").area.rel).toBe("company");
  });

  it("falls back to the company, with a notice, when ?at= names no area", () => {
    const out = resolveAt(acme(), "bogus");
    expect(out.area.rel).toBe("company");
    expect(out.notice).toBe("There's no area called 'bogus'. Showing the company instead.");
  });

  it("builds the breadcrumb from the company down, each part linking to its area", () => {
    const tree = areaTree(acme());
    expect(breadcrumbOf(tree, "teams/WEB")).toEqual([
      { label: "Company", rel: "company", href: "?at=company" },
      { label: "Finance", rel: "departments/finance", href: "?at=departments/finance" },
      { label: "Payments", rel: "groups/payments", href: "?at=groups/payments" },
      { label: "WEB", rel: "teams/WEB", href: "?at=teams/WEB" },
    ]);
    expect(breadcrumbOf(tree, "company")).toEqual([{ label: "Company", rel: "company", href: "?at=company" }]);
    expect(breadcrumbOf(tree, "departments/nowhere")).toEqual([]);
  });
});

describe("the quarter a page shows", () => {
  it("lists the quarters that have department key results", () => {
    expect(periodsOf(acme())).toEqual(["2027-Q1"]);
  });

  it("shows the current quarter when it has key results, and says nothing", () => {
    expect(pickPeriod(["2026-Q4", "2027-Q1"], undefined, "2026-11-10")).toEqual({ period: "2026-Q4" });
  });

  it("shows the latest quarter with key results when the current one has none, and says so", () => {
    expect(pickPeriod(["2027-Q1"], undefined, "2026-11-10")).toEqual({
      period: "2027-Q1",
      notice: "There are no key results for 2026-Q4 yet. Showing 2027-Q1, the latest quarter with key results.",
    });
  });

  it("shows a requested quarter that has key results, and falls back with a notice when it has none", () => {
    expect(pickPeriod(["2027-Q1", "2027-Q2"], "2027-Q2", "2026-11-10")).toEqual({ period: "2027-Q2" });
    expect(pickPeriod(["2027-Q1"], "2027-Q3", "2026-11-10")).toEqual({
      period: "2027-Q1",
      notice: "There are no key results for 2027-Q3 yet. Showing 2027-Q1, the latest quarter with key results.",
    });
  });

  it("has no quarter when no department has any key results", () => {
    expect(pickPeriod([], undefined, "2026-11-10")).toEqual({});
    expect(pickPeriod([], "2027-Q1", "2026-11-10")).toEqual({ notice: "There are no key results for 2027-Q1 yet." });
  });
});

describe("a key result held above", () => {
  it("is found by its bare id wherever it's held, and is undefined for a missing id or another repo's", () => {
    const repo = acme();
    expect(aboveKr(repo, "revenue", "2026-11-10")).toMatchObject({ id: "revenue", rel: "company", title: "revenue title", owner: "Mira", progress: 0, stale: true });
    expect(aboveKr(repo, "close-days", "2026-11-10")).toMatchObject({ rel: "departments/finance", period: "2027-Q1" });
    expect(aboveKr(repo, "nope", "2026-11-10")).toBeUndefined();
    expect(aboveKr(repo, "acme/plan#revenue", "2026-11-10")).toBeUndefined();
  });
});

describe("the chain of bets above a bet", () => {
  it("walks aligns_to level by level, and gives the key results the bet itself aims at", () => {
    const repo = acme();
    const chain = upChain(repo, "faster-checkout");
    expect(chain?.levels.map((l) => [l.depth, l.bets.map((b) => `${b.id}@${b.rel}`)])).toEqual([
      [1, ["inbox-match@departments/finance"]],
      [2, ["one-inbox@company"]],
    ]);
    expect(chain?.krs).toEqual({ primary: "close-days", also: [] });
    expect(upChain(repo, "one-inbox")?.levels).toEqual([]);
    expect(upChain(repo, "no-such-bet")).toBeUndefined();
  });

  it("reaches each bet above once when two bets lead to it, and says what the bet aims at", () => {
    const repo = acme();
    const chain = upChain(repo, "web-bet");
    expect(chain?.levels.map((l) => l.depth)).toEqual([1, 2]);
    expect(chain?.levels[0].bets.map((b) => b.id).sort()).toEqual(["faster-checkout", "inbox-match"]);
    expect(chain?.levels[1].bets.map((b) => b.id)).toEqual(["one-inbox"]);
    expect(chain?.krs).toEqual({ primary: "revenue", also: ["close-days"] });
  });
});

describe("drilling down from a key result and a bet", () => {
  it("lists the bets that aim at a department key result, and the bets below them by area", () => {
    const repo = acme();
    const drill = drillKr(repo, "close-days", planDeliveries(repo, NOW), NOW);
    expect(drill?.kr).toMatchObject({ id: "close-days", rel: "departments/finance" });
    expect(drill?.areas.map((a) => [a.rel, a.bets.map((b) => [b.id, b.aims])])).toEqual([
      ["departments/finance", [["inbox-match", "primary"]]],
      ["groups/payments", [["faster-checkout", "primary"]]],
      ["teams/WEB", [["web-bet", "also"]]],
    ]);
  });

  it("walks the bets below a company key result through their aligns_to, as via", () => {
    const repo = acme();
    const drill = drillKr(repo, "revenue", planDeliveries(repo, NOW), NOW);
    expect(drill?.areas.map((a) => [a.rel, a.bets.map((b) => [b.id, b.aims])])).toEqual([
      ["company", [["one-inbox", "primary"]]],
      ["departments/finance", [["inbox-match", "via"]]],
      ["groups/payments", [["faster-checkout", "via"]]],
      ["teams/WEB", [["web-bet", "primary"]]],
    ]);
    expect(drillKr(repo, "nope", planDeliveries(repo, NOW), NOW)).toBeUndefined();
  });

  it("lists every bet below a bet once, nearest first, each with its area and level", () => {
    const repo = acme();
    const drill = drillBet(repo, "one-inbox", planDeliveries(repo, NOW));
    expect(drill?.children.map((c) => [c.id, c.rel, c.level])).toEqual([
      ["inbox-match", "departments/finance", "department"],
      ["faster-checkout", "groups/payments", "group"],
      ["web-bet", "teams/WEB", "team"],
    ]);
    expect(drill?.maps).toEqual([]);
    expect(drillBet(repo, "no-such-bet", planDeliveries(repo, NOW))).toBeUndefined();
  });

  it("gives a bet's own maps and the bets below nothing when no copy has been read", () => {
    const repo = acme();
    expect(drillBet(repo, "web-bet", planDeliveries(repo, NOW))).toMatchObject({ bet: { id: "web-bet", rel: "teams/WEB" }, children: [], maps: [] });
  });
});
