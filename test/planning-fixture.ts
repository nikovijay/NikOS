// Fixtures for the planning dashboard tests: a company plan, a department that synced it, and a
// bare origin for the git flow. Real git repos, so ls-remote, branches and commits run for real.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { companyInit } from "../src/commands/start";
import { joinPlan } from "../src/commands/join";
import { newKr } from "../src/planning/krs";
import { sync } from "../src/planning/upstream";
import { commitAll, git, write } from "./team-fixture";

export { git, write, commitAll, groupRepo, teamRepo } from "./team-fixture";

// The git identity the dashboard and nikos apply commit with is set in team-fixture.

/** A company plan on origin acme/company-plan, with one key result: kr-1. */
export function companyRepo(): string {
  const co = mkdtempSync(join(tmpdir(), "nikos-co-"));
  git(co, "init", "-q", "-b", "main");
  git(co, "remote", "add", "origin", "https://github.com/acme/company-plan.git");
  companyInit(co, { name: "Acme", period: "Q1 2027", repo: "acme/company-plan" });
  newKr({ id: "kr-1", title: "Grow revenue", owner: "Board", baseline: 1, target: 2, by: "2027-03-31" }, co);
  commitAll(co, "company");
  return co;
}

/** A department plan on origin acme/payments-plan that joined `co` and synced its copy. */
export function departmentRepo(co: string): string {
  const dept = mkdtempSync(join(tmpdir(), "nikos-dept-"));
  git(dept, "init", "-q", "-b", "main");
  git(dept, "remote", "add", "origin", "https://github.com/acme/payments-plan.git");
  companyInit(dept, { name: "Payments", period: "Q1 2027", repo: "acme/payments-plan", level: "department" });
  write(join(dept, "planning/upstream.yaml"), `- repo: acme/company-plan\n  url: ${co}\n`);
  joinPlan(dept, { repo: "acme/company-plan" });
  sync(dept);
  commitAll(dept, "department");
  return dept;
}

/** A bare repo to push to, as origin. */
export function bareOrigin(): string {
  const dir = mkdtempSync(join(tmpdir(), "nikos-origin-"));
  git(dir, "init", "-q", "--bare", "-b", "main");
  return dir;
}

/** Read a repo file as text. */
export const readText = (dir: string, path: string) => readFileSync(join(dir, path), "utf8");

/** Today's date, as the commands stamp it. */
export const todayIso = () => new Date().toISOString().slice(0, 10);
