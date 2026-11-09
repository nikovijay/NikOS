import { describe, it, expect, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { companyInit, runCompany, runGroup } from "../src/commands/start";
import { newKr } from "../src/planning/krs";
import { newBet } from "../src/planning/bets";
import { checkBet, checkKr, loadBet, loadKr } from "../src/planning/model";
import { planningIssues } from "../src/planning/levels";
import { runPlanning } from "../src/planning/cli";
import { alignment, formatTree, type DownstreamPlan } from "../src/planning/rollout";

const kr = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, owner: "Board", baseline: 1, target: 2, by: "2027-03-31", ...extra });
const bet = (id: string, extra: Record<string, unknown> = {}) => ({ id, owner: "Board", hypothesis: "We believe it.", reviewOn: "2027-02-14", ...extra });

/** A plan repo at a level, with a synced copy of the plan above it (no git needed). */
function plan(level: "company" | "department" | "group", above?: { repo: string; level: string; krs?: string[]; bets?: string[] }) {
  const root = mkdtempSync(join(tmpdir(), `nikos-${level}-`));
  companyInit(root, { name: level, level, period: "Q1 2027" });
  if (above) {
    writeFileSync(join(root, "planning/upstream.yaml"), `- repo: ${above.repo}\n`);
    const copy = join(root, ".nikos/upstream", ...above.repo.split("/"));
    companyInit(copy, { name: "above", level: above.level as any, period: "Q1 2027" });
    for (const id of above.krs ?? []) newKr(kr(id), copy);
    for (const id of above.bets ?? []) newBet(bet(id), copy);
  }
  return root;
}

describe("plan levels", () => {
  it("company init writes a department plan, and group init a group plan with no key results", () => {
    const dept = mkdtempSync(join(tmpdir(), "nikos-d-"));
    expect(runCompany(["init", "--name", "Payments", "--level", "department", "--dir", dept])).toBe(0);
    expect(parse(readFileSync(join(dept, "planning/plan.yaml"), "utf8")).level).toBe("department");
    expect(existsSync(join(dept, "planning/krs"))).toBe(true);
    expect(readFileSync(join(dept, "README.md"), "utf8")).toContain('ask your agent to "join our department plan"');

    const group = mkdtempSync(join(tmpdir(), "nikos-g-"));
    expect(runGroup(["init", "--name", "Checkout", "--dir", group])).toBe(0);
    expect(parse(readFileSync(join(group, "planning/plan.yaml"), "utf8")).level).toBe("group");
    expect(existsSync(join(group, "planning/krs"))).toBe(false);
    expect(existsSync(join(group, "intent"))).toBe(false);
    expect(readFileSync(join(group, "planning/plan.yaml"), "utf8")).toContain("OKRs stop at department level");

    expect(runCompany(["init", "--name", "X", "--level", "group", "--dir", mkdtempSync(join(tmpdir(), "nikos-x-"))])).toBe(1);
    expect(runCompany(["init", "--name", "X", "--level", "team", "--dir", mkdtempSync(join(tmpdir(), "nikos-x-"))])).toBe(1);
  });

  it("refuses key results and objectives in a group plan", () => {
    const group = plan("group");
    expect(() => newKr(kr("conversion"), group)).toThrow(/^Key results stop at department level, so a group plan has none/);
    mkdirSync(join(group, "planning/krs"));
    writeFileSync(join(group, "planning/krs/conversion.yaml"), "id: conversion\ntitle: c\nowner: o\nbaseline: 1\ntarget: 2\noriginal_target: 2\nby: 2027-03-31\ncheckins: []\n");
    writeFileSync(join(group, "planning/plan.yaml"), "name: Checkout\nperiod: Q1 2027\nlevel: group\npillars: []\nobjectives:\n  - id: faster\n    title: Faster\n");
    const issues = planningIssues(group);
    expect(issues.map((i) => [i.file, !!i.warning])).toEqual([
      ["planning/plan.yaml", false],
      ["planning/krs/conversion.yaml", false],
    ]);
    expect(issues[0].message).toMatch(/^A group plan has no objectives: OKRs stop at department level/);
  });

  it("keeps a team plan loading, with warnings rather than errors", () => {
    const team = plan("company");
    newKr(kr("acted-on"), team);
    writeFileSync(join(team, "planning/plan.yaml"), "period: Q1 2027\nlevel: team\npillars: []\n");
    const issues = planningIssues(team);
    expect(issues.length).toBe(2);
    expect(issues.every((i) => i.warning)).toBe(true);
    expect(issues[0].message).toMatch(/^Team plans are going away/);
  });

  it("validate prints warnings without failing", async () => {
    const team = plan("company");
    writeFileSync(join(team, "planning/plan.yaml"), "period: Q1 2027\nlevel: team\npillars: []\n");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await runPlanning(["validate", "--dir", team])).toBe(0);
      expect(log.mock.calls.map((c) => c[0]).join("\n")).toMatch(/^! planning\/plan.yaml: Team plans are going away/m);
    } finally {
      log.mockRestore();
    }
  });
});

describe("aligning to the plan above", () => {
  it("lets a department key result align to several company key results", () => {
    const dept = plan("department", { repo: "acme/company-plan", level: "company", krs: ["kr-1", "kr-2"], bets: ["one-tap-pay"] });
    newKr(kr("pay-1", { alignsTo: ["acme/company-plan#kr-1", "acme/company-plan#kr-2"] }), dept);
    expect(loadKr(dept, "pay-1").data.aligns_to).toEqual(["acme/company-plan#kr-1", "acme/company-plan#kr-2"]);
    expect(readFileSync(join(dept, "planning/krs/pay-1.yaml"), "utf8")).toContain("aligns_to: [acme/company-plan#kr-1, acme/company-plan#kr-2]");
    // One stays a single reference, as before.
    newKr(kr("pay-2", { alignsTo: "acme/company-plan#kr-1" }), dept);
    expect(loadKr(dept, "pay-2").data.aligns_to).toBe("acme/company-plan#kr-1");
    expect(planningIssues(dept)).toEqual([]);
  });

  it("lets a department bet align to company bets, and checks what it points at", () => {
    const dept = plan("department", { repo: "acme/company-plan", level: "company", krs: ["kr-1"], bets: ["one-tap-pay", "self-serve"] });
    newBet(bet("wallets", { alignsTo: ["acme/company-plan#one-tap-pay", "acme/company-plan#self-serve"] }), dept);
    expect(loadBet(dept, "wallets").meta.aligns_to).toEqual(["acme/company-plan#one-tap-pay", "acme/company-plan#self-serve"]);
    expect(() => newBet(bet("x", { alignsTo: ["acme/company-plan#kr-1"] }), dept)).toThrow("acme/company-plan#kr-1 is a key result: a bet aligns to bets, and names key results under krs");
    expect(() => newKr(kr("y", { alignsTo: "acme/company-plan#one-tap-pay" }), dept)).toThrow("acme/company-plan#one-tap-pay is a bet: a key result aligns to key results");
    expect(() => newBet(bet("z", { alignsTo: ["acme/other-plan#one-tap-pay"] }), dept)).toThrow(
      "acme/other-plan#one-tap-pay: acme/other-plan isn't a plan this department joins (planning/upstream.yaml lists acme/company-plan)",
    );
    expect(() => newBet(bet("w", { alignsTo: ["one-tap-pay"] }), dept)).toThrow(/^'one-tap-pay' isn't another plan's bet: write it as <repo>#<id>/);
  });

  it("aligns only to a plan above it, and a company aligns to nothing", () => {
    // A group may align to any plan it joins above it, company or department (rule 5).
    const group = plan("group", { repo: "acme/company-plan", level: "company", bets: ["one-tap-pay"] });
    newBet(bet("apple-pay", { alignsTo: ["acme/company-plan#one-tap-pay"] }), group);
    expect(loadBet(group, "apple-pay").meta.aligns_to).toBe("acme/company-plan#one-tap-pay");
    const dept = plan("department", { repo: "acme/payments-group", level: "group", bets: ["wallets"] });
    expect(() => newBet(bet("apple-pay", { alignsTo: ["acme/payments-group#wallets"] }), dept)).toThrow(
      "acme/payments-group#wallets: acme/payments-group is a group plan, and a department bet can only align to a plan above department",
    );
    const okGroup = plan("group", { repo: "acme/payments-plan", level: "department", krs: ["pay-1"], bets: ["wallets"] });
    newBet(bet("apple-pay", { primary: "acme/payments-plan#pay-1", alignsTo: ["acme/payments-plan#wallets"] }), okGroup);
    expect(planningIssues(okGroup)).toEqual([]);
    expect(() => newBet(bet("x", { alignsTo: ["acme/holding#big-bet"] }), plan("company"))).toThrow("A company bet has no plan above it to align to");
  });

  it("allows a plan above that isn't synced yet, for validate to report as unresolved", () => {
    const dept = plan("department");
    writeFileSync(join(dept, "planning/upstream.yaml"), "- repo: acme/company-plan\n");
    newBet(bet("wallets", { alignsTo: ["acme/company-plan#one-tap-pay"] }), dept);
    expect(planningIssues(dept)).toEqual([]);
  });

  it("accepts aligns_to as one reference or a list in the schemas", () => {
    const k = { ...kr("a"), original_target: 2, checkins: [] };
    expect(checkKr({ ...k, aligns_to: "acme/company-plan#kr-1" })).toBe(true);
    expect(checkKr({ ...k, aligns_to: ["acme/company-plan#kr-1", "acme/company-plan#kr-2"] })).toBe(true);
    expect(checkKr({ ...k, aligns_to: [] })).toBe(false);
    const b = { id: "b", owner: "o", hypothesis: "h", krs: {}, review_on: "2027-01-01", confidence: "low", dependencies: [], outcome: "open", reviews: [] };
    expect(checkBet({ ...b, aligns_to: ["acme/company-plan#one-tap-pay"] })).toBe(true);
    expect(checkBet({ ...b, aligns_to: ["../escape#x"] })).toBe(false);
  });
});

describe("the alignment tree", () => {
  it("puts a key result under each it aligns to, and a bet under the bets it aligns to", () => {
    const co = plan("company");
    newKr(kr("kr-1"), co);
    newKr(kr("kr-2"), co);
    newBet(bet("one-tap-pay", { primary: "kr-1" }), co);
    const payments: DownstreamPlan = {
      name: "Payments",
      repo: "acme/payments-plan",
      state: "joined",
      blockers: [],
      decisions: [],
      krs: [{ id: "pay-1", title: "Payment success", aligns_to: ["acme/company-plan#kr-1", "acme/company-plan#kr-2"], progress: 0, stale: false, checkedIn: false }],
      bets: [{ id: "wallets", outcome: "open", delivery: "Not started", krs: ["pay-1"], aligns_to: ["acme/company-plan#one-tap-pay", "acme/company-plan#gone"] }],
    };
    const tree = alignment(co, "acme/company-plan", [payments]);
    const shape = (n: any): any => [`${n.kind} ${n.id}`, ...n.children.map(shape)];
    expect(tree.roots.map(shape)).toEqual([
      // wallets aligns to one-tap-pay, so it is shown only under that bet, not again under pay-1.
      ["kr kr-1", ["kr pay-1"], ["bet one-tap-pay", ["bet wallets"]]],
      ["kr kr-2", ["kr pay-1"]],
    ]);
    expect(tree.unaligned).toEqual([]);
    expect(JSON.stringify(tree)).not.toMatch(/progress|checkedIn|stale/);
    // A bet that only points outside the rollout is listed with where it points.
    payments.bets[0].aligns_to = ["acme/holding#big-bet"];
    payments.bets[0].krs = [];
    const out = alignment(co, "acme/company-plan", [payments]);
    expect(out.unaligned).toEqual([{ kind: "bet", id: "wallets", title: "wallets", plan: "Payments", repo: "acme/payments-plan", aligns_to: ["acme/holding#big-bet"], children: [] }]);
    expect(formatTree(out).join("\n")).toContain("bet wallets (Payments) → acme/holding#big-bet, not in this rollout");
  });
});

describe("group key", () => {
  it("group init takes --key, defaults it from the name, and writes it only for a group", () => {
    const g = mkdtempSync(join(tmpdir(), "nikos-gk-"));
    expect(runGroup(["init", "--name", "Checkout", "--key", "chk", "--dir", g])).toBe(0);
    expect(parse(readFileSync(join(g, "planning/plan.yaml"), "utf8")).key).toBe("CHK");

    const d = mkdtempSync(join(tmpdir(), "nikos-gd-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(runGroup(["init", "--name", "Pay Checkout", "--dir", d])).toBe(0);
    expect(parse(readFileSync(join(d, "planning/plan.yaml"), "utf8")).key).toBe("PC");
    expect(log.mock.calls.flat().join("\n")).toContain("Group key PC (from the name; set another with --key)");
    log.mockRestore();

    const bad = mkdtempSync(join(tmpdir(), "nikos-gb-"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runGroup(["init", "--name", "Checkout", "--key", "9bad", "--dir", bad])).toBe(1);
    expect(err.mock.calls.flat().join("\n")).toContain("isn't a valid group key");
    err.mockRestore();
  });

  it("refuses --key on a company or department plan, and a group writes no maps/ or intent/", () => {
    const c = mkdtempSync(join(tmpdir(), "nikos-gc-"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runCompany(["init", "--name", "Acme", "--key", "ACME", "--dir", c])).toBe(1);
    expect(err.mock.calls.flat().join("\n")).toContain("Only a group plan has a key");
    err.mockRestore();

    const g = mkdtempSync(join(tmpdir(), "nikos-gw-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    runGroup(["init", "--name", "Checkout", "--key", "CHK", "--dir", g]);
    expect(existsSync(join(g, "maps"))).toBe(false);
    expect(existsSync(join(g, "intent"))).toBe(false);
    expect(existsSync(join(g, "planning/bets"))).toBe(true);
    vi.restoreAllMocks();
  });
});
