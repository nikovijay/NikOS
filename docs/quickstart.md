# Quickstart: your first passing scenario in 10 minutes

You'll make a tiny tip calculator in an empty repo and finish with one story
whose acceptance criterion runs as a test and passes. You need Node 20 or
later and npm. Nothing is installed globally: every `nikos` command runs
through `npx`.

## 1. Make a repo (1 minute)

```bash
mkdir tip-calculator && cd tip-calculator
git init
npm init -y
npm pkg set type=module
```

## 2. Create the story map (1 minute)

```bash
npx -y nikos@latest init --name "Tip Calculator" --key TC
```

You should see:

```text
Created maps/tc/ (7 files)
✓ maps/tc/ is valid — 1 story, 1 release

Next: fill in constitution.md, then write your first story in maps/tc/features/.
```

`maps/tc/` now holds your story map, a state file, a delivery summary and one
starter story, TC-1. `constitution.md` and `decisions.md` sit at the root.
[docs/format.md](format.md) explains each file.

## 3. Write the story (2 minutes)

Replace the starter story with a real one. Save this as
**`maps/tc/features/getting-started/first-story.feature`**:

```gherkin
@TC-1 @release-1 @must @activity-getting-started
Feature: Add a tip to the bill

  As a diner
  I want to add a tip to my bill
  So that I know what to pay

  @AC1 @must
  Scenario: AC1 — A 20% tip on a 50 bill
    Given a bill of 50
    When I add a 20% tip
    Then the total is 60.00
```

The scenario is the acceptance criterion: TC-1 isn't done until it passes.
Check the folder is still well formed, and start the story:

```bash
npx -y nikos@latest validate
npx -y nikos@latest state set TC-1 in_progress
```

```text
✓ maps/tc/ is valid — 1 story, 1 release
TC-1: todo → in_progress
```

## 4. Set up the runner (2 minutes)

```bash
npx -y nikos@latest verify setup
npm install --save-dev @cucumber/cucumber@^12
```

`verify setup` notices this is a JavaScript repo and adds `cucumber.mjs`,
which runs every story in `maps/` as a test. Now run TC-1:

```bash
npx -y nikos@latest verify TC-1
```

It fails, and says why: none of the three steps has any code behind it yet.

```text
1 scenario (1 undefined)
3 steps (3 undefined)
```

## 5. Make it pass (3 minutes)

Write the code. Save this as **`tip.js`**:

```js
export function totalWithTip(bill, percent) {
  return (bill * (1 + percent / 100)).toFixed(2);
}
```

Connect each step to the code. Save this as **`test/steps/tip.steps.mjs`**:

```js
import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { totalWithTip } from "../../tip.js";

Given("a bill of {int}", function (bill) {
  this.bill = bill;
});

When("I add a {int}% tip", function (percent) {
  this.total = totalWithTip(this.bill, percent);
});

Then("the total is {float}", function (expected) {
  assert.equal(this.total, expected.toFixed(2));
});
```

Run it again:

```bash
npx -y nikos@latest verify TC-1
```

```text
1 scenario (1 passed)
3 steps (3 passed)
```

## 6. Call it done (1 minute)

```bash
npx -y nikos@latest state set TC-1 done
```

```text
TC-1: in_progress → done
```

`state set … done` runs the scenarios first and refuses if any fail, so a
story can't be marked done on the agent's word alone.

That's the whole loop: write the story, run it, make it pass, mark it done.

## Next: let your agent do it

Install nikOS in your agent tool ([docs/install.md](install.md)), then ask:

> Add a story for splitting the bill between people, and build it.

The `nikos-spec` skill picks the right playbook: it writes the story,
checks it, plans it, builds it, and stops at "done" only when the new
scenario passes.
