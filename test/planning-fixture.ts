// Fixtures for the planning tests: a company's planning repo on origin, and a bare origin for the git flow.
// Real git repos, so ls-remote, branches and commits run for real.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initPlanRepo } from "../src/plan/repo";
import { newKr } from "../src/planning/krs";
import { commitAll, git } from "./repo-fixture";

export { git, write, commitAll, groupRepo, codeRepo } from "./repo-fixture";

// The git identity the dashboard and nikos apply commit with is set in repo-fixture.

/** A company's planning repo on origin acme/company-plan, with one key result: kr-1. */
export function companyRepo(): string {
  const co = mkdtempSync(join(tmpdir(), "nikos-co-"));
  git(co, "init", "-q", "-b", "main");
  git(co, "remote", "add", "origin", "https://github.com/acme/company-plan.git");
  initPlanRepo(co, { name: "Acme", year: "2027" });
  newKr({ id: "kr-1", title: "Grow revenue", owner: "Board", baseline: 1, target: 2, by: "2027-03-31" }, join(co, "planning", "company"));
  commitAll(co, "company");
  return co;
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
