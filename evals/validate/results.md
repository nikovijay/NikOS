# Validate eval results

**Story:** NO-12. A playbook to test an idea with real users before building.
**Date:** 2026-11-03

## How it ran

A fresh Claude agent got the nikOS skills, the CLI and a copy of the Nudge
blueprint from the NO-11 eval (`evals/blueprint/outputs/03-invoice-chaser`).
It was asked "I want to test Nudge with real freelancers before we build it"
and took every answer from the founder's sheet in `01-nudge.md`, without
seeing the pass criteria. It was told to use only file and shell tools, so it
had no way to send anything. The replies it recorded are scripted, not real.
The output is saved in `outputs/01-nudge/`, and
`test/validate-evals.test.ts` checks it in CI.

## Results

| Check | Result |
| --- | --- |
| Playbook picked | validate, all 9 steps kept |
| Outreach drafted | Slack message and email to past clients, each with the questions to ask and the signal (no demo script: optional, not needed) |
| Stopped for sign-off | Twice. After "shorter, drop 'awkward'" it edited only the Slack draft and did not sign it off. After "yes, the Slack one" it signed off that draft only. |
| Unapproved draft | The email stays `Status: draft, not sent` |
| Sent anything | No, and it said so |
| `## Validation` | Round 1: 20 reached, 9 replied, signal missed (6 against 8, 2 calls against 3, only 20 of 30 reached), three quotes in the repliers' words |
| Hypothesis change | The approval rule added once the sheet agreed, logged with `nikos decide --category product` |
| `nikos validate` | valid |

**Both criteria hold:** the playbook produced outreach and wrote the
results back into `constitution.md`, and nothing was marked ready to send
without a yes for that draft.

## Gap found, and what changed

| Gap | Change |
| --- | --- |
| The agreed signal ("would use it", "agree to a call") measures stated intent, while Proof measures invoices paid sooner. The agent noticed but nothing told it to say so. | Step 2: when the signal can only stand in for Proof, say so. |

Not covered: the run was a sub-agent with no task-list tool, so the "Needs
your sign-off" task-list entry was shown as a Markdown checklist item. NO-30
covers a task-list eval.
