// nikOS Plan, PR 6 stage B: a key result can be a milestone, a list of named steps with done dates. It has
// no baseline, target or check-ins. Its progress is the share of steps done, and it is stale only once a
// step was done and none has been since stale_after_days. Steps are fixed at creation: kr step marks one.
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPlanRepo } from "../src/plan/cli";
import { exportPlanPage, startPlanServe, type PlanServe } from "../src/plan/serve";
import { addArea, findArea, initPlanRepo } from "../src/plan/repo";
import { runOp } from "../src/planning/ops";
import { checkIn, isStale, markStep, newKr, progress, reviseTarget } from "../src/planning/krs";
import { hash } from "../src/planning/model";
import { checkKr } from "../src/planning/model";
import { suggestPlan } from "../src/plan/suggest";

afterEach(() => vi.restoreAllMocks());

/** Acme: the company and finance, with a fresh planning repo. */
function acme(): string {
  const repo = mkdtempSync(join(tmpdir(), "nikos-milestone-"));
  initPlanRepo(repo, { name: "Acme", year: "2027" });
  addArea(repo, "department", "finance", { name: "Finance", owner: "Mira" });
  addArea(repo, "group", "payments", { name: "Payments", department: "finance" });
  return repo;
}

const FINANCE = (repo: string) => findArea(repo, "finance").dir;
const CLOSE = (repo: string) => join(FINANCE(repo), "krs", "close-process.yaml");
const PROCESS = ["--kind", "milestone", "--step", "Map steps", "--step", "Pilot", "--step", "Roll out"];

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

/** A milestone in finance, for 2027 Q1, with its three steps. */
async function withMilestone(repo: string): Promise<void> {
  const made = await run(repo, "kr", "new", "close-process", "--in", "finance", "--title", "Close process", "--owner", "Mira", "--by", "2027-03-31", "--period", "2027-Q1", ...PROCESS);
  expect(made.code).toBe(0);
}

describe("a milestone key result", () => {
  it("is written with its steps, and no baseline, target or original target", async () => {
    const repo = acme();
    const made = await run(repo, "kr", "new", "close-process", "--in", "finance", "--title", "Close process", "--owner", "Mira", "--by", "2027-03-31", "--period", "2027-Q1", ...PROCESS);
    expect(made.out).toBe("Wrote planning/departments/finance/krs/close-process.yaml");
    const text = readFileSync(CLOSE(repo), "utf8");
    expect(text).toContain("kind: milestone");
    expect(text).toContain("name: Map steps");
    expect(text).not.toContain("baseline");
    expect(text).not.toContain("target");
    expect(text).not.toContain("original_target");
  });

  it("is refused without steps, with a baseline or target, with a direction, or with repeated step names", () => {
    const repo = acme();
    const dir = FINANCE(repo);
    const base = { id: "close-process", title: "Close process", owner: "Mira", by: "2027-03-31", period: "2027-Q1" };
    expect(() => newKr({ ...base, baseline: NaN, target: NaN, kind: "milestone", steps: [] } as any, dir)).toThrow("A milestone needs at least one step (--step)");
    expect(() => newKr({ ...base, baseline: 0, target: 3, kind: "milestone", steps: ["Map"] } as any, dir)).toThrow("A milestone has no baseline or target: its steps are its progress");
    expect(() => newKr({ ...base, baseline: NaN, target: NaN, kind: "milestone", steps: ["Map"], direction: "down" } as any, dir)).toThrow("A milestone has no direction: each step is done or not");
    expect(() => newKr({ ...base, baseline: NaN, target: NaN, kind: "milestone", steps: ["Map", "Map"] } as any, dir)).toThrow("Each step of a milestone needs its own name");
  });

  it("refuses steps on a number key result, and a kind that is neither", async () => {
    const repo = acme();
    const number = await run(repo, "kr", "new", "revenue", "--in", "finance", "--title", "Revenue", "--owner", "Mira", "--baseline", "0", "--target", "9", "--by", "2027-03-31", "--step", "Map");
    expect(number.code).toBe(1);
    expect(number.out).toContain("Only a milestone has steps: add --kind milestone");
    const odd = await run(repo, "kr", "new", "odd", "--in", "finance", "--title", "Odd", "--owner", "Mira", "--kind", "sideways", "--baseline", "0", "--target", "9", "--by", "2027-03-31");
    expect(odd.out).toContain("kind is number or milestone");
  });

  it("refuses a check-in and a target move, and says to mark a step instead", async () => {
    const repo = acme();
    await withMilestone(repo);
    const checked = await run(repo, "checkin", "close-process", "2", "--in", "finance");
    expect(checked.code).toBe(1);
    expect(checked.out).toContain('close-process is a milestone, so it has steps, not a value: mark one with nikos plan kr step close-process "<step>"');
    expect(() => reviseTarget(FINANCE(repo), "close-process", 5)).toThrow("close-process is a milestone, so it has no target to move");
    expect(() => checkIn(FINANCE(repo), "close-process", { value: 2 })).toThrow("mark one with nikos plan kr step");
  });

  it("marks one step done on the date given, and refuses an unknown step, a second mark and a number key result", async () => {
    const repo = acme();
    await withMilestone(repo);
    const marked = await run(repo, "kr", "step", "close-process", "Map steps", "--date", "2026-11-10");
    expect(marked.code).toBe(0);
    expect(marked.out).toBe("Wrote planning/departments/finance/krs/close-process.yaml");
    expect(readFileSync(CLOSE(repo), "utf8")).toContain("done: 2026-11-10");
    const unknown = await run(repo, "kr", "step", "close-process", "Sign off");
    expect(unknown.out).toContain("No step called 'Sign off' in close-process. Its steps: Map steps, Pilot, Roll out");
    const again = await run(repo, "kr", "step", "close-process", "Map steps", "--date", "2026-11-11");
    expect(again.out).toContain("'Map steps' is already done (on 2026-11-10). A step is marked once");
    expect(readFileSync(CLOSE(repo), "utf8")).toContain("done: 2026-11-10");
    await run(repo, "kr", "new", "revenue", "--in", "finance", "--title", "Revenue", "--owner", "Mira", "--baseline", "0", "--target", "9", "--by", "2027-03-31", "--period", "2027-Q1");
    expect(() => markStep(FINANCE(repo), "revenue", "Map steps")).toThrow("revenue is not a milestone: check it in with nikos plan checkin revenue <value>");
  });

  it("is refused a step date that isn't a date", async () => {
    const repo = acme();
    await withMilestone(repo);
    expect(() => markStep(FINANCE(repo), "close-process", "Map steps", "2026-02-30")).toThrow("The step's date is not a date (YYYY-MM-DD)");
  });

  it("the schema needs steps on a milestone and refuses a baseline on one", () => {
    const base = { id: "close-process", title: "Close process", owner: "Mira", by: "2027-03-31", checkins: [] };
    expect(checkKr({ ...base, kind: "milestone", steps: [{ name: "Map steps" }] })).toBe(true);
    expect(checkKr({ ...base, kind: "milestone" })).toBe(false);
    expect(checkKr({ ...base, kind: "milestone", steps: [{ name: "Map steps" }], baseline: 0 })).toBe(false);
    expect(checkKr({ ...base, kind: "milestone", steps: [{ name: "Map steps", done: "10/11/2026" }] })).toBe(false);
    expect(checkKr({ ...base, kind: "number", baseline: 0, target: 9, original_target: 9, steps: [{ name: "Map" }] })).toBe(false);
    expect(checkKr({ ...base, baseline: 0, target: 9, original_target: 9 })).toBe(true);
    expect(checkKr({ ...base, baseline: 0, target: 9, original_target: 9, kind: "sideways" })).toBe(false);
  });
});

describe("a milestone's progress and staleness", () => {
  const kr = (steps: { name: string; done?: string }[], extra: Record<string, unknown> = {}) => ({ id: "close-process", kind: "milestone", steps, checkins: [], ...extra });

  it("progress is the share of steps done", () => {
    expect(progress(kr([{ name: "a", done: "2026-11-01" }, { name: "b" }, { name: "c" }]))).toBeCloseTo(1 / 3);
    expect(progress(kr([{ name: "a", done: "2026-11-01" }, { name: "b", done: "2026-11-02" }, { name: "c" }, { name: "d" }, { name: "e" }]))).toBeCloseTo(0.4);
    expect(progress(kr([{ name: "a" }, { name: "b" }]))).toBe(0);
    expect(progress(kr([{ name: "a", done: "2026-11-01" }]))).toBe(1);
  });

  it("is not stale with no step done, however old the plan is", () => {
    expect(isStale(kr([{ name: "a" }, { name: "b" }]), "2027-12-31")).toBe(false);
  });

  it("is stale once the latest step done is older than stale_after_days (default 14)", () => {
    expect(isStale(kr([{ name: "a", done: "2026-10-01" }, { name: "b" }]), "2026-11-10")).toBe(true);
    expect(isStale(kr([{ name: "a", done: "2026-11-01" }, { name: "b" }]), "2026-11-10")).toBe(false);
    expect(isStale(kr([{ name: "a", done: "2026-10-01" }, { name: "b", done: "2026-11-05" }]), "2026-11-10")).toBe(false);
    expect(isStale(kr([{ name: "a", done: "2026-11-01" }], { stale_after_days: 5 }), "2026-11-10")).toBe(true);
  });

  it("the status line says the steps done, the steps to do, and that it is stale when it is", async () => {
    const repo = acme();
    await withMilestone(repo);
    await run(repo, "kr", "step", "close-process", "Map steps", "--date", "2026-10-01");
    const status = (await run(repo, "status", "--in", "finance")).out;
    expect(status).toContain("close-process — Close process: 1 of 3 steps done: Map steps on 2026-10-01. To do: Pilot, Roll out (by 2027-03-31) · 2027-Q1 · stale");
    expect(status).not.toContain("baseline");
  });

  it("status --json gives the kind and every step, with done null while it is not", async () => {
    const repo = acme();
    await withMilestone(repo);
    await run(repo, "kr", "step", "close-process", "Map steps", "--date", "2026-11-10");
    const json = JSON.parse((await run(repo, "status", "--json")).out);
    const k = json.areas.find((a: any) => a.rel === "departments/finance").keyResults[0];
    expect(k).toMatchObject({ id: "close-process", kind: "milestone", by: "2027-03-31", period: "2027-Q1", stale: false });
    expect(k.steps).toEqual([
      { name: "Map steps", done: "2026-11-10" },
      { name: "Pilot", done: null },
      { name: "Roll out", done: null },
    ]);
    expect(k).not.toHaveProperty("baseline");
    expect(k).not.toHaveProperty("latest");
  });

  it("a number key result's JSON carries no kind, so an old reader sees what it saw", async () => {
    const repo = acme();
    await run(repo, "kr", "new", "revenue", "--in", "finance", "--title", "Revenue", "--owner", "Mira", "--baseline", "0", "--target", "9", "--by", "2027-03-31", "--period", "2027-Q1");
    const k = JSON.parse((await run(repo, "status", "--json")).out).areas.find((a: any) => a.rel === "departments/finance").keyResults[0];
    expect(k).not.toHaveProperty("kind");
    expect(k).toHaveProperty("baseline", 0);
  });
});

describe("a milestone in the planning dashboard", () => {
  let open: PlanServe[] = [];
  afterEach(async () => {
    await Promise.all(open.map((p) => p.srv.close()));
    open = [];
  });

  const get = async (plan: PlanServe, path: string) => (await fetch(`http://127.0.0.1:${plan.srv.port}${path}`)).text();

  it("shows the steps done, and the live page gives a step form that posts kr.step, with a select for the step", async () => {
    const repo = acme();
    await withMilestone(repo);
    await run(repo, "kr", "step", "close-process", "Map steps", "--date", "2026-11-10");
    const plan = await startPlanServe(repo, { port: 0, offline: true });
    open.push(plan);
    const html = await get(plan, "/?at=departments/finance");
    expect(html).toContain("1 of 3 steps done");
    expect(html).toContain("To do: Pilot, Roll out");
    expect(html).not.toContain("toward undefined");
    const form = html.match(/<form class="save" data-op="kr\.step"[\s\S]*?<\/form>/)?.[0] ?? "";
    expect(form).toContain('<select name="name" required>');
    expect(form).toContain('<option value="Pilot">Pilot</option>');
    expect(form).not.toContain('value="Map steps"');
    expect(form).toContain('name="date"');
    // The live script reads a select's value as well as an input's, so the step name is sent.
    expect(html).toContain("input[name], select[name]");
  });

  it("the offline export shows the steps but has no form", async () => {
    const repo = acme();
    await withMilestone(repo);
    const file = join(mkdtempSync(join(tmpdir(), "nikos-milestone-export-")), "plan.html");
    await exportPlanPage(repo, file, { offline: true, at: "departments/finance" });
    const html = readFileSync(file, "utf8");
    expect(html).toContain("0 of 3 steps done");
    expect(html).not.toContain("<form");
    expect(html).not.toContain('data-op="kr.step"');
  });
});

describe("kr.step as a change", () => {
  it("marks a step through runOp, and a stale expect is refused and changes nothing", async () => {
    const repo = acme();
    await withMilestone(repo);
    const dir = FINANCE(repo);
    const before = readFileSync(CLOSE(repo), "utf8");
    expect(() => runOp(dir, { op: "kr.step", target: { kr: "close-process" }, args: { name: "Map steps" }, expect: "0000000000000000" })).toThrow(/changed on disk since it was loaded/);
    expect(readFileSync(CLOSE(repo), "utf8")).toBe(before);
    const r = runOp(dir, { op: "kr.step", target: { kr: "close-process" }, args: { name: "Map steps", date: "2026-11-10" }, expect: hash(before) });
    expect(r.message).toBe("Marked 'Map steps' done in close-process");
    expect(readFileSync(CLOSE(repo), "utf8")).toContain("done: 2026-11-10");
  });

  it("is refused at a group, which has no key results", async () => {
    const repo = acme();
    const group = findArea(repo, "payments").dir;
    expect(() => runOp(group, { op: "kr.step", target: { kr: "close-process" }, args: { name: "Map steps" } })).toThrow(/key result/);
  });
});

describe("the suggestions for a milestone", () => {
  it("asks about a stale milestone's steps, not a check-in, and never names a check-in for it", async () => {
    const repo = acme();
    await withMilestone(repo);
    await run(repo, "kr", "step", "close-process", "Map steps", "--date", "2026-01-02");
    const suggestion = suggestPlan(repo, findArea(repo, "finance"));
    const labels = suggestion.options.map((o) => o.label);
    expect(labels).toContain('Ask about the steps of "Close process"');
    expect(labels.some((l) => l.startsWith("Check in on"))).toBe(false);
    const option = suggestion.options.find((o) => o.label.startsWith("Ask about the steps"));
    expect(option?.do).toContain("nikos plan kr step <kr-id>");
  });
});
