// nikos apply: a change file goes onto a new nikos branch, through the same write path as the
// dashboard, with the same refusals. Real git repos; the forge tools are a recording runner.
import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyChanges } from "../src/planning/apply";
import { runOp } from "../src/planning/ops";
import { newKr } from "../src/planning/krs";
import { hash, loadKr } from "../src/planning/model";
import { realRun, type Runner } from "../src/lib/git";
import { companyInit } from "../src/commands/start";
import { bareOrigin, commitAll, companyRepo, departmentRepo, git, readText, todayIso } from "./planning-fixture";
import { exportEditable, startServer } from "../src/planning/server";

/** Two company key results, committed: kr-1 (from the fixture) and kr-2. */
function twoKrs(): string {
  const co = companyRepo();
  newKr({ id: "kr-2", title: "Grow orders", owner: "Board", baseline: 10, target: 20, by: "2027-03-31" }, co);
  commitAll(co, "second key result");
  return co;
}

/** HEAD's commit, or null for a folder with no git repo (or no commit yet). */
function headOrNull(dir: string): string | null {
  try {
    return git(dir, "rev-parse", "HEAD");
  } catch {
    return null;
  }
}

/** A change file for co, written to a new folder, with the repo's current commit as its source. */
function changeFile(co: string, operations: unknown[], patch: Record<string, unknown> = {}, level = "company"): string {
  const dir = mkdtempSync(join(tmpdir(), "nikos-changes-"));
  const file = join(dir, "acme-changes.nikos.json");
  const doc = {
    format: "nikos-planning-changes",
    format_version: 1,
    plan: { level, name: "Acme" },
    source: { commit: headOrNull(co), dirty: false, exported: "2026-11-08T09:14:00.000Z" },
    operations,
    ...patch,
  };
  writeFileSync(file, JSON.stringify(doc, null, 2));
  return file;
}

const kr = (co: string, id: string) => hash(readText(co, `planning/krs/${id}.yaml`));

/** Run apply with the lines it prints collected. */
async function apply(file: string, co: string, opts: Partial<Parameters<typeof applyChanges>[1]> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await applyChanges(file, { dir: co, interactive: false, out: (l) => out.push(l), err: (l) => err.push(l), ...opts });
  return { code, out, err, text: [...out, ...err].join("\n") };
}

describe("applying a change file", () => {
  it("makes a nikos branch named for the level and the date, and writes the operations", async () => {
    const co = twoKrs();
    const file = changeFile(co, [{ op: "checkin", target: { kr: "kr-1" }, args: { value: 1.5, note: "Week 45" }, expect: kr(co, "kr-1") }]);
    const r = await apply(file, co);
    expect(r.code).toBe(0);
    expect(git(co, "branch", "--show-current")).toBe(`nikos/plan-company-${todayIso()}`);
    expect(loadKr(co, "kr-1").data.checkins.at(-1)).toMatchObject({ value: 1.5, note: "Week 45" });
    expect(r.out).toContain("Validation: ok");
    expect(r.out.join("\n")).toMatch(/Changed: planning\/krs\/kr-1\.yaml/);
    expect(r.out.join("\n")).toContain("Not committed. Run with --commit to commit, or commit by hand.");
    expect(git(co, "log", "--oneline", "-1")).toContain("second key result");
  });

  it("commits only the planning paths with --commit, and leaves other files alone", async () => {
    const co = twoKrs();
    writeFileSync(join(co, "notes.txt"), "not planning\n");
    const file = changeFile(co, [{ op: "checkin", target: { kr: "kr-1" }, args: { value: 2 }, expect: kr(co, "kr-1") }]);
    const r = await apply(file, co, { commit: true });
    expect(r.code).toBe(0);
    expect(r.text).toContain("! 1 changed file outside planning/, maps/ and intent/ are left alone.");
    expect(git(co, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean)).toEqual(["planning/krs/kr-1.yaml"]);
    expect(git(co, "status", "--porcelain")).toContain("?? notes.txt");
  });

  it("skips a stale operation with its reason and applies the rest: exit 2", async () => {
    const co = twoKrs();
    const file = changeFile(co, [
      { op: "checkin", target: { kr: "kr-1" }, args: { value: 3 }, expect: "0000000000000000" },
      { op: "checkin", target: { kr: "kr-2" }, args: { value: 12 }, expect: kr(co, "kr-2") },
    ]);
    const r = await apply(file, co);
    expect(r.code).toBe(2);
    expect(r.out).toContain("  skip  checkin kr-1: planning/krs/kr-1.yaml changed since the snapshot was made; export again");
    expect(r.out).toContain("  ok    checkin kr-2");
    expect(loadKr(co, "kr-1").data.checkins).toEqual([]);
    expect(loadKr(co, "kr-2").data.checkins.at(-1).value).toBe(12);
  });

  it("chains two operations on one file: the second is made against the first one's result", async () => {
    const co = twoKrs();
    const h0 = kr(co, "kr-1");
    const file = changeFile(co, [
      { op: "checkin", target: { kr: "kr-1" }, args: { value: 41 }, expect: h0 },
      { op: "checkin", target: { kr: "kr-1" }, args: { value: 43 }, expect: h0 },
    ]);
    const r = await apply(file, co);
    expect(r.code).toBe(0);
    expect(loadKr(co, "kr-1").data.checkins.map((c: any) => c.value)).toEqual([41, 43]);
  });

  it("refuses a file for another level, with nothing written and no branch made", async () => {
    const co = twoKrs();
    const before = git(co, "branch", "--show-current");
    const file = changeFile(co, [{ op: "checkin", target: { kr: "kr-1" }, args: { value: 9 }, expect: kr(co, "kr-1") }], {}, "department");
    const r = await apply(file, co);
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toContain("✗ This file is for a department plan; this repo is a company plan");
    expect(git(co, "branch", "--show-current")).toBe(before);
  });

  it("refuses a folder that isn't a git repo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-plain-"));
    companyInit(dir, { name: "Acme", period: "Q1 2027", repo: "acme/company-plan" });
    newKr({ id: "kr-1", title: "Grow revenue", owner: "Board", baseline: 1, target: 2, by: "2027-03-31" }, dir);
    const file = changeFile(dir, [{ op: "checkin", target: { kr: "kr-1" }, args: { value: 2 }, expect: kr(dir, "kr-1") }]);
    const r = await apply(file, dir);
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toContain("✗ nikos apply needs a git repo: the changes go on a branch");
    expect(existsSync(join(dir, ".git"))).toBe(false);
  });

  it("refuses uncommitted changes in planning/, with the commit-or-stash message", async () => {
    const co = twoKrs();
    writeFileSync(join(co, "planning", "scratch.md"), "not yet committed\n");
    const file = changeFile(co, [{ op: "checkin", target: { kr: "kr-1" }, args: { value: 9 }, expect: kr(co, "kr-1") }]);
    const r = await apply(file, co);
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toContain("✗ Commit or stash changes in planning/, maps/ or intent/ first");
  });

  it("says when the commit it was exported from isn't HEAD, and applies anyway", async () => {
    const co = twoKrs();
    const file = changeFile(co, [{ op: "checkin", target: { kr: "kr-1" }, args: { value: 7 }, expect: kr(co, "kr-1") }], { source: { commit: "a".repeat(40), dirty: false, exported: "2026-11-08T09:14:00.000Z" } });
    const r = await apply(file, co);
    expect(r.code).toBe(0);
    expect(r.out.join("\n")).toContain(`Exported from ${"a".repeat(7)}; this repo is at ${git(co, "rev-parse", "HEAD").slice(0, 7)}.`);
    expect(loadKr(co, "kr-1").data.checkins.at(-1).value).toBe(7);
  });

  it("refuses a malformed change file, with the schema message", async () => {
    const co = twoKrs();
    const file = changeFile(co, []);
    writeFileSync(file, JSON.stringify({ format: "nikos-planning-changes", format_version: 1, plan: { level: "company", name: "Acme" }, source: { commit: null, dirty: false, exported: "2026-11-08T09:14:00Z" }, operations: [{ op: "bet.delete", args: {} }], token: "x" }));
    const r = await apply(file, co);
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toContain("isn't a nikOS change file");
    expect(r.err.join("\n")).toContain("unknown field 'token'");
  });

  it("refuses an operation that the dashboard refuses, with the same message", async () => {
    const co = twoKrs();
    const file = changeFile(co, [{ op: "kr.edit", target: { kr: "kr-1" }, args: { title: "" }, expect: kr(co, "kr-1") }]);
    const r = await apply(file, co);
    // Nothing applied, so nothing is written and no branch is made: exit 2, the same as a skip.
    expect(r.code).toBe(2);
    expect(git(co, "branch", "--show-current")).toBe("main");
    expect(r.out.join("\n")).toContain("  skip  kr.edit kr-1: A key result needs a title (--title)");
    expect(() => runOp(co, { op: "kr.edit", target: { kr: "kr-1" }, args: { title: "" }, expect: kr(co, "kr-1") })).toThrow("A key result needs a title (--title)");
  });

  it("refuses a change that adds a validation error: nothing written, no branch made, exit 1", async () => {
    const co = twoKrs();
    const before = git(co, "branch", "--show-current");
    const file = changeFile(co, [{ op: "bet.new", target: { bet: "faster-checkout" }, args: { owner: "Ana", hypothesis: "Faster pages cut drop-off", review_on: "2027-01-15", primary: "no-such-kr" } }]);
    const r = await apply(file, co);
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toContain("Applying these operations would leave planning/ invalid. Nothing was written:");
    expect(r.err.join("\n")).toContain("no-such-kr");
    expect(existsSync(join(co, "planning", "bets", "faster-checkout.md"))).toBe(false);
    expect(git(co, "branch", "--show-current")).toBe(before);
  });

  it("with --pr and no confirm, prints the push and request commands, pushes nothing, and exits 1", async () => {
    const co = twoKrs();
    const calls: string[][] = [];
    const run: Runner = (cmd, args, cwd) => (calls.push([cmd, ...args]), realRun(cmd, args, cwd));
    const file = changeFile(co, [{ op: "checkin", target: { kr: "kr-1" }, args: { value: 8 }, expect: kr(co, "kr-1") }]);
    const r = await apply(file, co, { pr: true, run });
    // A request that was asked for and not opened is a failure for a script.
    expect(r.code).toBe(1);
    expect(calls.some((c) => c[0] === "git" && c[1] === "push")).toBe(false);
    expect(r.out.join("\n")).toContain(`Not pushed. To open the request, run: git push -u origin nikos/plan-company-${todayIso()}; then gh pr create`);
  });

  it("with --pr and a confirm, pushes the branch and opens the pull request with the forge's argv", async () => {
    const co = twoKrs();
    const branch = `nikos/plan-company-${todayIso()}`;
    const calls: string[][] = [];
    const run: Runner = (cmd, args, cwd) => {
      calls.push([cmd, ...args]);
      if (cmd === "gh") return args[0] === "--version" ? { status: 0, stdout: "gh 2.0", stderr: "" } : { status: 0, stdout: "https://github.com/acme/company-plan/pull/1\n", stderr: "" };
      if (cmd === "git" && args[0] === "push") return { status: 0, stdout: "", stderr: "" };
      return realRun(cmd, args, cwd);
    };
    const file = changeFile(co, [{ op: "checkin", target: { kr: "kr-1" }, args: { value: 8 }, expect: kr(co, "kr-1") }]);
    const asked: string[] = [];
    const r = await apply(file, co, {
      pr: true,
      run,
      interactive: true,
      ask: async (q) => (asked.push(q), true),
    });
    expect(r.code).toBe(0);
    expect(asked.join("\n")).toContain(`Push ${branch} and open the request now?`);
    expect(calls).toContainEqual(["git", "push", "-u", "origin", branch]);
    expect(calls).toContainEqual(["gh", "pr", "create", "--base", "main", "--head", branch, "--fill"]);
    expect(r.out.join("\n")).toContain("https://github.com/acme/company-plan/pull/1");
  });

  it("with --pr and no confirm, pushes nothing", async () => {
    const co = twoKrs();
    const calls: string[][] = [];
    const run: Runner = (cmd, args, cwd) => (calls.push([cmd, ...args]), realRun(cmd, args, cwd));
    const file = changeFile(co, [{ op: "checkin", target: { kr: "kr-1" }, args: { value: 8 }, expect: kr(co, "kr-1") }]);
    await apply(file, co, { pr: true, run, interactive: true, ask: async () => false });
    expect(calls.some((c) => c[0] === "git" && c[1] === "push")).toBe(false);
    expect(calls.some((c) => c[0] === "gh")).toBe(false);
  });

  it("a push that fails leaves the commit on the branch and says so: exit 1", async () => {
    const co = twoKrs();
    const origin = bareOrigin();
    git(co, "remote", "set-url", "origin", origin);
    const file = changeFile(co, [{ op: "checkin", target: { kr: "kr-1" }, args: { value: 8 }, expect: kr(co, "kr-1") }]);
    const run: Runner = (cmd, args, cwd) => (cmd === "git" && args[0] === "push" ? { status: 1, stdout: "", stderr: "remote rejected\n" } : realRun(cmd, args, cwd));
    const r = await apply(file, co, { pr: true, run, interactive: true, ask: async () => true });
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toContain(`Changes are on nikos/plan-company-${todayIso()}; the push didn't finish: remote rejected`);
  });
});

describe("end to end: an editable export, applied in a second clone", () => {
  it("applies a change from the export, and the dashboard refuses the same op with the same message", async () => {
    const co = companyRepo();
    const dept = departmentRepo(co);
    newKr({ id: "pay-1", title: "Payment success", owner: "Ana", baseline: 90, target: 95, by: "2027-03-31", alignsTo: "acme/company-plan#kr-1" }, dept);
    commitAll(dept, "payment key result");

    const dir = mkdtempSync(join(tmpdir(), "nikos-e2e-"));
    const snapshot = join(dir, "payments.html");
    exportEditable(dept, snapshot, { withLinked: true });

    // The person's change: a check-in, made against the file as the snapshot had it.
    git(dir, "clone", "-q", dept, "clone");
    const clone = join(dir, "clone");
    const file = join(dir, "payments-changes.nikos.json");
    writeFileSync(
      file,
      JSON.stringify({
        format: "nikos-planning-changes",
        format_version: 1,
        plan: { level: "department", name: "Payments" },
        source: { commit: git(dept, "rev-parse", "HEAD"), dirty: false, exported: "2026-11-08T09:14:00.000Z" },
        made_by: "Sam Example",
        with_linked: true,
        operations: [{ op: "checkin", target: { kr: "pay-1" }, args: { value: 92, note: "Week 45" }, expect: kr(dept, "pay-1") }],
      }),
    );
    const applied = await apply(file, clone);
    expect(applied.code).toBe(0);
    expect(git(clone, "branch", "--show-current")).toBe(`nikos/plan-department-${todayIso()}`);
    expect(loadKr(clone, "pay-1").data.checkins.at(-1).value).toBe(92);
    commitAll(clone, "check-in");

    // The same empty-title edit, applied from a file and sent to the dashboard: the same message.
    const badOp = { op: "kr.edit", target: { kr: "pay-1" }, args: { title: "" } };
    const bad = join(dir, "bad.nikos.json");
    writeFileSync(bad, JSON.stringify({ format: "nikos-planning-changes", format_version: 1, plan: { level: "department", name: "Payments" }, source: { commit: null, dirty: false, exported: "2026-11-08T09:14:00.000Z" }, operations: [{ ...badOp, expect: kr(clone, "pay-1") }] }));
    const refused = await apply(bad, clone);
    expect(refused.out.join("\n")).toContain("  skip  kr.edit pay-1: A key result needs a title (--title)");

    const srv = await startServer(dept);
    try {
      const res = await fetch(`http://127.0.0.1:${srv.port}/api/op`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-nikos-token": srv.token },
        body: JSON.stringify({ ...badOp, expect: kr(dept, "pay-1") }),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).error).toBe("A key result needs a title (--title)");
    } finally {
      await srv.close();
    }
  });
});
