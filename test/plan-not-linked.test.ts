// nikOS Plan, PR 6 stage D: a key result or bet whose ladders_up text has no link is listed as "not linked
// yet" on the dashboard at every altitude, and in the offline export. It gets no line in the ladder and no
// figure, and suggest offers to link it, with "Look at the plan" always kept as the last option.
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { areaPage, drillBet, drillKr, upChain } from "../src/plan/dashboard";
import { planDeliveries } from "../src/plan/delivery";
import { renderPlanBody, renderPlanPage, viewOf } from "../src/plan/page";
import { exportPlanPage } from "../src/plan/serve";
import { runPlanRepo } from "../src/plan/cli";
import { addArea, findArea, initPlanRepo } from "../src/plan/repo";
import { suggest } from "../src/commands/suggest";
import { acceptLadder } from "../src/planning/ladder";

const NOW = new Date("2026-11-10T12:00:00Z");

/** Acme: the company, finance (a department) and the WEB team under it. Created through the CLI, as a person would. */
function acme(): string {
  const repo = mkdtempSync(join(tmpdir(), "nikos-not-linked-"));
  initPlanRepo(repo, { name: "Acme", year: "2027" });
  addArea(repo, "department", "finance", { name: "Finance", owner: "Mira" });
  addArea(repo, "team", "WEB", { name: "Checkout web", home: "finance" });
  return repo;
}

/** Run a plan command in the repo. Output is captured, so the test's own output stays clean. */
async function run(repo: string, ...args: string[]): Promise<number> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    return await runPlanRepo([...args, "--dir", repo]);
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
}

/** A company with revenue, a department KR aligned to it, and text-only items at each level. */
async function world(repo: string) {
  await run(repo, "kr", "new", "revenue", "--in", "company", "--title", "Revenue", "--owner", "Mira", "--baseline", "0", "--target", "60000");
  await run(repo, "kr", "new", "close-days", "--in", "finance", "--period", "2027-Q1", "--title", "Median days to close", "--owner", "Mira", "--baseline", "11", "--target", "7", "--direction", "down", "--aligns-to", "revenue");
  await run(repo, "kr", "new", "pay-ledger", "--in", "finance", "--period", "2027-Q1", "--title", "Ledger match rate", "--owner", "Mira", "--baseline", "0", "--target", "99", "--ladders-up", "reconciliation revenue faster");
  await run(repo, "bet", "new", "checkout-first", "--in", "company", "--owner", "Mira", "--hypothesis", "Checkout work comes first for revenue", "--review", "2027-02-14", "--ladders-up", "checkout work for revenue");
  await run(repo, "bet", "new", "faster-checkout", "--in", "WEB", "--owner", "Sam", "--hypothesis", "Faster checkout keeps customers", "--review", "2027-02-14", "--ladders-up", "faster checkout keeps revenue up");
}

const page = (repo: string, at: string, period?: string) =>
  areaPage(repo, findArea(repo, at), { deliveries: planDeliveries(repo, NOW), now: NOW, ...(period ? { period } : {}) });

/** The body of a page's view, as the offline export writes it. */
const bodyOf = (repo: string, at: string, view: string, period?: string) => {
  const p = page(repo, at, period);
  return renderPlanBody(p, { view: viewOf(new URLSearchParams(`view=${view}`), p.plan.level) }, { offline: true });
};

describe("not linked yet, on the dashboard at every altitude", () => {
  it("lists each area's own text-only key results and bets, and no other area's", async () => {
    const repo = acme();
    await world(repo);
    expect(page(repo, "company").unlinked).toEqual([{ id: "checkout-first", rel: "company", kind: "bet", text: "checkout work for revenue" }]);
    expect(page(repo, "departments/finance", "2027-Q1").unlinked).toEqual([{ id: "pay-ledger", rel: "departments/finance", kind: "key result", text: "reconciliation revenue faster" }]);
    expect(page(repo, "teams/WEB").unlinked).toEqual([{ id: "faster-checkout", rel: "teams/WEB", kind: "bet", text: "faster checkout keeps revenue up" }]);
  });

  it("shows the section on each altitude's page, with the words it was given", async () => {
    const repo = acme();
    await world(repo);
    expect(bodyOf(repo, "company", "okrs")).toContain("Not linked yet");
    expect(bodyOf(repo, "company", "okrs")).toContain("checkout work for revenue");
    expect(bodyOf(repo, "departments/finance", "keys", "2027-Q1")).toContain("reconciliation revenue faster");
    expect(bodyOf(repo, "teams/WEB", "bets")).toContain("faster checkout keeps revenue up");
  });

  it("gives the live page the same section", async () => {
    const repo = acme();
    await world(repo);
    const p = page(repo, "teams/WEB");
    const html = renderPlanPage(p, { view: viewOf(new URLSearchParams("view=bets"), p.plan.level) }, { token: "t" });
    expect(html).toContain("Not linked yet");
  });

  it("draws no ladder line for a text-only item: the ladder's lines are the same with it as without", async () => {
    const repo = acme();
    await world(repo);
    // close-days aligns to revenue, so one line is drawn. pay-ledger has only text, so it is in the column with no line.
    const html = bodyOf(repo, "departments/finance", "ladder", "2027-Q1");
    expect(html.match(/<path /g)?.length).toBe(1);
    expect(html).toContain("Ledger match rate");
  });

  it("leaves the figures alone: text on a key result is no link, so nothing above it is counted", async () => {
    const repo = acme();
    await world(repo);
    const dept = page(repo, "departments/finance", "2027-Q1");
    const ledger = dept.krs.find((k) => k.id === "pay-ledger")!;
    expect(ledger.aligns).toEqual([]);
    expect(dept.aboveKrs.map((k) => k.id)).toEqual(["revenue"]);
    // The bet's words are not a link, so its delivery is the one a bet with no story map has.
    expect(page(repo, "company").bets.find((b) => b.id === "checkout-first")!.delivery).toMatchObject({ source: "none" });
  });

  it("stops listing an item once a link is written, and the section goes when none is left", async () => {
    const repo = acme();
    await world(repo);
    acceptLadder(findArea(repo, "departments/finance").dir, "kr", "pay-ledger", "revenue");
    const dept = page(repo, "departments/finance", "2027-Q1");
    expect(dept.unlinked).toEqual([]);
    expect(bodyOf(repo, "departments/finance", "keys", "2027-Q1")).not.toContain("Not linked yet");
  });

  it("leaves the section out of a drill-down page", async () => {
    const repo = acme();
    await world(repo);
    const drill = drillKr(repo, "revenue", planDeliveries(repo, NOW), NOW);
    expect(drill).toBeDefined();
    const p = page(repo, "company");
    const html = renderPlanBody(p, { view: viewOf(new URLSearchParams("view=okrs"), "company"), drill: { kind: "kr", kr: drill! } }, { offline: true });
    expect(html).not.toContain("Not linked yet");
  });
});

describe("not linked yet, in the offline export", () => {
  it("holds the section in every area's pages, with no form in the file", async () => {
    const repo = acme();
    await world(repo);
    const out = join(mkdtempSync(join(tmpdir(), "nikos-not-linked-export-")), "plan.html");
    await exportPlanPage(repo, out, { offline: true });
    const html = readFileSync(out, "utf8");
    expect(html).toContain("Not linked yet");
    expect(html).toContain("reconciliation revenue faster");
    expect(html).toContain("faster checkout keeps revenue up");
    expect(html).not.toContain("<form");
  });
});

describe("suggest offers to link text-only items", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("offers the link, with the look-at-the-plan option kept last", async () => {
    const repo = acme();
    await world(repo);
    const s = suggest(repo, undefined, { area: "departments/finance" });
    const labels = s.options.map((o) => o.label);
    expect(labels).toContain('Link "pay-ledger" to what it ladders up to');
    expect(labels.at(-1)).toBe("Look at the plan");
    const link = s.options.find((o) => o.label.startsWith("Link "))!;
    expect(link.do).toContain("nikos plan ladder <id>");
    expect(link.do).toContain("nikos plan ladder accept <id> <candidate>");
  });

  it("keeps Look at the plan when there are more options than the cap", async () => {
    const repo = acme();
    await world(repo);
    // A bet past its review, a key result with no check-in, and a milestone whose steps are stale: three options, then the link, then the look.
    await run(repo, "bet", "new", "review-me", "--in", "finance", "--owner", "Mira", "--hypothesis", "Matching cuts close time", "--review", "2026-10-01");
    await run(repo, "kr", "new", "ship-steps", "--in", "finance", "--period", "2027-Q1", "--title", "Ship steps", "--owner", "Mira", "--kind", "milestone", "--step", "Map", "--step", "Pilot");
    await run(repo, "kr", "step", "ship-steps", "Map", "--in", "finance", "--date", "2026-01-05");
    const s = suggest(repo, undefined, { area: "departments/finance" });
    const labels = s.options.map((o) => o.label);
    expect(s.options.length).toBe(4);
    expect(labels.at(-1)).toBe("Look at the plan");
    expect(labels[0]).toMatch(/^Review /);
  });
});

describe("not linked yet, on a drill-down, in every quarter, and on a team's ladder", () => {
  it("a text-only key result's drill-down says what it ladders up to, and that no figure counts it", async () => {
    const repo = acme();
    await world(repo);
    const drill = drillKr(repo, "pay-ledger", planDeliveries(repo, NOW), NOW);
    expect(drill).toBeDefined();
    const html = renderPlanBody(page(repo, "departments/finance", "2027-Q1"), { view: viewOf(new URLSearchParams("view=okrs"), "department"), drill: { kind: "kr", kr: drill! } }, { offline: true });
    expect(html).toContain('Not linked yet: "reconciliation revenue faster". It counts in no figure.');
  });

  it("a text-only bet's drill-down says what it ladders up to, instead of 'Nothing above it'", async () => {
    const repo = acme();
    await world(repo);
    const bet = drillBet(repo, "checkout-first", planDeliveries(repo, NOW));
    const up = upChain(repo, "checkout-first", planDeliveries(repo, NOW));
    expect(bet && up).toBeTruthy();
    const html = renderPlanBody(page(repo, "company"), { view: viewOf(new URLSearchParams("view=okrs"), "company"), drill: { kind: "bet", bet: bet!, up: up! } }, { offline: true });
    expect(html).toContain('Not linked yet: "checkout work for revenue". It counts in no figure.');
    expect(html).toContain("Nothing above it.");
  });

  it("lists a text-only key result in every quarter, as plan status and the suggestion do, not only the quarter shown", async () => {
    const repo = acme();
    await world(repo);
    await run(repo, "kr", "new", "pay-next", "--in", "finance", "--period", "2027-Q2", "--title", "Next ledger", "--owner", "Mira", "--baseline", "0", "--target", "9", "--ladders-up", "next quarter ledger");
    expect(page(repo, "departments/finance", "2027-Q2").unlinked.map((u) => u.id).sort()).toEqual(["pay-ledger", "pay-next"]);
    expect(suggest(repo, undefined, { area: "departments/finance" }).options.map((o) => o.label)).toContain("Link 2 items to what they ladder up to");
  });

  it("a team's bet draws its lines: one to the key result it aims at, and one to the bet it aligns to", async () => {
    const repo = acme();
    await world(repo);
    expect(await run(repo, "bet", "new", "more-checks", "--in", "WEB", "--owner", "Sam", "--hypothesis", "More checks", "--review", "2027-02-14", "--kr", "revenue", "--aligns-to", "checkout-first")).toBe(0);
    const html = bodyOf(repo, "teams/WEB", "ladder");
    expect(html.match(/<path /g)?.length).toBe(2);
    expect(html).toContain("more-checks");
  });
});
