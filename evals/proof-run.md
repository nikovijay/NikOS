# Proof run: building `split` with nikOS

> Note: this run predates the maps/ layout (PR 2b). Paths that say `intent/` are the 0.2 layout, which `nikos migrate maps` moves to `maps/<key>/`. The run was not repeated.

**Story:** NO-10. Build one small real app entirely with nikOS.
**Date:** 2026-11-03
**App:** `split`, a Node.js CLI that splits a restaurant bill, with tip,
between friends so every share is exact to the cent. It's a local repo
outside nikOS (`~/Downloads/nikos-proof-split`) with nikOS installed as a dev
dependency (`file:../nikos`).

## How it ran

1. **Spec, by hand, as a founder would.** `nikos init`, then the
   constitution, one activity and three stories written to the
   `docs/gherkin.md` conventions. All three passed `nikos validate` and the
   mechanical CLEAR checks before any code. Committed as the starting point.
2. **Build, by a fresh agent.** A separate Claude agent got only the repo,
   the three skills (`nikos-mode`, `clear`, `verify`) and `npx nikos`, and
   was asked "Build the next story" three times. It wasn't told how nikOS
   works. It was told never to hand-edit `state.yaml`, `decisions.md` or a
   `.feature` file.
3. **Check, by me.** I read the git history and re-ran everything.

## Results

| Story | Playbook picked | Attempts | Scenarios | State moved by |
| --- | --- | --- | --- | --- |
| SPL-1 Split a bill evenly with a tip | build-a-story | 1 | 3 passed | `nikos state set` |
| SPL-2 Split a bill by what each person ordered | build-a-story | 1 | 2 passed | `nikos state set` |
| SPL-3 Shares always add up to the total exactly | build-a-story | 1 | 2 passed | `nikos state set` |

Checked independently after the run:

- `npx nikos verify`: `7 scenarios (7 passed)`, `22 steps (22 passed)`.
- `git log -p intent/state.yaml`: after the spec commit, the only changes
  are `todo → done` plus `updated`, as `nikos state set` writes them. No hand
  edits.
- `git diff` of `intent/features/` since the spec commit: no changes. No
  scenario was edited to pass.
- `nikos validate`: valid. `decisions.md` gained 10 entries, all through
  `nikos decide`.
- `node src/cli.js 100 3` prints `Shares: 33.34, 33.33, 33.33`.

**The criterion holds:** three stories went from feature file to passing
scenarios with no manual edits to state.

## Gaps found

### Fixed in this PR

| Gap | Fix |
| --- | --- |
| The Gherkin lint only accepted the literal "As a", so "As the person holding the bill" (and any "As an …") failed `validate`. Hit while writing the spec. | Accepts "As a", "As an" and "As the". |
| `nikos state set` rewrote `queue: [SPL-1, SPL-2, SPL-3]` as `[ SPL-1, SPL-2, SPL-3 ]`. | Writes flow lists without padding. |
| `nikos verify setup` wrote step stubs for the init example story even though that story had been replaced, leaving a dead file in `test/steps/`. | Skips the stubs when the example story is gone. |
| The agent thought `nikos decide` had no `--category` or `--supersedes`, so all 10 decisions were filed as `architecture` and none was marked as superseding. The flags exist, but `nikos --help` didn't list them. | Help lists both flags. |
| Playbook step 3 said "write the approach in the new plan" without saying where; the agent wasn't sure it was allowed to edit the plan file. | Step 3 names the file. |
| SPL-3 changed a step definition SPL-1 relies on. Nothing re-checked SPL-1, though the agent did by hand. | Step 6 also runs every story's scenarios. |

### Follow-ups (not fixed here)

1. **Adding a story means hand-editing `storymap.yaml` and `state.yaml`.**
   There's no `nikos story add`. The spec commit did this by hand, before
   the build.
2. **The clear skill doesn't say whether to stop or decide on a small
   unstated rule.** SPL-3 never says how the tip rounds. The agent picked
   nearest cent and logged a decision, which seems right, but the skill
   should say so.
3. **Responsible is vague about money.** SPL-2 and SPL-3 handle money but
   have no scenario for invalid amounts. The agent passed them; a stricter
   reading would fail them. The skill needs a concrete bar.
4. **Interface choices live only in plans and decisions.** The features
   (rightly) don't name CLI syntax, so the command shape and output format
   were decided in plans. Nothing pins them for the next story.
5. **The task list wasn't kept up to date.** The agent had no task-list tool
   (it ran as a sub-agent), so it used the Markdown checklist fallback, as
   the skill allows. But it didn't re-show the list as steps changed, which
   the skill asks for. It also ran `state set in_progress` before writing
   the plan once (steps 3 and 4 swapped). Worth an eval.
6. **The "done refused" path wasn't exercised in the run.** Every story
   passed first time. It is covered by tests in `test/build-loop.test.ts`.
7. **`claimed_by` was never set.** The playbook doesn't pass `--by` to
   `state set in_progress`.

### Limits of this run

- The builder was a Claude sub-agent in Claude Code, not a fresh harness
  session with the skills loaded by the harness. Cursor and Codex weren't
  tried.
- I wrote the spec, not the agent. NO-11 covers going from an idea to a
  story map.
