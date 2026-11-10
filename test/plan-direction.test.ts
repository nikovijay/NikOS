// nikOS Plan, PR 6 stage A: a key result can say it should go down (days to close, 11 toward 7). The
// progress formula is the same both ways. Direction only changes the words, and a validate warning when
// it points against the target's side. Text alone never feeds a figure, and that is not tested here.
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPlanRepo, planIssues } from "../src/plan/cli";
import { areaPage } from "../src/plan/dashboard";
import { planDeliveries } from "../src/plan/delivery";
import { renderPlanBody, viewOf } from "../src/plan/page";
import { addArea, findArea, initPlanRepo } from "../src/plan/repo";
import { newKr } from "../src/planning/krs";
import { checkKr } from "../src/planning/model";

const NOW = new Date("2026-11-10T12:00:00Z");

/** Acme: the company and finance, with a fresh planning repo. */
function acme(): string {
  const repo = mkdtempSync(join(tmpdir(), "nikos-direction-"));
  initPlanRepo(repo, { name: "Acme", year: "2027" });
  addArea(repo, "department", "finance", { name: "Finance", owner: "Mira" });
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

/** The dashboard body for a view of an area, as the page writes it (no forms: the offline view). */
function pageOf(repo: string, area: string, view: string, level: "company" | "department"): string {
  const page = areaPage(repo, findArea(repo, area), { deliveries: planDeliveries(repo, NOW), now: NOW });
  return renderPlanBody(page, { view: viewOf(new URLSearchParams(`view=${view}`), level) });
}

const CLOSE_DAYS = { title: "Median days to close", owner: "Mira", baseline: 11, target: 7, period: "2027-Q1" };

describe("a key result that should go down", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("is written with direction down, and is left out when it goes up", async () => {
    const repo = acme();
    const down = await run(repo, "kr", "new", "close-days", "--in", "finance", "--direction", "down", ...flat(CLOSE_DAYS));
    expect(down.code).toBe(0);
    expect(down.out).toBe("Wrote planning/departments/finance/krs/close-days.yaml");
    const up = await run(repo, "kr", "new", "revenue", "--in", "finance", "--direction", "up", ...flat({ ...CLOSE_DAYS, title: "Revenue", baseline: 0, target: 9 }));
    expect(up.code).toBe(0);
    const file = (await run(repo, "status", "--json")).out;
    expect(file).toContain('"direction": "down"');
    expect(file.match(/"direction"/g)).toHaveLength(1);
  });

  it("says in the status line that it should go down, and says nothing for one that goes up", async () => {
    const repo = acme();
    await run(repo, "kr", "new", "close-days", "--in", "finance", "--direction", "down", ...flat(CLOSE_DAYS));
    await run(repo, "kr", "new", "revenue", "--in", "finance", ...flat({ ...CLOSE_DAYS, title: "Revenue", baseline: 0, target: 9 }));
    await run(repo, "checkin", "close-days", "9", "--in", "finance");
    const status = (await run(repo, "status", "--in", "finance")).out;
    expect(status).toContain("close-days — Median days to close: 9 on 2026-11-10 (baseline 11, target 7 by 2027-03-31) · 2027-Q1 · should go down");
    expect(status).toContain("revenue — Revenue: no check-ins (baseline 0, target 9 by 2027-03-31) · 2027-Q1 · stale");
    expect(status).not.toContain("revenue — Revenue: no check-ins (baseline 0, target 9 by 2027-03-31) · 2027-Q1 · should go down");
  });

  it("refuses a direction that is neither up nor down, with the same words in the file and in the command", async () => {
    const repo = acme();
    const result = await run(repo, "kr", "new", "close-days", "--in", "finance", "--direction", "sideways", ...flat(CLOSE_DAYS));
    expect(result.code).toBe(1);
    expect(result.out).toContain("direction is up or down");
    expect(() => newKr({ id: "close-days", title: "Median", owner: "Mira", baseline: 11, target: 7, by: "2027-03-31", period: "2027-Q1", direction: "sideways" as any }, join(repo, "planning/departments/finance"))).toThrow(
      "direction is up or down",
    );
    expect(checkKr({ id: "close-days", title: "M", owner: "Mira", baseline: 11, target: 7, original_target: 7, by: "2027-03-31", checkins: [], direction: "sideways" })).toBe(false);
    expect(checkKr({ id: "close-days", title: "M", owner: "Mira", baseline: 11, target: 7, original_target: 7, by: "2027-03-31", checkins: [], direction: "down" })).toBe(true);
  });

  it("warns, and still validates, when the direction points against the target's side", async () => {
    const repo = acme();
    // Down with a target above the baseline: the figure is set to go up, but says down.
    await run(repo, "kr", "new", "backlog", "--in", "finance", "--direction", "down", ...flat({ ...CLOSE_DAYS, title: "Backlog", baseline: 4, target: 9 }));
    // Up with a target below the baseline, and no direction at all: the default is up.
    await run(repo, "kr", "new", "close-days", "--in", "finance", ...flat(CLOSE_DAYS));
    const issues = planIssues(repo);
    const warnings = issues.filter((i) => i.warning).map((i) => i.message);
    // Each warning says the command that fixes it: the direction, or the target.
    expect(warnings).toEqual([
      "direction is down, but the target 9 is above the baseline 4. Set it with nikos plan kr direction backlog up, or move the target with nikos plan kr target backlog <value>",
      "direction is up, but the target 7 is below the baseline 11. Set it with nikos plan kr direction close-days down, or move the target with nikos plan kr target close-days <value>",
    ]);
    const validate = await run(repo, "validate");
    expect(validate.code).toBe(0);
    expect(validate.out).toContain("! planning/departments/finance/krs/backlog.yaml: direction is down, but the target 9 is above the baseline 4. Set it with nikos plan kr direction backlog up");
    expect(validate.out).toContain("✓ The plan for 2027 is valid");
  });

  it("is not warned about when the target equals the baseline, or the direction matches the target", async () => {
    const repo = acme();
    await run(repo, "kr", "new", "close-days", "--in", "finance", "--direction", "down", ...flat(CLOSE_DAYS));
    expect(planIssues(repo).filter((i) => i.warning)).toEqual([]);
  });

  it("shows moving the wrong way for a figure past the baseline, not a minus sign", async () => {
    const repo = acme();
    await run(repo, "kr", "new", "close-days", "--in", "finance", "--direction", "down", ...flat(CLOSE_DAYS));
    await run(repo, "checkin", "close-days", "9", "--in", "finance", "--date", "2026-11-01");
    await run(repo, "checkin", "close-days", "12", "--in", "finance", "--date", "2026-11-10");
    const okrs = pageOf(repo, "finance", "okrs", "department");
    expect(okrs).toContain("moved the wrong way toward 7 (should go down)");
    expect(okrs).not.toContain("-25%");
    // The figure halfway on the way down reads as a share, with the same words for the target.
    await run(repo, "checkin", "close-days", "9", "--in", "finance", "--date", "2026-11-10");
    const halfway = pageOf(repo, "finance", "okrs", "department");
    expect(halfway).toContain("50% toward 7 (should go down)");
    expect(halfway).not.toContain("moved the wrong way");
    expect(pageOf(repo, "finance", "keys", "department")).toContain("50%");
  });

  it("leaves a figure that goes up with the words it had", async () => {
    const repo = acme();
    await run(repo, "kr", "new", "revenue", "--in", "finance", ...flat({ ...CLOSE_DAYS, title: "Revenue", baseline: 0, target: 90 }));
    await run(repo, "checkin", "revenue", "-10", "--in", "finance");
    const okrs = pageOf(repo, "finance", "okrs", "department");
    expect(okrs).toContain("moved the wrong way toward 90");
    expect(okrs).not.toContain("should go down");
  });
});

/** The CLI's flags for the fields a key result needs, from a plain object. */
function flat(fields: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(fields)) out.push(`--${k}`, String(v));
  return out;
}

describe("the direction command, and the wording for a figure that moved the wrong way", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("plan kr direction sets it, up is not written, and a word that is neither up nor down is refused", async () => {
    const repo = acme();
    const file = join(repo, "planning/departments/finance/krs/close-days.yaml");
    await run(repo, "kr", "new", "close-days", "--in", "finance", ...flat(CLOSE_DAYS));
    // Without a direction the figure goes up, and a target below the baseline is warned about, with the command that fixes it.
    expect(planIssues(repo).filter((i) => i.warning)).toHaveLength(1);
    expect((await run(repo, "kr", "direction", "close-days", "down")).code).toBe(0);
    expect(readFileSync(file, "utf8")).toContain("direction: down");
    expect(planIssues(repo).filter((i) => i.warning)).toEqual([]);
    expect((await run(repo, "kr", "direction", "close-days", "up")).code).toBe(0);
    expect(readFileSync(file, "utf8")).not.toContain("direction");
    const bad = await run(repo, "kr", "direction", "close-days", "sideways");
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("direction is up or down");
    expect(readFileSync(file, "utf8")).not.toContain("direction");
  });

  it("status says it moved the wrong way once a figure that should go down rises past the baseline", async () => {
    const repo = acme();
    await run(repo, "kr", "new", "close-days", "--in", "finance", "--direction", "down", ...flat(CLOSE_DAYS));
    await run(repo, "checkin", "close-days", "12");
    expect((await run(repo, "status", "--in", "finance")).out).toContain("12 on 2026-11-10 (baseline 11, target 7 by 2027-03-31) · 2027-Q1 · should go down · moved the wrong way");
    await run(repo, "checkin", "close-days", "9");
    expect((await run(repo, "status", "--in", "finance")).out).not.toContain("moved the wrong way");
  });
});
