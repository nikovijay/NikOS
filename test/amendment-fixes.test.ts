// The review fixes to the amendment build: a stopped bet in the root plan flags what aims at it, the
// dashboard views flag a bet aimed at a stopped one, and a delivery summary is rewritten on each run.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { companyInit } from "../src/commands/start";
import { joinPlan } from "../src/commands/join";
import { doctor } from "../src/commands/doctor";
import { newBet, reviewBet } from "../src/planning/bets";
import { formatRollout, rollout } from "../src/planning/rollout";
import { loadBet } from "../src/planning/model";
import { planningData } from "../src/planning/server";
import { okrsAndBets } from "../src/planning/views";
import { writeDeliverySummary, readDeliverySummary, type DeliverySummary } from "../src/lib/delivery-summary";
import { resolveSettings } from "../src/lib/settings";
import { git, write, commitAll } from "./repo-fixture";

const root = join(__dirname, "..");
const cli = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", join(root, "src/cli.ts"), ...args], { encoding: "utf8" });
const tmp = (name: string) => mkdtempSync(join(tmpdir(), `nikos-${name}-`));

/** A company plan repo with an origin, so its own path is acme/company-plan. */
function companyRepo(stopBig = false) {
  const co = tmp("co");
  git(co, "init", "-q", "-b", "main");
  git(co, "remote", "add", "origin", "https://github.com/acme/company-plan.git");
  companyInit(co, { name: "Acme", period: "Q1 2027", repo: "acme/company-plan" });
  newBet({ id: "big-bet", owner: "Acme", hypothesis: "We believe a big bet pays.", reviewOn: "2027-02-14" }, co);
  if (stopBig) reviewBet(co, "big-bet", { decision: "stop", reason: "Too slow", date: "2027-02-01", expect: loadBet(co, "big-bet").hash });
  commitAll(co, "company");
  return co;
}

/** A department plan with one bet aimed at the company's big-bet. */
function deptRepo(aimAt = "acme/company-plan#big-bet") {
  const dept = tmp("dept");
  git(dept, "init", "-q", "-b", "main");
  git(dept, "remote", "add", "origin", "https://github.com/acme/payments-plan.git");
  companyInit(dept, { name: "Payments", level: "department", period: "Q1 2027", repo: "acme/payments-plan" });
  write(
    join(dept, "planning/bets/pay-bet.md"),
    `---\nid: pay-bet\nowner: Payments\nhypothesis: We believe a card pay lifts conversion.\nkrs:\n  also: []\naligns_to: ${aimAt}\nreview_on: 2027-02-14\nconfidence: medium\ndependencies: []\noutcome: open\nreviews: []\n---\n\n## Why we think so\nEvidence.\n`,
  );
  commitAll(dept, "dept");
  return dept;
}

describe("a stopped bet in the root plan flags what aims at it", () => {
  it("flags a department bet aimed at a bet the company itself stopped, in the company's rollout", () => {
    const co = companyRepo(true);
    const dept = deptRepo();
    write(join(co, "planning/downstream.yaml"), `- name: Payments\n  repo: acme/payments-plan\n  url: ${dept}\n`);
    commitAll(co, "downstream");
    const r = rollout(co);
    const pay = r.plans.flatMap((p) => p.bets).find((b) => b.id === "pay-bet")!;
    expect(pay.stoppedParent).toEqual({ target: "acme/company-plan#big-bet", date: "2027-02-01" });
    expect(formatRollout(r)).toContain("aligns to acme/company-plan#big-bet, which was stopped on 2027-02-01");
  });

  it("flags a bet the viewing plan owns when it aims at a stopped bet above, on the OKRs and bets page", () => {
    const co = companyRepo(true);
    const dept = deptRepo();
    // The department copies the company's bets, so its own page can see the bet above is stopped.
    write(join(dept, "planning/upstream.yaml"), `- repo: acme/company-plan\n  url: ${co}\n`);
    commitAll(dept, "upstream");
    joinPlan(dept, { repo: "acme/company-plan" });
    const page = okrsAndBets(planningData(dept));
    const above = page.betsAbove.find((b: any) => b.ref === "acme/company-plan#big-bet")!;
    expect(above.stoppedOn).toBe("2027-02-01");
    const own = page.bets.find((b: any) => b.id === "pay-bet")!;
    expect(own.stoppedParent).toEqual({ target: "acme/company-plan#big-bet", date: "2027-02-01" });
    expect(own.note).toBe("aligns to acme/company-plan#big-bet, which was stopped on 2027-02-01");
  });
});

describe("a bet's delivery says how old the summary it counts is", () => {
  it("adds the summary's age to the bet line, as the plan line does", () => {
    const co = companyRepo();
    const grp = tmp("grp");
    git(grp, "init", "-q", "-b", "main");
    git(grp, "remote", "add", "origin", "https://github.com/acme/payments-group.git");
    write(join(grp, "planning/plan.yaml"), "name: Payments group\nlevel: group\nkey: PAY\n");
    write(join(grp, "maps/chk/storymap.yaml"), "format_version: 1\nproject: chk\nkey: CHK\nbet: pay-card\nactivities: []\nreleases:\n  - number: 1\n    title: First\n    stories: [PAY-CHK-1]\n");
    const old = new Date(Date.now() - 3 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const summary: DeliverySummary = { format_version: 1, map: "chk", owner: "PAY", read_at: old, stories: [{ id: "PAY-CHK-1", status: "done", approval: "none", read_at: old }] };
    writeDeliverySummary(join(grp, "maps/chk"), summary);
    commitAll(grp, "map");
    write(join(co, "planning/downstream.yaml"), `- name: Payments\n  repo: acme/payments-group\n  url: ${grp}\n`);
    commitAll(co, "downstream");
    // The group's bet, aimed at the company's (no department in between).
    write(
      join(grp, "planning/bets/pay-card.md"),
      "---\nid: pay-card\nowner: Payments\nhypothesis: We believe cards pay.\nkrs:\n  also: []\naligns_to: acme/company-plan#big-bet\nreview_on: 2027-02-14\nconfidence: medium\ndependencies: []\noutcome: open\nreviews: []\n---\n\nEvidence.\n",
    );
    commitAll(grp, "bet");
    const r = rollout(co);
    const bet = r.plans.find((p) => p.name === "Payments")!.bets.find((b) => b.id === "pay-card");
    expect(bet?.delivery).toMatch(/^Shipped, 1 of 1 done, read 3 days ago \(\d{4}-\d{2}-\d{2}\)/);
    expect(readDeliverySummary(join(grp, "maps/chk"))?.read_at).toBe(old);
  });
});

describe("a delivery summary is rewritten on each run", () => {
  it("writes the same map's summary twice without an EEXIST, and the second read_at wins", () => {
    const dir = tmp("sum");
    write(join(dir, "maps/am/README.md"), "");
    const base = { format_version: 1 as const, map: "am", owner: "PAY" };
    writeDeliverySummary(join(dir, "maps/am"), { ...base, read_at: "2027-01-01T00:00:00Z", stories: [] });
    expect(() => writeDeliverySummary(join(dir, "maps/am"), { ...base, read_at: "2027-01-02T00:00:00Z", stories: [] })).not.toThrow();
    expect(readDeliverySummary(join(dir, "maps/am"))?.read_at).toBe("2027-01-02T00:00:00Z");
  });
});
