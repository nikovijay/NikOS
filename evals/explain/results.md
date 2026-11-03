# Explain skills: stand-in run

**Story:** NO-14. Skills to explain what the spec says and why decisions
were made.
**Date:** 2026-11-03

A fresh Claude agent got only the `intent` and `decisions` skills and the
CLI, and answered four requests against `examples/hello-todo`, read-only.

| Request | Skill | Result |
| --- | --- | --- |
| `/intent HT-2` | intent | pass: user story, AC1, in progress and claimed by claude-code, plan v1 and the open bet, each cited by `path:line` |
| "What's the reorder story about and is anyone working on it?" | intent | pass: found HT-3 by topic; todo, unclaimed, second in the queue, no plan |
| `/decisions` why localStorage instead of a server | decisions | pass: quoted `intent/decisions.md:3-8` with date and story id, checked nothing supersedes it |
| `/decisions` why a dark colour theme | decisions | pass: said no decision is recorded, checked git history as history only, offered to log one and didn't |

## Gaps found, and what changed

| Gap | Change |
| --- | --- |
| `nikos show` named the linked bet but not its file, so the agent couldn't cite it. | The bet line includes `intent/bets/<id>.md`. |
| Nothing said whether being in the run queue counts as being worked on. | The intent skill says queued but unclaimed is waiting. |
| The retry after no match was a single guess ("dark theme"). | The decisions skill suggests other spellings too. |

Not run: `clear-review`, since a second reviewer needs a harness that can
hand work to another model or agent. It's covered only by the skill text test.
