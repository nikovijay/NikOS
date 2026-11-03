# Blueprint eval results

**Story:** NO-11. Idea to constitution, jobs to be done, founding hypothesis
and story map.
**Date:** 2026-11-03

## How it ran

A fresh Claude agent got the nikOS skills, the CLI, and three eval files.
Each file has a one-line idea and a founder's answer sheet. For each idea it
followed `nikos-mode` from the idea line in an empty folder. When the playbook
asked or confirmed something, it took the answer only from the sheet. Where
the sheet was silent, the rule was "you decide, and tell me what you chose".
The outputs are saved in `outputs/`. `test/blueprint-evals.test.ts` checks
them in CI: they validate, every story passes the mechanical CLEAR checks,
and both new constitution sections are filled in.

## Results

| Eval | Playbook picked | Stories | `nikos validate` | CLEAR (Lean, Executable) | CLEAR (judged) |
| --- | --- | --- | --- | --- | --- |
| 01 Thirsty (plant watering) | idea-to-blueprint | THI-1..3 | valid | 3/3 pass | pass after fixing THI-2 (overdue plants) |
| 02 Standin (async standups) | idea-to-blueprint | STA-1..3 | valid | 3/3 pass | pass after naming the three questions in STA-1 |
| 03 Nudge (invoice reminders) | idea-to-blueprint | NUD-1..3 | valid | 3/3 pass | pass after fixing NUD-1 (currency, privacy) and NUD-2 ("polite") |

I re-ran `nikos validate` and `nikos clear` on every output myself: no
errors, and 0 failed checks across all 9 stories.

## Gaps found, and what changed

The run used the first version of the playbook. These gaps led to the
version now in `skills/nikos-mode/playbooks/idea-to-blueprint.md`:

| Gap | Change |
| --- | --- |
| **The agent edited the spec to pass CLEAR without asking the founder.** Step 7 said "fix the spec until all five checks pass". The clear skill says to stop and wait for the spec to change. The agent followed step 7. | Step 7: propose each fix and change the spec only once the person agrees. |
| No decisions were recorded, though the agent chose the standup questions, invoice privacy and more. That leaves CLEAR's Accurate check with nothing to read. | New step 8: record every choice made on the person's behalf with `nikos decide`. |
| The product name was never asked for, but `nikos init --name` needs one. | Step 1 asks for the name. |
| The `idea:` line in the constitution was left for the agent to discover. | Step 2 fills it in. |
| Removing the example story left a choice about its `getting-started` activity. | Step 6 removes both. |
| The playbook pointed at `docs/gherkin.md`, which doesn't exist in a user's repo. | Step 6 spells out the conventions. |
| In eval 03 the idea says reminders are "sent", but First says the freelancer approves first. Nothing said to flag the conflict. | Step 3: point out a contradiction and ask which wins. |

Not fixed here:

- **No commands for writing stories.** Stories go in by hand: the feature
  files, the `storymap.yaml` releases and the `state.yaml` entries. NO-26
  (`nikos story add`) covers it.
- **The task list wasn't re-shown after each step.** The agent ran as a
  sub-agent with no task-list tool. NO-30 covers an eval for it.
- **The revised playbook hasn't been re-run against the three ideas.** The
  saved outputs come from the first version.
