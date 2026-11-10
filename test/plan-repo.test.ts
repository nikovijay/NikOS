// nikOS Plan, PR 1 of docs/rfcs/plan-and-spec.md: one planning repo per company, a folder for each
// level, ids unique within the company, the company by year and departments by quarter, and settings
// down the folders.
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { addArea, areaFor, chainOf, findArea, initPlanRepo, listAreas, periodEnd } from "../src/plan/repo";
import { planIssues, planStatus, runPlanRepo } from "../src/plan/cli";
import { newKr } from "../src/planning/krs";
import { newBet } from "../src/planning/bets";
import { setBetKrs } from "../src/planning/aligns";
import { areaOf, loadKr } from "../src/planning/model";
import { resolveSettings, setSetting } from "../src/lib/settings";
import { spawnSync } from "node:child_process";

const cli = (...args: string[]) =>
  spawnSync(process.execPath, ["--import", "tsx", join(__dirname, "..", "src/cli.ts"), ...args], { encoding: "utf8", env: { ...process.env, NIKOS_NO_VERSION_CHECK: "1" } });

const kr = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, owner: "Mira", baseline: 11, target: 7, by: "", ...extra });
const bet = (id: string, extra: Record<string, unknown> = {}) => ({ id, owner: "Sam", hypothesis: "We believe it.", reviewOn: "2027-02-14", ...extra });

/** Acme's planning repo: the company, the finance department, the payments group in it, and team WEB in payments. */
function acme() {
  const repo = mkdtempSync(join(tmpdir(), "nikos-planrepo-"));
  initPlanRepo(repo, { name: "Acme", year: "2027", pillars: ["Growth"] });
  addArea(repo, "department", "finance", { name: "Finance", owner: "Mira" });
  addArea(repo, "group", "payments", { name: "Payments", department: "finance" });
  addArea(repo, "team", "WEB", { name: "Checkout web", home: "payments" });
  const at = (ref: string) => findArea(repo, ref).dir;
  return { repo, at };
}

/** Run a CLI command, returning its exit code and what it printed. */
async function run(fn: (args: string[]) => Promise<number> | number, args: string[]) {
  const out: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
  const err = vi.spyOn(console, "error").mockImplementation((...a) => void out.push(a.join(" ")));
  try {
    return { code: await fn(args), out: out.join("\n") };
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
}

describe("a planning repo", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("has a folder for each level, and the folder is the level", () => {
    const { repo } = acme();
    expect(listAreas(repo).map((a) => `${a.rel}:${a.level}`)).toEqual(["company:company", "departments/finance:department", "groups/payments:group", "teams/WEB:team"]);
    expect(existsSync(join(repo, "planning/teams/WEB/team.yaml"))).toBe(true);
    expect(existsSync(join(repo, "planning/teams/WEB/plan.yaml"))).toBe(false);
    expect(chainOf(findArea(repo, "WEB")).map((a) => a.rel)).toEqual(["company", "departments/finance", "groups/payments", "teams/WEB"]);
    // --in takes the folder, or just the id; without it, the folder you're in.
    expect(findArea(repo, "departments/finance").rel).toBe("departments/finance");
    expect(findArea(repo, "web").rel).toBe("teams/WEB");
    expect(areaFor(repo, undefined, join(repo, "planning/groups/payments/bets"))?.rel).toBe("groups/payments");
    expect(areaFor(repo, undefined, repo)).toBeUndefined();
    expect(() => findArea(repo, "hr")).toThrow(/no area called 'hr'.*company, departments\/finance/);
    expect(areaOf(repo)).toBeUndefined();
  });

  it("plans the company by year and departments by quarter", () => {
    const { repo, at } = acme();
    newKr(kr("revenue", { baseline: 0, target: 60000 }), at("company"));
    const company = loadKr(at("company"), "revenue").data;
    expect(company).toMatchObject({ period: "2027", by: "2027-12-31" });
    newKr(kr("close-days", { period: "2027-Q1", alignsTo: ["revenue"], direction: "down" }), at("finance"));
    expect(loadKr(at("finance"), "close-days").data).toMatchObject({ period: "2027-Q1", by: "2027-03-31", aligns_to: "revenue" });
    expect(() => newKr(kr("no-quarter"), at("finance"))).toThrow("A department's key result needs a quarter: --period 2027-Q1");
    expect(() => newKr(kr("next-year", { period: "2028-Q2" }), at("finance"))).toThrow("2028-Q2 isn't in the company's year, 2027");
    expect(() => newKr(kr("q-company", { period: "2027-Q1" }), at("company"))).toThrow("A company key result is for the company's year, 2027, not 2027-Q1");
    expect(periodEnd("2027-Q2")).toBe("2027-06-30");
    expect(periodEnd("2028-Q1")).toBe("2028-03-31");
    // A department may only have a period on its key results, not on its plan.
    writeFileSync(join(at("finance"), "plan.yaml"), "name: Finance\nperiod: '2027'\n");
    expect(planIssues(repo).map((i) => i.message)).toContainEqual(expect.stringContaining("Only the company has a period"));
  });

  it("keeps key results at the company and departments", () => {
    const { at } = acme();
    for (const area of ["payments", "WEB"]) expect(() => newKr(kr("x", { period: "2027-Q1" }), at(area))).toThrow(/Key results stop at department level/);
  });

  it("keeps ids unique within the company", () => {
    const { repo, at } = acme();
    newKr(kr("revenue", { baseline: 0, target: 1 }), at("company"));
    newBet(bet("one-inbox", { primary: "revenue" }), at("company"));
    expect(() => newBet(bet("revenue"), at("WEB"))).toThrow("'revenue' is already used: it's a key result in company. Ids are unique within the company.");
    expect(() => newKr(kr("one-inbox", { period: "2027-Q1" }), at("finance"))).toThrow("'one-inbox' is already used: it's a bet in company.");
    expect(() => addArea(repo, "group", "finance", { name: "Dup" })).toThrow("'finance' is already used: it's the id of departments/finance.");
    expect(() => addArea(repo, "department", "web", { name: "Web" })).toThrow("it's the id of teams/WEB");
    // A clash made by hand is found by validate.
    mkdirSync(join(at("WEB"), "bets"), { recursive: true });
    writeFileSync(join(at("WEB"), "bets/one-inbox.md"), readFileSync(join(at("company"), "bets/one-inbox.md"), "utf8"));
    expect(planIssues(repo).map((i) => i.message)).toContainEqual("'one-inbox' is used twice: a bet in company, and a bet in teams/WEB. Ids are unique within the company.");
  });

  it("links by id inside the repo, only to things above", () => {
    const { repo, at } = acme();
    newKr(kr("revenue", { baseline: 0, target: 1 }), at("company"));
    newKr(kr("close-days", { period: "2027-Q1", direction: "down" }), at("finance"));
    newBet(bet("one-inbox", { primary: "revenue" }), at("company"));
    newBet(bet("inbox-match", { primary: "close-days", alignsTo: ["one-inbox"] }), at("finance"));
    newBet(bet("faster-checkout", { primary: "close-days", alignsTo: ["inbox-match"] }), at("payments"));
    // A team may align to any department's or group's bet, and aim at company or department key results.
    newBet(bet("web-bet", { primary: "revenue", also: ["close-days"], alignsTo: ["faster-checkout", "inbox-match"] }), at("WEB"));
    expect(planIssues(repo)).toEqual([]);
    expect(() => newBet(bet("down", { alignsTo: ["faster-checkout"] }), at("finance"))).toThrow("faster-checkout is in groups/payments, which isn't above departments/finance");
    expect(() => newBet(bet("same", { alignsTo: ["one-inbox"] }), at("company"))).toThrow("A company bet has nothing above it to align to");
    expect(() => newBet(bet("by-repo", { alignsTo: ["acme/plan#one-inbox"] }), at("payments"))).toThrow("name the bet by its id alone: 'one-inbox'");
    expect(() => newBet(bet("kr-as-bet", { alignsTo: ["revenue"] }), at("payments"))).toThrow("revenue is a key result: a bet aligns to bets");
    expect(() => newBet(bet("ghost", { primary: "nope" }), at("payments"))).toThrow("There's no key result called 'nope'");
    expect(() => newKr(kr("dept-kr", { period: "2027-Q2", alignsTo: ["one-inbox"] }), at("finance"))).toThrow("one-inbox is a bet: a key result aligns to key results");
    // The bet's key results are set by id, wherever they are.
    setBetKrs(at("payments"), "faster-checkout", { primary: "revenue", also: ["close-days"] });
    expect(planIssues(repo)).toEqual([]);
  });

  it("checks each level's own file", () => {
    const { repo, at } = acme();
    writeFileSync(join(at("WEB"), "team.yaml"), "name: Checkout web\nhome: nowhere\n");
    writeFileSync(join(at("WEB"), "plan.yaml"), "name: Web\n");
    writeFileSync(join(at("payments"), "plan.yaml"), "name: Payments\ndepartment: sales\nobjectives:\n  - id: o1\n    title: Grow\n");
    writeFileSync(join(at("company"), "plan.yaml"), "name: Acme\nperiod: Q1 2027\n");
    const messages = planIssues(repo).map((i) => `${i.file}: ${i.message}`);
    expect(messages).toEqual(
      expect.arrayContaining([
        "planning/teams/WEB/team.yaml: home: there's no department or group called 'nowhere'",
        "planning/teams/WEB/plan.yaml: A team has no plan.yaml: its name, home and members are in team.yaml",
        "planning/groups/payments/plan.yaml: department: there's no department called 'sales'",
        "planning/groups/payments/plan.yaml: Objectives stop at department level, so a group has none",
        expect.stringMatching(/^planning\/company\/plan.yaml: The company plans by year/),
      ]),
    );
  });

  it("takes settings down the folders, and keeps what the company locked", () => {
    const { repo, at } = acme();
    writeFileSync(join(repo, "nikos.settings.yaml"), "format_version: 1\napproval:\n  policy: required-for-release\ntracker:\n  system: linear\nlocked: [tracker.system]\n");
    writeFileSync(join(at("finance"), "settings.yaml"), "format_version: 1\napproval:\n  policy: optional\n");
    const web = resolveSettings(at("WEB"));
    expect(web["approval.policy"]).toEqual({ value: "optional", from: "departments/finance" });
    expect(web["tracker.system"]).toEqual({ value: "linear", from: "company", lockedBy: "company" });
    expect(resolveSettings(at("company"))["approval.policy"].from).toBe("company");
    // A level changes what nobody above it locked, in its own settings.yaml.
    setSetting(at("payments"), "approval.policy", "off");
    expect(parse(readFileSync(join(at("payments"), "settings.yaml"), "utf8")).approval.policy).toBe("off");
    expect(resolveSettings(at("WEB"))["approval.policy"]).toEqual({ value: "off", from: "groups/payments" });
    expect(() => setSetting(at("WEB"), "tracker.system", "jira")).toThrow("tracker.system is locked by company");
  });
});

describe("nikos plan", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("sets up the repo and its areas, and works in --in or the folder you're in", async () => {
    const repo = mkdtempSync(join(tmpdir(), "nikos-plancli-"));
    const plan = (...args: string[]) => run(runPlanRepo, [...args, "--dir", repo]);
    expect((await plan("init", "--name", "Acme")).out).toContain("The company plans by year: give one as --year");
    expect((await plan("init", "--name", "Acme", "--year", "2027")).code).toBe(0);
    expect((await plan("add", "department", "finance", "--name", "Finance")).out).toBe("Added planning/departments/finance/plan.yaml");
    expect((await plan("add", "team", "WEB", "--name", "Web")).out).toContain("A team reports to a department or group: --home <id>");
    expect((await plan("add", "team", "WEB", "--name", "Web", "--home", "finance")).code).toBe(0);
    const krNew = await plan("kr", "new", "close-days", "--in", "finance", "--title", "Median days to close", "--owner", "Mira", "--baseline", "11", "--target", "7", "--period", "2027-Q1", "--direction", "down");
    expect(krNew.out).toBe("Wrote planning/departments/finance/krs/close-days.yaml");
    expect((await plan("bet", "new", "nowhere", "--owner", "A", "--hypothesis", "H", "--review", "2027-02-01")).out).toContain("Say where the bet goes with --in");
    // In an area's folder, --in isn't needed.
    const inFolder = await run(runPlanRepo, ["bet", "new", "auto-match", "--owner", "Sam", "--hypothesis", "H", "--review", "2027-02-01", "--kr", "close-days", "--dir", join(repo, "planning/departments/finance")]);
    expect(inFolder.out).toBe("Wrote planning/departments/finance/bets/auto-match.md");
    // Check-ins and reviews find the key result or bet by its id.
    expect((await plan("checkin", "close-days", "10")).out).toBe("Wrote planning/departments/finance/krs/close-days.yaml");
    expect((await plan("bet", "review", "auto-match", "continue", "--why", "On track")).out).toBe("Wrote planning/departments/finance/bets/auto-match.md");
    const status = (await plan("status")).out;
    expect(status).toContain("company — Acme (2027)");
    expect(status).toContain("close-days — Median days to close: 10 on 2026-11-09 (baseline 11, target 7 by 2027-03-31) · 2027-Q1 · should go down");
    expect(status).toContain("teams/WEB — Web · reports to departments/finance");
    expect((await plan("status", "--in", "WEB")).out).toBe("teams/WEB — Web · reports to departments/finance\n  Bets: none");
    expect((await plan("validate")).out).toBe("✓ The plan for 2027 is valid — 3 areas, 1 key result, 1 bet");
    expect((await plan("stats")).out).toContain("Did you mean: nikos plan status?");
  });

  it("is reached from the main command, next to plan new for a story", () => {
    const repo = mkdtempSync(join(tmpdir(), "nikos-planmain-"));
    initPlanRepo(repo, { name: "Acme", year: "2027" });
    expect(cli("plan", "status", "--dir", repo).stdout).toContain("company — Acme (2027)");
    expect(cli("plan", "new").stderr).toContain("Usage: nikos plan new <story-id>");
    expect(cli("plan", "--help").stdout).toContain("nikos plan: the company's plan, in one planning repo");
  });

  it("lets a key result align to several key results above it, and one stays a single reference", () => {
    const { repo, at } = acme();
    newKr(kr("revenue", { baseline: 0, target: 1 }), at("company"));
    newKr(kr("margin", { baseline: 0, target: 1 }), at("company"));
    newKr(kr("pay-1", { period: "2027-Q2", alignsTo: ["revenue", "margin"], direction: "down" }), at("finance"));
    expect(loadKr(at("finance"), "pay-1").data.aligns_to).toEqual(["revenue", "margin"]);
    expect(readFileSync(join(at("finance"), "krs/pay-1.yaml"), "utf8")).toContain("aligns_to: [revenue, margin]");
    newKr(kr("pay-2", { period: "2027-Q2", alignsTo: "revenue", direction: "down" }), at("finance"));
    expect(loadKr(at("finance"), "pay-2").data.aligns_to).toBe("revenue");
    expect(planIssues(repo)).toEqual([]);
  });

  it("won't make a planning repo over an old plan", () => {
    const repo = mkdtempSync(join(tmpdir(), "nikos-planover-"));
    mkdirSync(join(repo, "planning"));
    writeFileSync(join(repo, "planning/plan.yaml"), "name: Old\nlevel: company\nperiod: Q1\npillars: []\n");
    expect(() => initPlanRepo(repo, { name: "Acme", year: "2027" })).toThrow("This repo has a plan of the old kind");
  });
});
