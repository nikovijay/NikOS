---
name: verify
description: Make a story's .feature file run as a test, and prove it passes. Use when a story's scenarios can't run yet, when setting up Cucumber in a repo, or before calling a story done.
---

# verify

A story is done when its scenarios pass, not when the code looks right.

## 1. Set up the runner once

If the repo has no `cucumber.mjs` (JavaScript or TypeScript) or `behave.ini`
(Python), run:

```
nikos verify setup
```

It picks cucumber-js or behave from the repo's files and writes the config
plus step stubs for the example story. It never overwrites a file. Then run
the install command it prints.

If it says it couldn't tell the stack, ask the person which runner they want.
Don't guess.

## 2. Write step definitions for the story

Step definitions go in `test/steps/` (JavaScript or TypeScript) or `steps/`
(Python). Write one for each step in the story's scenarios, and make each one
check the real behaviour of the app: click, call or read what a user would.

Never edit a `.feature` file to make a scenario pass. The feature is the spec.
If a scenario is wrong, say so and stop. Fixing it is a spec change for the
person to approve.

## 3. Run the story

```
nikos verify <story-id>
```

It runs only that story's scenarios and fails if no feature carries the tag.
Pending or unimplemented steps count as not passing.

## 4. Report what ran

Report the command and the runner's summary line, such as
`2 scenarios (2 passed)`. If anything failed or is pending, show the output
and don't call the story done.
