import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { companyInit } from "../src/commands/start";
import { newBet, reviewBet } from "../src/planning/bets";
import { formatRollout, rollout } from "../src/planning/rollout";
import { loadBet } from "../src/planning/model";
import { planningData } from "../src/planning/server";
import { git, write, groupRepo, commitAll } from "./repo-fixture";

/** A company plan, a department plan with a bet, and a group that joined the department and aims a bet at it. */
function chain(stop: boolean) {
  const co = mkdtempSync(join(tmpdir(), "nikos-co-"));
  git(co, "init", "-q", "-b", "main");
  git(co, "remote", "add", "origin", "https://github.com/acme/company-plan.git");
  companyInit(co, { name: "Acme", period: "Q1 2027", repo: "acme/company-plan" });
  commitAll(co, "company");

  const dept = mkdtempSync(join(tmpdir(), "nikos-dept-"));
  git(dept, "init", "-q", "-b", "main");
  git(dept, "remote", "add", "origin", "https://github.com/acme/payments-plan.git");
  companyInit(dept, { name: "Payments", level: "department", period: "Q1 2027", repo: "acme/payments-plan" });
  newBet({ id: "manual-queue", owner: "Payments", hypothesis: "We believe a manual queue helps.", reviewOn: "2027-02-14" }, dept);
  if (stop) reviewBet(dept, "manual-queue", { decision: "stop", reason: "Cheaper ways exist", date: "2027-02-01", expect: loadBet(dept, "manual-queue").hash });
  commitAll(dept, "dept");

  const grp = groupRepo("PAY");
  git(grp, "remote", "add", "origin", "https://github.com/acme/payments-group.git");
  write(join(grp, "planning/upstream.yaml"), `- repo: acme/payments-plan\n  url: ${dept}\n`);
  write(
    join(grp, "planning/bets/apple-pay.md"),
    "---\nid: apple-pay\nowner: Payments group\nhypothesis: We believe Apple Pay lifts conversion.\nkrs:\n  also: []\naligns_to: acme/payments-plan#manual-queue\nreview_on: 2027-02-14\nconfidence: medium\ndependencies: []\noutcome: open\nreviews: []\n---\n\n## Why we think so\nEvidence.\n",
  );
  commitAll(grp, "group");

  write(join(dept, "planning/downstream.yaml"), `- name: Checkout\n  repo: acme/payments-group\n  url: ${grp}\n`);
  commitAll(dept, "downstream");
  write(join(co, "planning/downstream.yaml"), `- name: Payments\n  repo: acme/payments-plan\n  url: ${dept}\n`);
  commitAll(co, "downstream");
  return { co, grp };
}

describe("a bet aimed at a stopped bet", () => {
  it("is flagged in the rollout, with the stop date, and the text says so", () => {
    const { co } = chain(true);
    const r = rollout(co);
    const apple = r.plans.flatMap((p) => p.bets).find((b) => b.id === "apple-pay")!;
    expect(apple.stoppedParent).toEqual({ target: "acme/payments-plan#manual-queue", date: "2027-02-01" });
    expect(formatRollout(r)).toContain("aligns to acme/payments-plan#manual-queue, which was stopped on 2027-02-01");
  });

  it("is flagged in the dashboard data too, from the same rollout", () => {
    const { co } = chain(true);
    rollout(co); // fetches the copies the dashboard reads
    const down = planningData(co).downstream!;
    const apple = down.plans.flatMap((p) => p.bets).find((b) => b.id === "apple-pay")!;
    expect(apple.stoppedParent?.date).toBe("2027-02-01");
  });

  it("nothing cascades: the aimed-at bet keeps its outcome, and nothing is written to it", () => {
    const { co, grp } = chain(true);
    const r = rollout(co);
    const apple = r.plans.flatMap((p) => p.bets).find((b) => b.id === "apple-pay")!;
    expect(apple.outcome).toBe("open");
    expect(loadBet(grp, "apple-pay").meta.outcome).toBe("open");
  });

  it("is not flagged while the parent is open", () => {
    const { co } = chain(false);
    const r = rollout(co);
    const apple = r.plans.flatMap((p) => p.bets).find((b) => b.id === "apple-pay")!;
    expect(apple.stoppedParent).toBeUndefined();
    expect(formatRollout(r)).not.toMatch(/which was stopped/);
  });
});
