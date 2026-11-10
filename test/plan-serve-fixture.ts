// A planning repo for the plan serve tests: the company, a finance department with a quarterly key result
// and a check-in, a payments group and a WEB team, with bets at each level. Pass a code repo's path to list
// it in planning/repos.yaml, read by refresh.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addArea, findArea, initPlanRepo } from "../src/plan/repo";
import { newBet } from "../src/planning/bets";
import { checkIn, newKr } from "../src/planning/krs";
import { write } from "./repo-fixture";

export function acmePlan(listed?: string): string {
  const repo = mkdtempSync(join(tmpdir(), "nikos-serve-plan-"));
  initPlanRepo(repo, { name: "Acme", year: "2027" });
  addArea(repo, "department", "finance", { name: "Finance", owner: "Mira" });
  addArea(repo, "group", "payments", { name: "Payments", department: "finance" });
  addArea(repo, "team", "WEB", { name: "Checkout web", home: "payments" });
  const at = (ref: string) => findArea(repo, ref).dir;
  newKr({ id: "revenue", title: "Revenue", owner: "Mira", baseline: 0, target: 60000, by: "2027-12-31" }, at("company"));
  newKr({ id: "close-days", title: "Close days", owner: "Mira", baseline: 11, target: 7, by: "2027-03-31", period: "2027-Q1", direction: "down" }, at("finance"));
  checkIn(at("finance"), "close-days", { value: 9, date: "2026-11-09" });
  newBet({ id: "one-inbox", owner: "Sam", hypothesis: "One inbox cuts close time.", reviewOn: "2027-02-14", primary: "revenue" }, at("company"));
  newBet({ id: "inbox-match", owner: "Sam", hypothesis: "Matching cuts close time.", reviewOn: "2027-02-14", primary: "close-days", alignsTo: ["one-inbox"] }, at("finance"));
  newBet({ id: "faster-checkout", owner: "Ana", hypothesis: "Checkout is quicker.", reviewOn: "2027-02-14", primary: "close-days", alignsTo: ["inbox-match"] }, at("payments"));
  newBet({ id: "web-bet", owner: "Ana", hypothesis: "Web checkout sells more.", reviewOn: "2027-02-14", primary: "close-days", alignsTo: ["faster-checkout"] }, at("WEB"));
  if (listed !== undefined) write(join(repo, "planning/repos.yaml"), `version: 1\nrepos:\n  - repo: acme/payments-web\n    host: github.com\n    url: "${listed}"\n`);
  return repo;
}
