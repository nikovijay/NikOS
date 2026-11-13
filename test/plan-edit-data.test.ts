// The data behind the dashboard's forms: a bet or key result made from its title (its id is made from the
// title, with -2 when taken), a bet's title, the names and choices a page carries, and the file versions
// a save sends back. Through the commands, the change path (runOp) and the save endpoint, with real files.
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPlanRepo } from "../src/plan/cli";
import { areaPage } from "../src/plan/dashboard";
import { planDeliveries } from "../src/plan/delivery";
import { addArea, findArea, initPlanRepo } from "../src/plan/repo";
import { startPlanServe, type PlanServe } from "../src/plan/serve";
import { newBet, editBet } from "../src/planning/bets";
import { editKr, newKr } from "../src/planning/krs";
import { hash, loadBet, loadKr } from "../src/planning/model";
import { runOp } from "../src/planning/ops";
import { acmePlan } from "./plan-serve-fixture";

const NOW = new Date("2026-11-10T12:00:00.000Z");
const company = (repo: string) => findArea(repo, "company").dir;
const finance = (repo: string) => findArea(repo, "finance").dir;
const payments = (repo: string) => findArea(repo, "payments").dir;
const betPath = (dir: string, id: string) => join(dir, "bets", `${id}.md`);
const krPath = (dir: string, id: string) => join(dir, "krs", `${id}.yaml`);

let open: PlanServe[] = [];
afterEach(async () => {
  await Promise.all(open.map((p) => p.srv.close()));
  open = [];
  vi.restoreAllMocks();
});

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

const betInput = (extra: Record<string, unknown> = {}) => ({ owner: "Sam", hypothesis: "Matching payments cuts close time.", reviewOn: "2027-02-14", ...extra });

describe("a bet or key result made from its title", () => {
  it("makes the id from the title, and -2 then -3 when the id is taken", () => {
    const repo = acmePlan();
    newBet(betInput({ title: "Match payments faster" }), finance(repo));
    expect(loadBet(finance(repo), "match-payments-faster").meta).toMatchObject({ id: "match-payments-faster", title: "Match payments faster" });
    newBet(betInput({ title: "Match payments faster" }), payments(repo));
    newBet(betInput({ title: "Match payments faster" }), company(repo));
    expect(existsSync(betPath(payments(repo), "match-payments-faster-2"))).toBe(true);
    expect(existsSync(betPath(company(repo), "match-payments-faster-3"))).toBe(true);
  });

  it("takes a company-wide id: a title that matches a key result's id gets -2", () => {
    const repo = acmePlan();
    // revenue is a company key result, so a bet titled Revenue can't be revenue.
    newBet(betInput({ title: "Revenue" }), finance(repo));
    expect(existsSync(betPath(finance(repo), "revenue-2"))).toBe(true);
  });

  it("refuses an explicit id that is taken, as before", () => {
    const repo = acmePlan();
    expect(() => newBet(betInput({ id: "one-inbox", title: "Something else" }), finance(repo))).toThrow("'one-inbox' is already used");
  });

  it("refuses a bet with neither an id nor a title, and a title with no letters or numbers and no id", () => {
    const repo = acmePlan();
    expect(() => newBet(betInput(), finance(repo))).toThrow("A bet needs a title");
    expect(() => newBet(betInput({ title: "!!!" }), finance(repo))).toThrow("'!!!' has no letters or numbers to make an id from: use a title with some letters or numbers, or give an id");
  });

  it("the bet op makes a bet from a title with no target, and names the id it made", () => {
    const repo = acmePlan();
    const r = runOp(company(repo), { op: "bet.new", args: { title: "Clear the backlog", owner: "Sam", hypothesis: "Less waiting.", review_on: "2027-02-14", primary: "revenue" } });
    expect(r.message).toBe("Added bet clear-the-backlog");
    expect(r.changed).toEqual(["planning/company/bets/clear-the-backlog.md"]);
    expect(loadBet(company(repo), "clear-the-backlog").meta.krs.primary).toBe("revenue");
  });

  it("the bet op refuses with neither an id nor a title, with the message the form shows", () => {
    const repo = acmePlan();
    expect(() => runOp(finance(repo), { op: "bet.new", args: { owner: "Sam", hypothesis: "h", review_on: "2027-02-14" } })).toThrow("A bet needs a title");
  });

  it("the key result op makes a department key result from a title, for a quarter, and names the id", () => {
    const repo = acmePlan();
    const r = runOp(finance(repo), { op: "kr.new", target: { kr: "" }, args: { title: "Close faster", owner: "Mira", baseline: 0, target: 5, period: "2027-Q2" } });
    expect(r.message).toBe("Added key result close-faster");
    expect(loadKr(finance(repo), "close-faster").data).toMatchObject({ title: "Close faster", period: "2027-Q2", by: "2027-06-30" });
  });

  it("a department key result needs its quarter, which the op now takes", () => {
    const repo = acmePlan();
    expect(() => runOp(finance(repo), { op: "kr.new", args: { title: "Close faster", owner: "Mira", baseline: 0, target: 5 } })).toThrow(
      "A department's key result needs a quarter, such as 2027-Q1",
    );
  });

  it("a key result made from a title that a key result already has gets -2, and an explicit id that is taken is refused", () => {
    const repo = acmePlan();
    const r = runOp(finance(repo), { op: "kr.new", args: { title: "Close days", owner: "Mira", baseline: 11, target: 7, period: "2027-Q2" } });
    expect(r.message).toBe("Added key result close-days-2");
    expect(existsSync(krPath(finance(repo), "close-days-2"))).toBe(true);
    expect(() => newKr({ id: "close-days", title: "Something else", owner: "Mira", baseline: 0, target: 5, period: "2027-Q2" }, finance(repo))).toThrow(
      "'close-days' is already used",
    );
  });

  it("a bet's review date that is not a real date says so, and a blank one says it is needed", () => {
    const repo = acmePlan();
    expect(() => newBet(betInput({ title: "Feb thirtieth", reviewOn: "2027-02-30" }), finance(repo))).toThrow("The review date is not a real date (YYYY-MM-DD)");
    expect(() => newBet(betInput({ title: "No date", reviewOn: "" }), finance(repo))).toThrow("A bet needs a review date (YYYY-MM-DD)");
  });

  it("the key result op refuses with neither an id nor a title", () => {
    const repo = acmePlan();
    expect(() => runOp(finance(repo), { op: "kr.new", args: { owner: "Mira", baseline: 0, target: 5, period: "2027-Q2" } })).toThrow("A key result needs a title");
  });
});

describe("a bet's title", () => {
  it("is set by bet.edit, keeps the id, and clears when blank", () => {
    const repo = acmePlan();
    const dir = finance(repo);
    const before = hash(readFileSync(betPath(dir, "inbox-match"), "utf8"));
    runOp(dir, { op: "bet.edit", target: { bet: "inbox-match" }, args: { title: "  Match payments  " }, expect: before });
    expect(loadBet(dir, "inbox-match").meta).toMatchObject({ id: "inbox-match", title: "Match payments" });
    const now = hash(readFileSync(betPath(dir, "inbox-match"), "utf8"));
    runOp(dir, { op: "bet.edit", target: { bet: "inbox-match" }, args: { title: "" }, expect: now });
    expect(loadBet(dir, "inbox-match").meta.title).toBeUndefined();
  });

  it("refuses a title over more than one line", () => {
    const repo = acmePlan();
    const dir = finance(repo);
    expect(() => editBet(dir, "inbox-match", { title: "Two\nlines" })).toThrow("A title is one line (no line breaks)");
  });

  it("is kept in the bet's file right after its id", () => {
    const repo = acmePlan();
    newBet(betInput({ id: "titled", title: "Titled bet" }), finance(repo));
    const head = readFileSync(betPath(finance(repo), "titled"), "utf8").split("\n").slice(0, 4);
    expect(head).toEqual(["---", "id: titled", "title: Titled bet", expect.stringMatching(/^owner: /)]);
  });
});

describe("the command line", () => {
  it("plan bet new takes --title, with the id optional", async () => {
    const repo = acmePlan();
    const made = await run(repo, "bet", "new", "--title", "Speed up checkout", "--in", "payments", "--owner", "Ana", "--hypothesis", "Quicker pays more", "--review", "2027-02-14");
    expect(made.code).toBe(0);
    expect(made.out).toContain("Wrote planning/groups/payments/bets/speed-up-checkout.md");
    expect(loadBet(payments(repo), "speed-up-checkout").meta.title).toBe("Speed up checkout");
  });

  it("plan kr new takes --title, with the id optional", async () => {
    const repo = acmePlan();
    const made = await run(repo, "kr", "new", "--title", "Close faster", "--in", "finance", "--period", "2027-Q2", "--owner", "Mira", "--baseline", "0", "--target", "5");
    expect(made.code).toBe(0);
    expect(made.out).toContain("Wrote planning/departments/finance/krs/close-faster.yaml");
  });

  it("plan kr new with neither an id nor a title says what it needs", async () => {
    const repo = acmePlan();
    const r = await run(repo, "kr", "new", "--in", "finance", "--period", "2027-Q2", "--owner", "Mira", "--baseline", "0", "--target", "5");
    expect(r.code).toBe(1);
    expect(r.out).toContain("A key result needs a title");
  });

  it("plan status shows a bet's title, and --json gives it (null when none)", async () => {
    const repo = acmePlan();
    await run(repo, "bet", "new", "--title", "Speed up checkout", "--in", "payments", "--owner", "Ana", "--hypothesis", "Quicker pays more", "--review", "2027-02-14");
    const text = await run(repo, "status", "--in", "payments");
    expect(text.out).toContain("speed-up-checkout — Speed up checkout · outcome: open");
    expect(text.out).toContain("faster-checkout — outcome: open");
    const json = JSON.parse((await run(repo, "status", "--json")).out);
    const bets = json.areas.flatMap((a: any) => a.bets);
    expect(bets.find((b: any) => b.id === "speed-up-checkout").title).toBe("Speed up checkout");
    expect(bets.find((b: any) => b.id === "faster-checkout").title).toBeNull();
  });
});

describe("the page model: names, choices and versions", () => {
  it("names every area, so the page can show names and not rels", () => {
    const repo = acmePlan();
    const page = areaPage(repo, findArea(repo, "finance"), { deliveries: planDeliveries(repo), now: NOW });
    expect(page.names).toEqual({
      company: "Acme",
      "departments/finance": "Finance",
      "groups/payments": "Payments",
      "teams/WEB": "Checkout web",
    });
  });

  it("a department's key result choices: aimKrs is every key result, alignKrs only those above", () => {
    const repo = acmePlan();
    const page = areaPage(repo, findArea(repo, "finance"), { deliveries: planDeliveries(repo), now: NOW });
    expect(page.choices.aimKrs).toEqual([
      { value: "revenue", label: "Revenue", area: "company" },
      { value: "close-days", label: "Close days", area: "departments/finance" },
    ]);
    expect(page.choices.alignKrs).toEqual([{ value: "revenue", label: "Revenue", area: "company" }]);
  });

  it("the company offers no key results to align to, and no bets", () => {
    const repo = acmePlan();
    const page = areaPage(repo, findArea(repo, "company"), { deliveries: planDeliveries(repo), now: NOW });
    expect(page.choices.alignKrs).toEqual([]);
    expect(page.choices.alignBets).toEqual([]);
    expect(page.choices.periods).toEqual([]);
  });

  it("alignBets: a bet offers the bets in levels above it, and labels one without a title by its id", () => {
    const repo = acmePlan();
    const group = areaPage(repo, findArea(repo, "payments"), { deliveries: planDeliveries(repo), now: NOW });
    expect(group.choices.alignBets.map((c) => c.value)).toEqual(["one-inbox", "inbox-match"]);
    expect(group.choices.alignBets.find((c) => c.value === "one-inbox")).toEqual({ value: "one-inbox", label: "one-inbox", area: "company" });
    const finance = areaPage(repo, findArea(repo, "finance"), { deliveries: planDeliveries(repo), now: NOW });
    expect(finance.choices.alignBets.map((c) => c.value)).toEqual(["one-inbox"]);
  });

  it("periods for a department: the page's quarter, the next ones in the year, and any with key results", () => {
    const repo = acmePlan();
    const page = areaPage(repo, findArea(repo, "finance"), { deliveries: planDeliveries(repo), now: NOW });
    expect(page.period).toBe("2027-Q1");
    expect(page.choices.periods).toEqual(["2027-Q1", "2027-Q2", "2027-Q3", "2027-Q4"]);
  });

  it("periods stop at the company's year: no 2028 quarter is offered after 2027-Q4", () => {
    const repo = acmePlan();
    newKr({ id: "late", title: "Late", owner: "Mira", baseline: 0, target: 1, period: "2027-Q4" }, finance(repo));
    const page = areaPage(repo, findArea(repo, "finance"), { deliveries: planDeliveries(repo), now: new Date("2027-11-10T12:00:00.000Z") });
    expect(page.period).toBe("2027-Q4");
    expect(page.choices.periods).toEqual(["2027-Q1", "2027-Q4"]);
  });

  it("periods hold each quarter with key results once, even one outside the next three", () => {
    const repo = acmePlan();
    newKr({ id: "third", title: "Third", owner: "Mira", baseline: 0, target: 1, period: "2027-Q3" }, finance(repo));
    // Today is before the year, so the page shows the latest quarter with key results: 2027-Q3.
    const page = areaPage(repo, findArea(repo, "finance"), { deliveries: planDeliveries(repo), now: NOW });
    expect(page.period).toBe("2027-Q3");
    expect(page.choices.periods).toEqual(["2027-Q1", "2027-Q3", "2027-Q4"]);
  });

  it("with no key results in the year yet, the quarters start at the year's first, not today's quarter", () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-periods-"));
    initPlanRepo(dir, { name: "Acme", year: "2090" });
    addArea(dir, "department", "finance", { name: "Finance", owner: "Mira" });
    const page = areaPage(dir, findArea(dir, "finance"), { deliveries: planDeliveries(dir), now: NOW });
    expect(page.period).toBeUndefined();
    expect(page.choices.periods).toEqual(["2090-Q1", "2090-Q2", "2090-Q3", "2090-Q4"]);
  });

  it("objectives are the ones already written in the area, once each", () => {
    const repo = acmePlan();
    editKr(finance(repo), "close-days", { objective: "Close the books faster" });
    const page = areaPage(repo, findArea(repo, "finance"), { deliveries: planDeliveries(repo), now: NOW });
    expect(page.choices.objectives).toEqual(["Close the books faster"]);
  });

  it("a bet carries its title, file version and confidence, and a key result its file version", () => {
    const repo = acmePlan();
    const dir = finance(repo);
    const page = areaPage(repo, findArea(repo, "finance"), { deliveries: planDeliveries(repo), now: NOW });
    const bet = page.bets.find((b) => b.id === "inbox-match")!;
    expect(bet).toMatchObject({ confidence: "medium", version: hash(readFileSync(betPath(dir, "inbox-match"), "utf8")) });
    expect(bet.title).toBeUndefined();
    const kr = page.krs.find((k) => k.id === "close-days")!;
    expect(kr.version).toBe(hash(readFileSync(krPath(dir, "close-days"), "utf8")));
  });
});

describe("the save endpoint makes a key result from a title", () => {
  it("POST /api/op with no target makes the id from the title, and -2 when it is taken", async () => {
    const repo = acmePlan();
    const plan = await startPlanServe(repo, { port: 0, offline: true });
    open.push(plan);
    const body = {
      op: "kr.new",
      area: "departments/finance",
      args: { title: "Ship steps", owner: "Mira", baseline: 0, target: 4, period: "2027-Q2" },
      expect: "",
    };
    const first = await post(plan, "/api/op", body);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, message: "Added key result ship-steps", area: "departments/finance" });
    expect(first.body.changed).toEqual(["planning/departments/finance/krs/ship-steps.yaml"]);
    const second = await post(plan, "/api/op", body);
    expect(second.body.message).toBe("Added key result ship-steps-2");
    expect(loadKr(finance(repo), "ship-steps-2").data.period).toBe("2027-Q2");
  });

  it("POST /api/op for a bet with no target makes the id from the title", async () => {
    const repo = acmePlan();
    const plan = await startPlanServe(repo, { port: 0, offline: true });
    open.push(plan);
    const made = await post(plan, "/api/op", {
      op: "bet.new",
      area: "groups/payments",
      args: { title: "Shorter queue", owner: "Ana", hypothesis: "Shorter queues convert.", review_on: "2027-03-14", primary: "close-days" },
      expect: "",
    });
    expect(made.status).toBe(200);
    expect(made.body.message).toBe("Added bet shorter-queue");
    expect(loadBet(payments(repo), "shorter-queue").meta.title).toBe("Shorter queue");
  });
});

/** POST a JSON body to the plan server, with its token, and read the JSON answer. */
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

describe("refusals on the command line", () => {
  it("name the flag that gives the missing field, though the shared messages don't", async () => {
    const { withFlag } = await import("../src/plan/cli");
    expect(withFlag("A bet needs an owner")).toBe("A bet needs an owner (--owner)");
    expect(withFlag("A key result needs a due date (YYYY-MM-DD)")).toBe("A key result needs a due date (YYYY-MM-DD) (--by YYYY-MM-DD)");
    expect(withFlag("A review needs a reason")).toBe("A review needs a reason (--why)");
    expect(withFlag("There's no area called 'x'")).toBe("There's no area called 'x'");
  });
});
