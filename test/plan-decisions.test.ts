// Decisions in a planning repo: each area keeps its own decisions.md, and nikos decide takes --in (or the
// folder you're in). doctor on a planning repo checks the plan, the code repos it lists, and decisions.
import { describe, it, expect, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide, runDecide } from "../src/commands/decide";
import { doctor } from "../src/commands/doctor";
import { init } from "../src/commands/init";
import { acmePlan } from "./plan-serve-fixture";

/** runDecide with its output captured. */
function capture(args: string[]) {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const code = runDecide(args);
  const out = log.mock.calls.map((c) => c.join(" ")).join("\n");
  const err = error.mock.calls.map((c) => c.join(" ")).join("\n");
  log.mockRestore();
  error.mockRestore();
  return { code, out, err };
}

describe("decisions in a planning repo", () => {
  it("writes the company's decisions.md by default, and an area's with area", () => {
    const plan = acmePlan();
    decide({ title: "Revenue is the one company key result", why: "One number everyone can see.", date: "2027-01-05" }, plan);
    const company = readFileSync(join(plan, "planning/company/decisions.md"), "utf8");
    expect(company).toContain("## 2027-01-05 — Revenue is the one company key result");
    expect(existsSync(join(plan, "decisions.md"))).toBe(false);

    decide({ title: "Close in ten days", why: "Faster month end.", date: "2027-01-06", area: "finance" }, plan);
    decide({ title: "Same area by its path", why: "Same place.", date: "2027-01-07", area: "departments/finance" }, plan);
    const finance = readFileSync(join(plan, "planning/departments/finance/decisions.md"), "utf8");
    expect(finance).toMatch(/^# Decisions\n/);
    expect(finance).toContain("## 2027-01-06 — Close in ten days");
    expect(finance).toContain("## 2027-01-07 — Same area by its path");
    expect(readFileSync(join(plan, "planning/company/decisions.md"), "utf8")).not.toContain("Close in ten days");
  });

  it("refuses an area that doesn't exist, and --in in a code repo", () => {
    const plan = acmePlan();
    expect(() => decide({ title: "x", why: "y", area: "nowhere" }, plan)).toThrow("There's no area called 'nowhere'");
    const code = mkdtempSync(join(tmpdir(), "nikos-dec-code-"));
    init(code, { name: "Tip Calc", key: "TC" });
    expect(() => decide({ title: "x", why: "y", area: "finance" }, code)).toThrow("--in names an area of a planning repo, and this isn't one");
  });

  it("nikos decide takes --in, or the folder you're in, and says which file it wrote", () => {
    const plan = acmePlan();
    const byFlag = capture(["Close in ten days", "--why", "Faster month end.", "--in", "finance", "--dir", plan]);
    expect(byFlag.code).toBe(0);
    expect(byFlag.out).toBe("Added to planning/departments/finance/decisions.md: Close in ten days");
    const byFolder = capture(["Hire a closer", "--why", "More hands.", "--dir", join(plan, "planning/departments/finance")]);
    expect(byFolder.out).toBe("Added to planning/departments/finance/decisions.md: Hire a closer");
    const company = capture(["Revenue first", "--why", "One number.", "--dir", plan]);
    expect(company.out).toBe("Added to planning/company/decisions.md: Revenue first");
    expect(readFileSync(join(plan, "planning/departments/finance/decisions.md"), "utf8")).toContain("— Hire a closer");
  });

  it("a code repo's decide is unchanged, and --in is refused there", () => {
    const code = mkdtempSync(join(tmpdir(), "nikos-dec-repo-"));
    init(code, { name: "Tip Calc", key: "TC" });
    expect(capture(["Use cards only", "--why", "Most buyers pay by card.", "--dir", code]).out).toBe("Added to decisions.md: Use cards only");
    expect(capture(["Use wallets", "--why", "Later.", "--in", "finance", "--dir", code]).err).toContain("--in names an area of a planning repo, and this isn't one");
  });
});

describe("doctor on a planning repo", () => {
  it("checks the plan, the code repos it lists, and the company's decisions", () => {
    const plan = acmePlan();
    const checks = doctor(plan, { offline: true });
    expect(checks.map((c) => `${c.status} ${c.name}`)).toEqual(["ok plan", "ok code repos", "ok decisions"]);
    expect(checks[0].found).toBe("4 areas, 2 key results, 4 bets");
    expect(checks[1].found).toBe("none listed yet in planning/repos.yaml");
    expect(checks[2].found).toBe("none recorded yet");
    decide({ title: "Revenue first", why: "One number.", date: "2027-01-05" }, plan);
    expect(doctor(plan, { offline: true })[2].found).toBe("1 decision in planning/company/decisions.md");
  });

  it("says how many listed code repos have been read, and asks for a refresh when some haven't", () => {
    const plan = acmePlan("https://example.invalid/acme/payments-web.git");
    const listed = doctor(plan, { offline: true })[1];
    expect(listed).toMatchObject({ name: "code repos", status: "warn", found: "1 code repo listed: 0 read, 1 never read", next: "Run nikos plan refresh to read them" });
  });
});
