import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { companyInit } from "../src/commands/start";
import { newBet } from "../src/planning/bets";
import { newKr } from "../src/planning/krs";
import { planningIssues } from "../src/planning/levels";
import { teamRepo, write, commitAll } from "./team-fixture";

const kr = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, owner: "Board", baseline: 1, target: 2, by: "2027-03-31", ...extra });
const bet = (id: string, extra: Record<string, unknown> = {}) => ({ id, owner: "Board", hypothesis: "We believe it.", reviewOn: "2027-02-14", ...extra });

/** A synced copy of a plan above, at a level, in the repo's cache (.nikos/upstream), with what it holds. */
function copyOf(root: string, repo: string, level: "company" | "department" | "group", opts: { bets?: string[]; krs?: string[] } = {}) {
  const dir = join(root, ".nikos/upstream", ...repo.split("/"));
  companyInit(dir, { name: repo, level, period: "Q1 2027" });
  mkdirSync(join(dir, "planning/krs"), { recursive: true });
  for (const id of opts.krs ?? []) writeFileSync(join(dir, "planning/krs", `${id}.yaml`), `id: ${id}\ntitle: ${id}\nowner: o\nbaseline: 1\ntarget: 2\noriginal_target: 2\nby: 2027-03-31\ncheckins: []\n`);
  for (const id of opts.bets ?? []) newBet(bet(id), dir);
  return dir;
}

/** A team repo that joins the given plans (planning/upstream.yaml) and has synced copies of them. */
function team(joins: string[]) {
  const t = teamRepo("acme/web-team", "Web");
  write(join(t, "nikos.team.yaml"), `format_version: 1\nname: Web\nrepo: acme/web-team\ngroups: []\nmembers: []\n`);
  write(join(t, "planning/upstream.yaml"), joins.map((r) => `- repo: ${r}\n`).join(""));
  commitAll(t, "team");
  return t;
}

describe("a team's bets align to the plans it joins", () => {
  it("allows a team's bet to align to a group's bet, and refuses a plan it doesn't join", () => {
    const t = team(["acme/payments-group"]);
    copyOf(t, "acme/payments-group", "group", { bets: ["checkout-speed"] });
    newBet(bet("web-speed", { alignsTo: ["acme/payments-group#checkout-speed"] }), t);
    expect(planningIssues(t)).toEqual([]);
    expect(() => newBet(bet("x", { alignsTo: ["acme/other-group#checkout-speed"] }), t)).toThrow(
      "acme/other-group#checkout-speed: acme/other-group isn't a plan this team joins (planning/upstream.yaml lists acme/payments-group)",
    );
  });

  it("refuses a team's bet aimed at a key result of a group, since a group has none", () => {
    const t = team(["acme/payments-group"]);
    copyOf(t, "acme/payments-group", "group", { krs: ["g-kr"] });
    expect(() => newBet(bet("x", { primary: "acme/payments-group#g-kr" }), t)).toThrow(/^Key results stop at department level, so a group plan has none/);
  });

  it("refuses planning kr new in a team repo, with the group's key-result wording", () => {
    const t = team(["acme/payments-plan"]);
    expect(() => newKr(kr("web-kr"), t)).toThrow(/^Key results stop at department level, so a team plan has none/);
  });
});

describe("a group aligns to any plan above it that it joins", () => {
  it("lets a group's bet align to a company bet, and refuses one that aligns to a plan at or below it", () => {
    const group = mkdtempSync(join(tmpdir(), "nikos-grp-"));
    companyInit(group, { name: "Payments group", level: "group", period: "Q1 2027", repo: "acme/payments-group" });
    write(join(group, "planning/upstream.yaml"), "- repo: acme/company-plan\n- repo: acme/payments-plan\n");
    copyOf(group, "acme/company-plan", "company", { bets: ["one-inbox"] });
    copyOf(group, "acme/payments-plan", "department", { bets: ["wallets"] });
    newBet(bet("apple-pay", { alignsTo: ["acme/company-plan#one-inbox"] }), group);
    newBet(bet("google-pay", { alignsTo: ["acme/payments-plan#wallets"] }), group);
    expect(planningIssues(group)).toEqual([]);
  });

  it("refuses a group's bet aimed at a group below or at its own level", () => {
    const dept = mkdtempSync(join(tmpdir(), "nikos-dept-"));
    companyInit(dept, { name: "Payments", level: "department", period: "Q1 2027", repo: "acme/payments-plan" });
    write(join(dept, "planning/upstream.yaml"), "- repo: acme/payments-group\n");
    copyOf(dept, "acme/payments-group", "group", { bets: ["checkout-speed"] });
    expect(() => newBet(bet("x", { alignsTo: ["acme/payments-group#checkout-speed"] }), dept)).toThrow(
      "acme/payments-group#checkout-speed: acme/payments-group is a group plan, and a department bet can only align to a plan above department",
    );
  });

  it("a company bet with refs is still refused: nothing sits above it", () => {
    const co = mkdtempSync(join(tmpdir(), "nikos-co-"));
    companyInit(co, { name: "Acme", period: "Q1 2027", repo: "acme/company-plan" });
    expect(() => newBet(bet("x", { alignsTo: ["acme/holding#big"] }), co)).toThrow("A company bet has no plan above it to align to");
  });
});
