import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../src/commands/init";
import { StateError, setState } from "../src/commands/state";
import { setupVerify } from "../src/commands/verify";

// Replays evals/proof-run-refused.md: a build that rounds down fails AC2, done
// is refused, and fixing the code (not the feature) lets the story finish.

const feature = `@TC-1 @release-1 @must @activity-getting-started
Feature: Add a tip to the bill

  As a diner
  I want to add a tip to my bill
  So that I know what to pay

  @AC1 @must
  Scenario: AC1 — A 20% tip on a 50 bill
    Given a bill of 50
    When I add a 20% tip
    Then the total is 60.00

  @AC2 @must
  Scenario: AC2 — The total rounds to the nearest cent
    Given a bill of 33.33
    When I add a 15% tip
    Then the total is 38.33
`;
const steps = `import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { totalWithTip } from "../../tip.js";
Given("a bill of {float}", function (bill) { this.bill = bill; });
When("I add a {int}% tip", function (percent) { this.total = totalWithTip(this.bill, percent); });
Then("the total is {float}", function (expected) { assert.equal(this.total, expected.toFixed(2)); });
`;
const tip = (round: string) => `export function totalWithTip(bill, percent) {
  return (Math.${round}(bill * (1 + percent / 100) * 100) / 100).toFixed(2);
}
`;

describe("proof run: done refused", () => {
  it("refuses done while a scenario fails, then accepts it once the code is fixed and the feature is unchanged", () => {
    const root = mkdtempSync(join(tmpdir(), "nikos-refused-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "tip", type: "module" }));
    init(root, { name: "Tip Calculator", key: "TC" });
    const featurePath = join(root, "intent/features/getting-started/first-story.feature");
    writeFileSync(featurePath, feature);
    setupVerify(root);
    symlinkSync(join(__dirname, "../node_modules"), join(root, "node_modules"));
    mkdirSync(join(root, "test/steps"), { recursive: true });
    writeFileSync(join(root, "test/steps/tip.steps.mjs"), steps);
    writeFileSync(join(root, "tip.js"), tip("floor"));
    setState("TC-1", "in_progress", { dir: root });

    let refused: StateError | undefined;
    try {
      setState("TC-1", "done", { dir: root });
    } catch (err) {
      refused = err as StateError;
    }
    expect(refused?.message).toBe("TC-1 stays in_progress: its scenarios don't all pass:\n  ✗ AC2 — The total rounds to the nearest cent");
    expect(readFileSync(join(root, "intent/state.yaml"), "utf8")).toContain("status: in_progress");

    writeFileSync(join(root, "tip.js"), tip("round"));
    expect(setState("TC-1", "done", { dir: root }).to).toBe("done");
    expect(readFileSync(featurePath, "utf8")).toBe(feature);
  }, 60_000);
});
