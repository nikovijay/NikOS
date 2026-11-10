import { describe, it, expect, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readdirSync } from "node:fs";
import { printUndefined, setupVerify, undefinedSteps, verify } from "../src/commands/verify";
import { groupRepo, write } from "./repo-fixture";

const ROOT = join(__dirname, "..");
const PYTHON = process.env.PYTHON ?? "python3";
const hasBehave = spawnSync(PYTHON, ["-c", "import behave"], { encoding: "utf8" }).status === 0;

/** Steps for the feature text in the group fixture: every line of the scenario has a definition. */
const STEPS_JS = `import { Given, When, Then } from "@cucumber/cucumber";
Given("a basket with one item", () => {});
When("I pay for it", () => {});
Then("I see a receipt", () => {});
`;

/** A group repo with its one map and its runner set up, with node_modules borrowed from this repo. */
function teamWithRunner(steps = STEPS_JS): string {
  const t = groupRepo("PAY");
  write(join(t, "package.json"), '{"name":"checkout-web","private":true}\n');
  setupVerify(t);
  symlinkSync(join(ROOT, "node_modules"), join(t, "node_modules"));
  write(join(t, "test/steps/steps.steps.mjs"), steps);
  return t;
}

describe("runner templates and setup", () => {
  it("js and ts runners read every map's features, and python's behave.ini names intent/features", () => {
    for (const stack of ["js", "ts"]) {
      const text = readFileSync(join(ROOT, "templates/verify", stack, "cucumber.mjs"), "utf8");
      expect(text).toContain("maps/*/features/**/*.feature");
      expect(text).toContain("intent/features/**/*.feature");
    }
    expect(readFileSync(join(ROOT, "templates/verify/python/behave.ini"), "utf8")).toContain("[behave]");
  });

  it("setup leaves an existing runner config alone", () => {
    const t = teamWithRunner();
    write(join(t, "cucumber.mjs"), "export default { paths: ['custom/**/*.feature'] };\n");
    const again = setupVerify(t);
    expect(again.skipped).toContain("cucumber.mjs");
    expect(readFileSync(join(t, "cucumber.mjs"), "utf8")).toContain("custom/**");
  });
});

describe("running the repo's stories", () => {
  it("cucumber finds a feature in the repo's own map and runs it", () => {
    const t = teamWithRunner();
    const r = verify(t, "PAY-CHK-1");
    expect(r.status).toBe(0);
    expect(r.output).toMatch(/1 scenario \(1 passed\)/);
  });

  it.skipIf(!hasBehave)("behave finds a feature in the repo's own map and runs it", () => {
    const t = groupRepo("PAY");
    rmSync(join(t, "package.json"), { force: true });
    write(join(t, "requirements.txt"), "behave\n");
    write(join(t, "steps/steps.py"), "from behave import given, when, then\n\n@given('a basket with one item')\ndef a(c): pass\n\n@when('I pay for it')\ndef b(c): pass\n\n@then('I see a receipt')\ndef d(c): pass\n");
    setupVerify(t);
    const r = verify(t, "PAY-CHK-1");
    expect(r.stack).toBe("python");
    expect(r.status).toBe(0);
    expect(r.output).toMatch(/1 feature passed/);
  });
});

describe("steps with no definition yet", () => {
  it("lists them from a dry run, for each story of the repo's map", () => {
    const t = teamWithRunner(STEPS_JS.replace('Then("I see a receipt", () => {});\n', ""));
    const steps = undefinedSteps(t, "js");
    expect(steps).toBeDefined();
    expect(steps!.map((s) => s.text)).toEqual(["I see a receipt", "I see a receipt", "I see a receipt"]);
    expect(steps!.map((s) => s.story).sort()).toEqual(["PAY-CHK-1", "PAY-CHK-2", "PAY-CHK-3"]);
  });

  it("says the test run will report them when the runner's output can't be read", () => {
    const t = teamWithRunner();
    write(join(t, "cucumber.mjs"), "throw new Error('the config is broken');\n");
    expect(undefinedSteps(t, "js")).toBeUndefined();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    printUndefined(undefined);
    expect(log).toHaveBeenCalledWith("! could not list undefined steps: the test run will report them");
    log.mockRestore();
  });

  it("prints nothing when every step has a definition", () => {
    const t = teamWithRunner();
    expect(undefinedSteps(t, "js")).toEqual([]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    printUndefined([]);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
