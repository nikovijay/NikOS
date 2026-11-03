# Writing stories as feature files

Every story is one Gherkin `.feature` file in
`intent/features/<activity>/<story-slug>.feature`. The file is both the spec
and the test: each acceptance criterion is a scenario that Cucumber can run.
`nikos validate` checks all the rules on this page.

## The shape of a story

```gherkin
@HT-1 @release-1 @must @activity-tasks @effort-S
Feature: Add a task

  As a busy person
  I want to add a task in one step
  So that capturing it is faster than forgetting it

  @AC1 @must
  Scenario: AC1 — Adding a task shows it at the top
    Given my list is empty
    When I add the task "Call the bank"
    Then I see "Call the bank" at the top of my list

  @AC2 @should
  Scenario: AC2 — Blank tasks are ignored
    Given my list is empty
    When I add the task ""
    Then my list is still empty
```

## Rules

**One story per file.** Exactly one `Feature`, and exactly one story id tag.

**The user story goes in the Feature description.** Three lines under
`Feature:`, starting `As a`, `I want` and `So that`.

**Each acceptance criterion is a scenario.** Tag it `@AC1`, `@AC2` … and
start its title with the same label (`AC1 — …`). Labels are unique within
the file. A `Scenario Outline` counts as one criterion. Scenarios may sit
inside a `Rule:` block.

**Every scenario has a When and a Then.** `Given` is optional.

**Priority is a tag.** Exactly one of `@must`, `@should` or `@could` on the
Feature (the story's priority), and optionally one on each scenario (the
criterion's priority).

## Allowed Feature tags

| Tag | Meaning | Required |
|---|---|---|
| `@HT-1` | story id, using the project key | yes |
| `@release-N` | release the story is in | yes |
| `@must` / `@should` / `@could` | story priority | yes |
| `@activity-<id>` | activity, matching the folder name | no |
| `@effort-XS` … `@effort-XL` | size estimate | no |

Anything else is a warning, so you notice typos.

## Never put status in a feature

Tags like `@todo`, `@wip`, `@in-progress`, `@done`, `@blocked` or `@ready`
are errors. Status, owners, blockers and dates live in `intent/state.yaml`,
so a feature file only changes when the intent changes and its git history
reads as a history of decisions about the product.

## Keep it about behaviour, not implementation

Write steps the way a user would describe what happens: "When I add the task
'Call the bank'", not "When I POST to /api/tasks". Implementation detail
belongs in the story's plan. `nikos clear` flags file paths, endpoints and
framework names in feature text.

## Checking your work

```sh
npx nikos validate
```

Errors block (exit code 1); warnings are shown but don't fail.
