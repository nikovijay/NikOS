// nikOS Plan, PR 6 stage C: ladders_up is text a key result or bet carries until a link exists. The
// candidates are the items the same validator would accept as a link, ranked by shared words. Accepting
// writes the link once and clears the text. Text alone feeds no figure, status or delivery.
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/mcp/server";
import { planIssues, runPlanRepo } from "../src/plan/cli";
import { addArea, initPlanRepo } from "../src/plan/repo";
import { acceptLadder, clearLadder, findItem, ladderFor, unlinkedItems, wordsOf } from "../src/planning/ladder";
import { editBet } from "../src/planning/bets";
import { editKr } from "../src/planning/krs";
import { runOp } from "../src/planning/ops";
import { checkBet, checkKr, hash, StaleError } from "../src/planning/model";

/** Acme: the company, finance and ops departments, and the WEB team under finance. */
function acme(): string {
  const repo = mkdtempSync(join(tmpdir(), "nikos-ladder-"));
  initPlanRepo(repo, { name: "Acme", year: "2027" });
  addArea(repo, "department", "finance", { name: "Finance", owner: "Mira" });
  addArea(repo, "department", "ops", { name: "Operations", owner: "Sam" });
  addArea(repo, "team", "WEB", { name: "Checkout web", home: "finance" });
  return repo;
}

/** Run a plan command in the repo, returning its exit code and what it printed. */
async function run(repo: string, ...args: string[]) {
  const out: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
  const err = vi.spyOn(console, "error").mockImplementation((...a) => void out.push(a.join(" ")));
  try {
    return { code: await runPlanRepo([...args, "--dir", repo]), out: out.join("\n") };
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
}

/** The plan as it stands: a company, two departments and a team, with items whose text has no link yet. */
async function world(repo: string) {
  await run(repo, "kr", "new", "revenue", "--in", "company", "--title", "Revenue", "--owner", "Mira", "--baseline", "0", "--target", "60000");
  await run(repo, "kr", "new", "ship-features", "--in", "ops", "--period", "2027-Q1", "--title", "Ship features", "--owner", "Sam", "--baseline", "0", "--target", "12");
  await run(repo, "kr", "new", "close-days", "--in", "finance", "--period", "2027-Q1", "--title", "Median days to close", "--owner", "Mira", "--baseline", "11", "--target", "7", "--direction", "down");
  await run(repo, "kr", "new", "pay-ledger", "--in", "finance", "--period", "2027-Q1", "--title", "Ledger match rate", "--owner", "Mira", "--baseline", "0", "--target", "99", "--ladders-up", "reconciliation revenue faster");
  await run(repo, "bet", "new", "checkout-first", "--in", "company", "--owner", "Mira", "--hypothesis", "Checkout work comes first for revenue", "--review", "2027-02-14");
  await run(repo, "bet", "new", "faster-close", "--in", "finance", "--owner", "Mira", "--hypothesis", "Matching payments cuts close time", "--review", "2027-02-14", "--kr", "close-days");
  await run(repo, "bet", "new", "faster-checkout", "--in", "WEB", "--owner", "Sam", "--hypothesis", "Faster checkout keeps customers", "--review", "2027-02-14", "--ladders-up", "faster checkout keeps revenue up");
  await run(repo, "bet", "new", "ship-checkout", "--in", "WEB", "--owner", "Sam", "--hypothesis", "Shipping checkout work sooner", "--review", "2027-02-14", "--ladders-up", "checkout work first");
}

const FINANCE = "planning/departments/finance";
const company = (repo: string) => join(repo, "planning/company");
const read = (repo: string, rel: string) => readFileSync(join(repo, rel), "utf8");

/** Every file under planning/, with its text: what a refusal must leave as it was. */
function snapshot(repo: string): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) visit(path);
      else out[path] = readFileSync(path, "utf8");
    }
  };
  visit(join(repo, "planning"));
  return out;
}

describe("ladders_up in the schemas", () => {
  it("is text on a key result and on a bet, and an empty string is refused", () => {
    const kr = { id: "pay-ledger", title: "Ledger", owner: "Mira", by: "2027-03-31", checkins: [], baseline: 0, target: 99, original_target: 99 };
    expect(checkKr({ ...kr, ladders_up: "reconciliation revenue faster" })).toBe(true);
    expect(checkKr({ ...kr, ladders_up: "" })).toBe(false);
    const bet = { id: "faster-close", owner: "Mira", hypothesis: "Matching cuts close time", krs: { also: [] }, review_on: "2027-02-14", confidence: "medium", dependencies: [], outcome: "open", reviews: [] };
    expect(checkBet({ ...bet, ladders_up: "cut close time" })).toBe(true);
    expect(checkBet({ ...bet, ladders_up: "" })).toBe(false);
  });
});

describe("candidates", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("a department key result can link only to company key results: its siblings and their own are left out", async () => {
    const repo = acme();
    await world(repo);
    const r = ladderFor(repo, "pay-ledger");
    expect(r.candidates.map((c) => [c.id, c.kind, c.rel])).toEqual([["revenue", "key result", "company"]]);
    expect(r.candidates[0].shared).toEqual(["revenue"]);
  });

  it("a company key result has no candidates: nothing sits above it", async () => {
    const repo = acme();
    await world(repo);
    expect(ladderFor(repo, "revenue").candidates).toEqual([]);
  });

  it("a team bet's candidates are key results and bets above it, ranked by shared words, ties to the nearer level", async () => {
    const repo = acme();
    await world(repo);
    const r = ladderFor(repo, "faster-checkout");
    // checkout-first shares two words of five, the finance bet and the company key result one each; finance is nearer.
    expect(r.candidates.map((c) => [c.id, c.kind, c.rel])).toEqual([
      ["checkout-first", "bet", "company"],
      ["faster-close", "bet", "departments/finance"],
      ["revenue", "key result", "company"],
    ]);
    expect(r.candidates[0].score).toBeGreaterThan(r.candidates[1].score);
  });

  it("a company bet's candidates are key results, and it has no bets above it", async () => {
    const repo = acme();
    await world(repo);
    const r = ladderFor(repo, "checkout-first");
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates.every((c) => c.kind === "key result")).toBe(true);
  });

  it("a company bet may aim at a department key result (rule 2), so it is offered one that shares its words", async () => {
    const repo = acme();
    await world(repo);
    expect((await run(repo, "bet", "new", "cash-first", "--in", "company", "--owner", "Mira", "--hypothesis", "Cash first", "--review", "2027-02-14", "--ladders-up", "close days faster")).code).toBe(0);
    expect(ladderFor(repo, "cash-first").candidates.map((c) => [c.id, c.rel])).toEqual([["close-days", "departments/finance"]]);
    // The link a person picks is written the same as any other, and the check passes.
    expect((await run(repo, "ladder", "accept", "cash-first", "close-days")).code).toBe(0);
    expect(read(repo, "planning/company/bets/cash-first.md")).toContain("primary: close-days");
    expect((await run(repo, "validate")).code).toBe(0);
    // A hand-written aim gets the same answer: no refusal for the level.
    expect((await run(repo, "bet", "new", "close-faster", "--in", "company", "--owner", "Mira", "--hypothesis", "Closing faster frees cash", "--review", "2027-02-14", "--kr", "close-days")).code).toBe(0);
  });

  it("a department key result's candidates leave out its own department's and the other department's key results, even with shared words", async () => {
    const repo = acme();
    await world(repo);
    // Both share 'revenue' with pay-ledger's text. Neither is above the finance department, so the validator must keep them out.
    await run(repo, "kr", "new", "revenue-leaks", "--in", "ops", "--period", "2027-Q1", "--title", "Revenue leaks", "--owner", "Sam", "--baseline", "0", "--target", "5");
    await run(repo, "kr", "new", "revenue-close", "--in", "finance", "--period", "2027-Q1", "--title", "Revenue close", "--owner", "Mira", "--baseline", "0", "--target", "5");
    expect(ladderFor(repo, "pay-ledger").candidates.map((c) => c.id)).toEqual(["revenue"]);
  });

  it("a team bet's candidates leave out the bets at its own level, even when they share words", async () => {
    const repo = acme();
    await world(repo);
    // ship-checkout is in the same team and shares 'checkout' with the text, so only the validator keeps it out.
    expect(wordsOf("faster checkout keeps revenue up")).toContain("checkout");
    expect(ladderFor(repo, "faster-checkout").candidates.map((c) => c.id)).not.toContain("ship-checkout");
  });

  it("shows at most three candidates, best first, ties to the id", async () => {
    const repo = acme();
    await world(repo);
    for (const [id, title] of [["revenue-a", "Revenue A"], ["revenue-b", "Revenue B"], ["revenue-c", "Revenue C"], ["revenue-d", "Revenue D"]]) {
      await run(repo, "kr", "new", id, "--in", "company", "--title", title, "--owner", "Mira", "--baseline", "0", "--target", "1");
    }
    const r = ladderFor(repo, "pay-ledger");
    expect(r.candidates.map((c) => c.id)).toEqual(["revenue", "revenue-a", "revenue-b"]);
  });

  it("with no candidate, says nothing above shares its words, offers keeping or clearing the text, and names no flag", async () => {
    const repo = acme();
    await world(repo);
    await run(repo, "kr", "new", "fix-speed", "--in", "finance", "--period", "2027-Q1", "--title", "Fix speed", "--owner", "Mira", "--baseline", "0", "--target", "1", "--ladders-up", "xyzzy quux");
    const r = await run(repo, "ladder", "fix-speed");
    expect(r.code).toBe(0);
    expect(r.out).toContain("Nothing above it shares words with its text, so there's nothing to link to yet. Keep the text, or clear it with nikos plan ladder clear fix-speed.");
    expect(r.out).not.toContain("--aligns-to");
    expect(r.out).not.toContain("nikos plan ladder accept");
  });

  it("ranks the closest key result first for the text, and says which words it shares", async () => {
    const repo = acme();
    await world(repo);
    await run(repo, "kr", "new", "pay-speed", "--in", "company", "--title", "Payment speed", "--owner", "Mira", "--baseline", "0", "--target", "1");
    await run(repo, "kr", "new", "pay-ledger-two", "--in", "finance", "--period", "2027-Q1", "--title", "Ledger two", "--owner", "Mira", "--baseline", "0", "--target", "1", "--ladders-up", "payment speed");
    const r = ladderFor(repo, "pay-ledger-two");
    expect(r.candidates[0]).toMatchObject({ id: "pay-speed", shared: ["payment", "speed"] });
    expect(wordsOf("Reconciliation, the ships and CLOSES")).toEqual(["reconciliation", "ship", "close"]);
  });

  it("is never a write: the list and the candidates leave every file as it was", async () => {
    const repo = acme();
    await world(repo);
    const before = snapshot(repo);
    expect((await run(repo, "ladder")).code).toBe(0);
    expect((await run(repo, "ladder", "--json")).code).toBe(0);
    expect((await run(repo, "ladder", "pay-ledger")).code).toBe(0);
    expect((await run(repo, "ladder", "faster-checkout", "--json")).code).toBe(0);
    expect(snapshot(repo)).toEqual(before);
  });

  it("the command lists what it could link to, and the unlinked items", async () => {
    const repo = acme();
    await world(repo);
    const list = JSON.parse((await run(repo, "ladder", "--json")).out);
    expect(list.items.map((i: any) => i.id)).toEqual(["pay-ledger", "faster-checkout", "ship-checkout"]);
    expect(unlinkedItems(repo)).toEqual(list.items);
    const one = await run(repo, "ladder", "pay-ledger");
    expect(one.out).toContain('pay-ledger (key result, departments/finance) ladders up to "reconciliation revenue faster"');
    expect(one.out).toContain("revenue — key result in company: Revenue (shares revenue)");
    expect(one.out).toContain("nikos plan ladder accept pay-ledger <candidate>");
    const json = JSON.parse((await run(repo, "ladder", "pay-ledger", "--json")).out);
    expect(json.candidates[0]).toMatchObject({ id: "revenue", kind: "key result", rel: "company", shared: ["revenue"] });
  });

  it("the read-only MCP tool lists the same candidates, and is marked read-only", async () => {
    const repo = acme();
    await world(repo);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" }, { capabilities: {} });
    await createServer(repo).connect(a);
    await client.connect(b);
    const tool = (await client.listTools()).tools.find((t) => t.name === "plan_ladder");
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    const r: any = await client.callTool({ name: "plan_ladder", arguments: { id: "pay-ledger" } });
    expect(r.structuredContent.candidates.map((c: any) => c.id)).toEqual(["revenue"]);
    const all: any = await client.callTool({ name: "plan_ladder", arguments: {} });
    expect(all.structuredContent.items.map((i: any) => i.id)).toEqual(["pay-ledger", "faster-checkout", "ship-checkout"]);
  });
});

describe("accepting a candidate", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("a key result's link is appended and the text goes, in one write", async () => {
    const repo = acme();
    await world(repo);
    const r = await run(repo, "ladder", "accept", "pay-ledger", "revenue");
    expect(r.code).toBe(0);
    expect(r.out).toBe(`Linked pay-ledger to revenue: wrote ${FINANCE}/krs/pay-ledger.yaml`);
    const yaml = read(repo, `${FINANCE}/krs/pay-ledger.yaml`);
    expect(yaml).toContain("aligns_to: revenue");
    expect(yaml).not.toContain("ladders_up");
    expect(ladderFor(repo, "pay-ledger").linked).toBe(true);
    expect(unlinkedItems(repo).map((i) => i.id)).toEqual(["faster-checkout", "ship-checkout"]);
  });

  it("a bet's key result fills primary, then also, and the text goes with the first", async () => {
    const repo = acme();
    await world(repo);
    expect((await run(repo, "ladder", "accept", "faster-checkout", "revenue")).code).toBe(0);
    let file = read(repo, "planning/teams/WEB/bets/faster-checkout.md");
    expect(file).toContain("primary: revenue");
    expect(file).not.toContain("ladders_up");
    expect((await run(repo, "ladder", "accept", "faster-checkout", "ship-features")).code).toBe(0);
    file = read(repo, "planning/teams/WEB/bets/faster-checkout.md");
    expect(file).toContain("primary: revenue");
    expect(file).toContain("ship-features");
  });

  it("bet to bet: a bet above is written into aligns_to, and the text goes", async () => {
    const repo = acme();
    await world(repo);
    const r = await run(repo, "ladder", "accept", "ship-checkout", "checkout-first");
    expect(r.code).toBe(0);
    const file = read(repo, "planning/teams/WEB/bets/ship-checkout.md");
    expect(file).toContain("aligns_to: checkout-first");
    expect(file).not.toContain("ladders_up");
  });

  it("refuses a candidate the validator would refuse as a hand-written link, and writes nothing", async () => {
    const repo = acme();
    await world(repo);
    const before = snapshot(repo);
    // A key result aligns to key results only: a bet is refused, with the same words as --aligns-to.
    const kindWrong = await run(repo, "ladder", "accept", "pay-ledger", "checkout-first");
    expect(kindWrong.code).toBe(1);
    expect(kindWrong.out).toContain("checkout-first is a bet: a key result aligns to key results");
    // A key result at the same level is not above it.
    const notAbove = await run(repo, "ladder", "accept", "pay-ledger", "close-days");
    expect(notAbove.code).toBe(1);
    expect(notAbove.out).toContain("isn't above");
    // A candidate that doesn't exist.
    const missing = await run(repo, "ladder", "accept", "pay-ledger", "no-such-kr");
    expect(missing.out).toContain("There's no key result or bet called 'no-such-kr'");
    expect(snapshot(repo)).toEqual(before);
  });

  it("refuses a link the item already has, with its text still there", async () => {
    const repo = acme();
    await world(repo);
    await run(repo, "ladder", "accept", "pay-ledger", "revenue");
    await editKr(join(repo, FINANCE), "pay-ledger", { ladders_up: "sales faster" });
    const again = await run(repo, "ladder", "accept", "pay-ledger", "revenue");
    expect(again.code).toBe(1);
    expect(again.out).toContain("pay-ledger already aligns to revenue");
    expect(read(repo, `${FINANCE}/krs/pay-ledger.yaml`)).toContain("sales faster");
  });

  it("a stale copy refuses the write with the file unchanged", () => {
    const repo = acme();
    return world(repo).then(() => {
      const area = join(repo, FINANCE);
      const before = read(repo, `${FINANCE}/krs/pay-ledger.yaml`);
      expect(() => acceptLadder(area, "kr", "pay-ledger", "revenue", "0000000000000000")).toThrow(StaleError);
      expect(read(repo, `${FINANCE}/krs/pay-ledger.yaml`)).toBe(before);
      // The expect the caller loaded is the one that counts: the same file, with its own hash, goes through.
      acceptLadder(area, "kr", "pay-ledger", "revenue", hash(before));
      expect(read(repo, `${FINANCE}/krs/pay-ledger.yaml`)).toContain("aligns_to: revenue");
    });
  });

  it("clears text with ladder clear, and refuses when there is none", async () => {
    const repo = acme();
    await world(repo);
    expect((await run(repo, "ladder", "clear", "pay-ledger")).code).toBe(0);
    expect(read(repo, `${FINANCE}/krs/pay-ledger.yaml`)).not.toContain("ladders_up");
    const again = await run(repo, "ladder", "clear", "pay-ledger");
    expect(again.code).toBe(1);
    expect(again.out).toContain("pay-ledger has no ladders_up text to clear");
  });

  it("names what is missing when accept or clear is given without it", async () => {
    const repo = acme();
    await world(repo);
    expect((await run(repo, "ladder", "accept", "pay-ledger")).out).toContain("Name the link: nikos plan ladder accept <id> <candidate>");
    expect((await run(repo, "ladder", "clear")).out).toContain("Name the item: nikos plan ladder clear <id>");
  });
});

describe("text on a key result or bet", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("is refused on a company key result, and on a key result or bet with a link as well", async () => {
    const repo = acme();
    await world(repo);
    const company_kr = await run(repo, "kr", "new", "grow", "--in", "company", "--title", "Grow", "--owner", "Mira", "--baseline", "0", "--target", "1", "--ladders-up", "anything");
    expect(company_kr.code).toBe(1);
    expect(company_kr.out).toContain("A company key result has nothing above it to align to, so it has no ladders_up");
    const both_kr = await run(repo, "kr", "new", "pay-two", "--in", "finance", "--period", "2027-Q1", "--title", "Two", "--owner", "Mira", "--baseline", "0", "--target", "1", "--aligns-to", "revenue", "--ladders-up", "text");
    expect(both_kr.code).toBe(1);
    expect(both_kr.out).toContain("Give a link (--aligns-to) or the text (--ladders-up), not both");
    const both_bet = await run(repo, "bet", "new", "both", "--in", "WEB", "--owner", "Sam", "--hypothesis", "Both", "--review", "2027-02-14", "--kr", "revenue", "--ladders-up", "text");
    expect(both_bet.code).toBe(1);
    expect(both_bet.out).toContain("Give a link (--aligns-to or --kr) or the text (--ladders-up), not both");
  });

  it("is allowed on a company bet, which has no key result of its own yet", async () => {
    const repo = acme();
    const r = await run(repo, "bet", "new", "grow-revenue", "--in", "company", "--owner", "Mira", "--hypothesis", "Growing revenue first", "--review", "2027-02-14", "--ladders-up", "the company's revenue plan");
    expect(r.code).toBe(0);
    expect(read(repo, "planning/company/bets/grow-revenue.md")).toContain("ladders_up: the company's revenue plan");
  });

  it("is set and cleared by the edit functions, which the operations use too", async () => {
    const repo = acme();
    await world(repo);
    const area = join(repo, FINANCE);
    await editBet(join(repo, "planning/departments/finance"), "faster-close", { ladders_up: "cut close time" });
    expect(read(repo, "planning/departments/finance/bets/faster-close.md")).toContain("ladders_up: cut close time");
    await editBet(join(repo, "planning/departments/finance"), "faster-close", { ladders_up: "" });
    expect(read(repo, "planning/departments/finance/bets/faster-close.md")).not.toContain("ladders_up");
    // The operations: kr.edit sets a key result's text, and refuses it on the company's.
    runOp(area, { op: "kr.edit", target: { kr: "pay-ledger" }, args: { ladders_up: "sales faster" } });
    expect(read(repo, `${FINANCE}/krs/pay-ledger.yaml`)).toContain("ladders_up: sales faster");
    expect(() => runOp(company(repo), { op: "kr.edit", target: { kr: "revenue" }, args: { ladders_up: "anything" } })).toThrow(/nothing above it/);
  });

  it("with a link as well is a validate warning, and so is text with no link; validate still passes", async () => {
    const repo = acme();
    await world(repo);
    const pending = planIssues(repo).filter((i) => i.warning && i.message.includes("not linked yet"));
    expect(pending.map((i) => [i.file, i.message])).toEqual([
      [`${FINANCE}/krs/pay-ledger.yaml`, 'not linked yet: "reconciliation revenue faster" is only text. nikos plan ladder pay-ledger lists what it could link to'],
      ["planning/teams/WEB/bets/faster-checkout.md", 'not linked yet: "faster checkout keeps revenue up" is only text. nikos plan ladder faster-checkout lists what it could link to'],
      ["planning/teams/WEB/bets/ship-checkout.md", 'not linked yet: "checkout work first" is only text. nikos plan ladder ship-checkout lists what it could link to'],
    ]);
    expect((await run(repo, "validate")).code).toBe(0);
    await run(repo, "ladder", "accept", "pay-ledger", "revenue");
    await editKr(join(repo, FINANCE), "pay-ledger", { ladders_up: "sales faster" });
    const left = planIssues(repo).filter((i) => i.warning && i.message.includes("left over"));
    expect(left.map((i) => i.message)).toEqual(['"sales faster" is left over: the link is written, so the text can go with nikos plan ladder clear pay-ledger']);
    expect((await run(repo, "validate")).code).toBe(0);
  });

  it("shows in plan status and its JSON, and feeds no link, figure or delivery", async () => {
    const repo = acme();
    await world(repo);
    const status = (await run(repo, "status", "--in", "finance")).out;
    expect(status).toContain('pay-ledger — Ledger match rate: no check-ins (baseline 0, target 99 by 2027-03-31) · 2027-Q1 · not linked yet: "reconciliation revenue faster" · stale');
    const json = JSON.parse((await run(repo, "status", "--json")).out);
    const finance = json.areas.find((a: any) => a.rel === "departments/finance");
    expect(finance.keyResults.find((k: any) => k.id === "pay-ledger")).toMatchObject({ aligns_to: [], laddersUp: "reconciliation revenue faster", linked: false });
    const web = json.areas.find((a: any) => a.rel === "teams/WEB");
    expect(web.bets.find((b: any) => b.id === "faster-checkout")).toMatchObject({ alignsTo: [], aimsAt: [], laddersUp: "faster checkout keeps revenue up", linked: false });
    // No story map names the bet, so its delivery is the empty one: the text feeds it nothing.
    expect(web.bets.find((b: any) => b.id === "faster-checkout").delivery).toMatchObject({ source: "none", via: [] });
  });

  it("clears the text when a link is written by the existing commands too", async () => {
    const repo = acme();
    await world(repo);
    // A bet's aims are written by the bet's own command: the text goes with them.
    await run(repo, "bet", "new", "more-checks", "--in", "WEB", "--owner", "Sam", "--hypothesis", "More checks", "--review", "2027-02-14", "--ladders-up", "checks");
    await editBet(join(repo, "planning/teams/WEB"), "more-checks", { ladders_up: "still checks" });
    expect(read(repo, "planning/teams/WEB/bets/more-checks.md")).toContain("ladders_up: still checks");
    runOp(join(repo, "planning/teams/WEB"), { op: "bet.krs", target: { bet: "more-checks" }, args: { primary: "revenue" }, expect: hash(read(repo, "planning/teams/WEB/bets/more-checks.md")) });
    expect(read(repo, "planning/teams/WEB/bets/more-checks.md")).not.toContain("ladders_up");
    expect(read(repo, "planning/teams/WEB/bets/more-checks.md")).toContain("primary: revenue");
  });

  it("is found by id, and an unknown id is named", async () => {
    const repo = acme();
    await world(repo);
    expect(findItem(repo, "pay-ledger").kind).toBe("kr");
    expect(findItem(repo, "faster-close").kind).toBe("bet");
    expect(() => findItem(repo, "nope")).toThrow("No key result or bet called 'nope'");
    expect((await run(repo, "ladder", "nope")).code).toBe(1);
  });
});
