// The adapter's widening: the levels above a key result or bet, through aligns_to, and the bets below an
// area's bets and key results. Built on a real planning repo with a key result chain: close-days aligns to
// revenue, so the company's key result sits above the department's.
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { areaPage } from "../src/plan/dashboard";
import { planDeliveries } from "../src/plan/delivery";
import { addArea, findArea, initPlanRepo } from "../src/plan/repo";
import { newBet } from "../src/planning/bets";
import { newKr } from "../src/planning/krs";

const NOW = new Date("2026-11-10T12:00:00Z");
const kr = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `${id} title`, owner: "Mira", baseline: 11, target: 7, by: "", ...extra });
const bet = (id: string, extra: Record<string, unknown> = {}) => ({ id, owner: "Sam", hypothesis: "We believe it.", reviewOn: "2027-02-14", ...extra });

/** Acme with a chain of key results (close-days aligns to revenue, and revenue to nothing) and bets down three levels. */
function chain(): string {
  const repo = mkdtempSync(join(tmpdir(), "nikos-widen-plan-"));
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
  newBet(bet("web-bet", { primary: "close-days", alignsTo: ["faster-checkout"] }), at("WEB"));
  return repo;
}

const page = (repo: string, rel: string, widen?: { up: boolean; down: boolean }) => {
  const area = findArea(repo, rel);
  return areaPage(repo, area, { deliveries: planDeliveries(repo, NOW), now: NOW, widen });
};

describe("widening up", () => {
  it("shows one key result above a department's, and every one above it when widened", () => {
    const repo = chain();
    const near = page(repo, "departments/finance");
    expect(near.aboveKrs.map((k) => k.id)).toEqual(["revenue"]);
    expect(near.widen).toEqual({ up: false, down: false });
    const far = page(repo, "departments/finance", { up: true, down: false });
    expect(far.aboveKrs.map((k) => k.id)).toEqual(["revenue"]);
    expect(far.widen).toEqual({ up: true, down: false });
  });

  it("shows the bets above a team's bets: one level by default, all the levels when widened", () => {
    const repo = chain();
    const near = page(repo, "teams/WEB");
    expect(near.aboveBets.map((b) => b.id)).toEqual(["faster-checkout"]);
    const far = page(repo, "teams/WEB", { up: true, down: false });
    expect(far.aboveBets.map((b) => b.id)).toEqual(["faster-checkout", "inbox-match", "one-inbox"]);
  });

});

describe("widening down", () => {
  it("lists every bet below the company's bets, through aligns_to, each once", () => {
    const repo = chain();
    const p = page(repo, "company", { up: false, down: true });
    expect(p.belowBets.map((b) => [b.id, b.how, b.of])).toEqual([
      ["inbox-match", "child", "one-inbox"],
      ["faster-checkout", "child", "one-inbox"],
      ["web-bet", "child", "one-inbox"],
    ]);
    expect(p.belowBets.every((b) => b.rel && b.outcome !== undefined)).toBe(true);
  });

  it("lists the bets below a department's bets, each once, under the bet they deliver through", () => {
    const repo = chain();
    const p = page(repo, "departments/finance", { up: false, down: true });
    expect(p.belowBets.map((b) => [b.id, b.how, b.of])).toEqual([
      ["faster-checkout", "child", "inbox-match"],
      ["web-bet", "child", "inbox-match"],
    ]);
  });

  it("is empty when the area did not widen down", () => {
    const repo = chain();
    expect(page(repo, "company").belowBets).toEqual([]);
  });
});
