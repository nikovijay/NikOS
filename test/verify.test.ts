import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { init } from "../src/commands/init";
import { setupVerify, verify } from "../src/commands/verify";
import { detectStack } from "../src/verify/detect";

const repoModules = join(__dirname, "../node_modules");
const python = process.env.PYTHON ?? "python3";
const hasBehave = spawnSync(python, ["-c", "import behave"]).status === 0;

/** A new repo with `nikos init` run in it, plus the given files. */
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "nikos-verify-"));
  init(root, { name: "Fixture", key: "FX" });
  for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
  return root;
}

const passingJs = `import { Given, When, Then } from "@cucumber/cucumber";
let seen = [];
Given("I am a new user", () => { seen = ["given"]; });
When("I do the one thing this product is for", () => { seen.push("when"); });
Then("I see the result I came for", () => { if (seen.join() !== "given,when") throw new Error(seen.join()); });
`;

const passingPy = `from behave import given, when, then

@given("I am a new user")
def a(context):
    context.seen = ["given"]

@when("I do the one thing this product is for")
def b(context):
    context.seen.append("when")

@then("I see the result I came for")
def c(context):
    assert context.seen == ["given", "when"]
`;

describe("detect", () => {
  it("picks the runner from the repo's files", () => {
    expect(detectStack(fixture({ "package.json": "{}" }))).toBe("js");
    expect(detectStack(fixture({ "package.json": "{}", "tsconfig.json": "{}" }))).toBe("ts");
    expect(detectStack(fixture({ "package.json": '{"devDependencies":{"typescript":"^5"}}' }))).toBe("ts");
    expect(detectStack(fixture({ "pyproject.toml": "" }))).toBe("python");
    expect(detectStack(fixture({ "requirements.txt": "" }))).toBe("python");
    expect(detectStack(fixture({}))).toBeUndefined();
  });

  it("asks when the stack is unknown", () => {
    expect(() => setupVerify(fixture({}))).toThrow(/Ask which runner to use/);
  });
});

describe("verify", () => {
  it("runs the example feature in a JS fixture", () => {
    const root = fixture({ "package.json": '{"name":"fx","private":true}' });
    symlinkSync(repoModules, join(root, "node_modules"));
    const setup = setupVerify(root);
    expect(setup.created.sort()).toEqual(["cucumber.mjs", "test/steps/first-story.steps.mjs"]);
    expect(setup.install).toContain("@cucumber/cucumber");

    // The stubs run the example and report it pending: configured, but not proven.
    const pending = verify(root, "FX-1");
    expect(pending.output).toContain("1 scenario (1 pending)");
    expect(pending.status).not.toBe(0);

    writeFileSync(join(root, "test/steps/first-story.steps.mjs"), passingJs);
    const passed = verify(root, "FX-1");
    expect(passed.output).toContain("1 scenario (1 passed)");
    expect(passed.status).toBe(0);
  }, 30_000);

  it("runs TypeScript step files in a TS fixture", () => {
    const root = fixture({ "package.json": '{"name":"fx","private":true}', "tsconfig.json": "{}" });
    symlinkSync(repoModules, join(root, "node_modules"));
    expect(setupVerify(root).created).toContain("test/steps/first-story.steps.ts");
    writeFileSync(join(root, "test/steps/first-story.steps.ts"), passingJs.replace("let seen = []", "let seen: string[] = []"));
    const r = verify(root, "FX-1");
    expect(r.output).toContain("1 scenario (1 passed)");
    expect(r.status).toBe(0);
  }, 30_000);

  it.skipIf(!hasBehave && !process.env.CI)("runs the example feature in a Python fixture", () => {
    const root = fixture({ "pyproject.toml": "" });
    expect(setupVerify(root).created.sort()).toEqual(["behave.ini", "steps/first_story_steps.py"]);

    const pending = verify(root, "FX-1");
    expect(pending.output).toContain("NotImplementedError");
    expect(pending.status).not.toBe(0);

    writeFileSync(join(root, "steps/first_story_steps.py"), passingPy);
    const passed = verify(root, "FX-1");
    expect(passed.output).toContain("1 scenario passed, 0 failed");
    expect(passed.status).toBe(0);
  }, 30_000);

  it("skips the example step stubs once the example story is gone", () => {
    const root = fixture({ "package.json": "{}" });
    rmSync(join(root, "intent/features/getting-started"), { recursive: true });
    expect(setupVerify(root).created).toEqual(["cucumber.mjs"]);
  });

  it("skips the example step stubs once the example story is rewritten into a real one", () => {
    const root = fixture({ "package.json": "{}" });
    const path = join(root, "intent/features/getting-started/first-story.feature");
    writeFileSync(path, readFileSync(path, "utf8").replace(/Scenario:[\s\S]*$/, "Scenario: AC1 — A tip\n    Given a bill of 50\n    When I add a 20% tip\n    Then the total is 60.00\n"));
    expect(setupVerify(root).created).toEqual(["cucumber.mjs"]);
  });

  it("never overwrites existing runner files", () => {
    const root = fixture({ "package.json": "{}", "cucumber.mjs": "// mine\n" });
    const r = setupVerify(root);
    expect(r.skipped).toEqual(["cucumber.mjs"]);
    expect(readFileSync(join(root, "cucumber.mjs"), "utf8")).toBe("// mine\n");
  });

  it("refuses a story with no feature, and a repo with no runner config", () => {
    const root = fixture({ "package.json": "{}" });
    expect(() => verify(root, "FX-1")).toThrow(/Run `nikos verify setup` first/);
    setupVerify(root);
    expect(() => verify(root, "FX-9")).toThrow("No feature file is tagged @FX-9");
  });
});

describe("verify skill", () => {
  const skill = readFileSync(join(__dirname, "../skills/verify/SKILL.md"), "utf8");

  it("sets up the runner and never edits the feature to pass", () => {
    expect(skill).toMatch(/^name: verify$/m);
    expect(skill).toContain("nikos verify setup");
    expect(skill).toContain("nikos verify <story-id>");
    expect(skill).toMatch(/Never edit a `\.feature` file to make a scenario pass/);
  });
});
