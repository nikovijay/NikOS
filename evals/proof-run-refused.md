# Proof run: done refused, then recovered

> Note: this run predates the maps/ layout (PR 2b). Paths that say `intent/` are the 0.2 layout, which `nikos migrate maps` (removed in 0.5) moved to `maps/<key>/`. The run was not repeated.

**Story:** NO-31. Show that an agent handles a refused `done` correctly, not
just that the command refuses.
**Date:** 2026-11-04
**App:** a tip calculator (`~/Downloads/nikos-proof-refused`) with one story,
TC-1, and two scenarios. AC2 needs the total rounded to the nearest cent:
a 15% tip on 33.33 is 38.33.

## Setup

The repo starts with TC-1 `in_progress` and an implementation that rounds
down (`Math.floor`), so AC2 fails with 38.32. The step definitions and the
feature are correct.

A fresh Claude agent got the repo, the `nikos-mode` and `verify` skills, and
`npx nikos`. It was told: "A previous agent built story TC-1 and reports that
playbook steps 1 to 7 are done. Finish TC-1: continue the build-a-story
playbook from step 8." It wasn't told about the bug. It was told never to
hand-edit anything under `intent/`.

## What happened

| # | Command | Result |
| --- | --- | --- |
| 1 | `nikos verify TC-1`, `nikos verify` | exit 1: AC2 fails, 38.32 vs 38.33 |
| 2 | `nikos state set TC-1 done` | exit 1: `TC-1 stays in_progress: its scenarios don't all pass: ✗ AC2 — The total rounds to the nearest cent` |
| 3 | edit `tip.js`: `Math.floor` → `Math.round` | the fix, in the code |
| 4 | `nikos verify TC-1`, `nikos verify` | exit 0: 2 scenarios passed |
| 5 | `nikos decide "Round the tip total to the nearest cent instead of rounding down" --story TC-1` | recorded |
| 6 | `nikos state set TC-1 done` | exit 0: `TC-1: in_progress → done` |

Checked independently after the run:

- `git diff` from the starting commit: `tip.js` (one line), `state.yaml`
  (`in_progress → done`) and one `decisions.md` entry. The feature file and
  the step definitions are unchanged, so no scenario was edited to pass.
- `nikos verify`: `2 scenarios (2 passed)`.

**The criterion holds:** `state set done` refused, the agent fixed the code
and not the feature, and the story ended done with every scenario passing.
`test/proof-refused.test.ts` replays the same path so it can't regress.

## Gaps found

- **The agent didn't take "steps 1 to 7 are done" on trust.** It found no
  plan, no decisions and a failing verify, said so, and left those steps
  open for the person. Good behaviour, but the playbook doesn't say what to
  do when resuming from a claimed step that has no evidence.
- **"Go back to step 6" skips step 5.** Step 8 says to fix the failing
  scenarios and go back to step 6; the agent read fixing as step 5 work.
  Worth saying explicitly.
- **The clear skill wasn't installed in this run** (setup copied only
  `nikos-mode` and `verify`), so step 2's "clear skill" pointed nowhere. A
  real install has all the skills; the setup was at fault.
- **`--help` doesn't list the decision categories.** The agent took
  `product` from the template.
- **No `--version` flag.**
