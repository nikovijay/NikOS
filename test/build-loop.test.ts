import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../src/commands/init";
import { setupVerify } from "../src/commands/verify";
import { next } from "../src/commands/next";
import { setState, failingScenarios, type StateError } from "../src/commands/state";
import { decide } from "../src/commands/decide";
import { validate } from "../src/commands/validate";
import { copyExample, edit } from "./helpers";

const repoModules = join(__dirname, "../node_modules");

const steps = (thenBody: string) => `import { Given, When, Then } from "@cucumber/cucumber";
Given("I am a new user", () => {});
When("I do the one thing this product is for", () => {});
Then("I see the result I came for", () => { ${thenBody} });
`;

/** A JS repo with nikos init and a Cucumber runner, whose FX-1 steps are given. */
function repo(stepsFile?: string): string {
  const root = mkdtempSync(join(tmpdir(), "nikos-loop-"));
  init(root, { name: "Fixture", key: "FX" });
  writeFileSync(join(root, "package.json"), '{"name":"fx","private":true}');
  symlinkSync(repoModules, join(root, "node_modules"));
  setupVerify(root);
  if (stepsFile) writeFileSync(join(root, "test/steps/first-story.steps.mjs"), stepsFile);
  return root;
}

const status = (root: string, id: string) => readFileSync(join(root, "intent/state.yaml"), "utf8").match(new RegExp(`${id}:\\n\\s+status: (\\w+)`))?.[1];

describe("build loop", () => {
  it("picks the next todo story", () => {
    const intent = copyExample();
    // hello-todo: HT-1 done, HT-2 in progress, HT-3 todo; queue [HT-2, HT-3].
    expect(next(intent)).toEqual({ story: "HT-3", open: [{ id: "HT-2", status: "in_progress" }], waiting: [] });
    edit(join(intent, "state.yaml"), (s) => s.replace(/HT-3:\n    status: todo/, "HT-3:\n    status: done"));
    expect(next(intent).story).toBeUndefined();
  });

  it("prefers the run queue over story map order", () => {
    const intent = copyExample();
    edit(join(intent, "state.yaml"), (s) => s.replace("status: in_progress", "status: todo").replace("queue: [HT-2, HT-3]", "queue: [HT-3, HT-2]"));
    expect(next(intent).story).toBe("HT-3");
  });

  it("only allows the documented status moves", () => {
    const root = repo();
    expect(() => setState("FX-1", "done", { dir: root })).toThrow("FX-1 can't move from todo to done");
    expect(setState("FX-1", "in_progress", { dir: root, by: "claude-code", date: "2026-11-03" })).toMatchObject({ from: "todo", to: "in_progress" });
    expect(status(root, "FX-1")).toBe("in_progress");
    expect(readFileSync(join(root, "intent/state.yaml"), "utf8")).toContain("claimed_by: claude-code");
    expect(() => setState("FX-9", "in_progress", { dir: root })).toThrow("FX-9 has no entry in state.yaml");
    expect(validate(root).errors).toEqual([]);
  });

  it("refuses done when a scenario fails", () => {
    const root = repo(steps('throw new Error("nothing shown");'));
    setState("FX-1", "in_progress", { dir: root });
    let err: StateError | undefined;
    try {
      setState("FX-1", "done", { dir: root });
    } catch (e) {
      err = e as StateError;
    }
    expect(err?.message).toContain("FX-1 stays in_progress: its scenarios don't all pass");
    expect(err?.result?.failing).toEqual(["AC1 — The core action works"]);
    expect(status(root, "FX-1")).toBe("in_progress");
  }, 30_000);

  it("refuses done while steps are still pending", () => {
    const root = repo();
    setState("FX-1", "in_progress", { dir: root });
    expect(() => setState("FX-1", "done", { dir: root })).toThrow("stays in_progress");
    expect(status(root, "FX-1")).toBe("in_progress");
  }, 30_000);

  it("refuses done when the scenarios can't run", () => {
    const root = mkdtempSync(join(tmpdir(), "nikos-loop-"));
    init(root, { name: "Fixture", key: "FX" });
    setState("FX-1", "in_progress", { dir: root });
    expect(() => setState("FX-1", "done", { dir: root })).toThrow("its scenarios couldn't run");
    expect(status(root, "FX-1")).toBe("in_progress");
  });

  it("sets done when the scenarios pass", () => {
    const root = repo(steps(""));
    setState("FX-1", "in_progress", { dir: root });
    const r = setState("FX-1", "done", { dir: root, date: "2026-11-03" });
    expect(r.output).toContain("1 scenario (1 passed)");
    expect(status(root, "FX-1")).toBe("done");
    expect(validate(root).errors).toEqual([]);
  }, 30_000);

  it("keeps comments and other stories in state.yaml", () => {
    const intent = copyExample();
    edit(join(intent, "state.yaml"), (s) => `# kept\n${s}`);
    setState("HT-3", "in_progress", { dir: intent, date: "2026-11-04" });
    const after = readFileSync(join(intent, "state.yaml"), "utf8");
    expect(after.startsWith("# kept\n")).toBe(true);
    expect(after).toMatch(/HT-1:\n\s+status: done\n\s+plan_version: 2/);
    expect(after).toMatch(/HT-3:\n\s+status: in_progress\n\s+updated: 2026-11-04/);
    expect(after).toContain("queue: [HT-2, HT-3]");
  });

  it("appends each decision to decisions.md", () => {
    const intent = copyExample();
    const before = readFileSync(join(intent, "decisions.md"), "utf8");
    decide({ title: "Sort by due date", why: "People asked for it; manual order was rejected.", story: "HT-3", category: "product", date: "2026-11-04" }, intent);
    decide({ title: "Use one store module", why: "One place to change storage later." }, intent);
    const after = readFileSync(join(intent, "decisions.md"), "utf8");
    expect(after.startsWith(before)).toBe(true);
    expect(after).toContain("## 2026-11-04 — Sort by due date (HT-3)\n**Category:** product\n**Supersedes:** none\n\nPeople asked for it; manual order was rejected.\n");
    expect(after).toMatch(/## \d{4}-\d{2}-\d{2} — Use one store module\n\*\*Category:\*\* architecture/);
    expect(() => decide({ title: "No reason", why: " " }, intent)).toThrow(/Say why/);
    expect(validate(intent).errors).toEqual([]);
  });

  it("reads failing scenarios from cucumber-js and behave output", () => {
    expect(failingScenarios("Failures:\n\n1) Scenario: AC2 — Blank tasks are ignored # intent/features/tasks/add.feature:14\n")).toEqual(["AC2 — Blank tasks are ignored"]);
    expect(failingScenarios("Failing scenarios:\n  intent/features/tasks/add.feature:8  AC1 — Adding a task shows it at the top\n\n0 features passed")).toEqual(["AC1 — Adding a task shows it at the top"]);
  });
});

describe("build-a-story playbook", () => {
  const playbook = readFileSync(join(__dirname, "../skills/nikos-mode/playbooks/build-a-story.md"), "utf8");
  const index = readFileSync(join(__dirname, "../skills/nikos-mode/playbooks/index.md"), "utf8");

  it("plans, builds, verifies, records decisions and gates done", () => {
    const steps = [...playbook.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1]);
    expect(steps).toHaveLength(9);
    for (const cmd of ["nikos next", "clear skill", "nikos plan new", "state set <story-id> in_progress", "nikos verify <story-id>", "nikos decide", "state set <story-id> done"]) {
      expect(steps.some((s) => s.includes(cmd)), cmd).toBe(true);
    }
    expect(index).toMatch(/^\| build-a-story \| `build-a-story\.md` \|/m);
  });
});
