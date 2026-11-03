# Router eval results

| Date | Harness | How it ran | 01 change | 02 answer | 03 skip | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-11-03 | Claude Code CLI | `run.sh` | not run | not run | not run | The headless `claude -p` couldn't log in (expired OAuth session on the build machine). |
| 2026-11-03 | Claude (subagent) | Stand-in: given SKILL.md and each prompt, read-only | pass | pass | pass | Named the right playbook every time, copied all steps word for word, kept every skipped step with a concrete reason, and cited `intent/decisions.md:3-8` for 02. The 03 typo wasn't injected in this mode, so the agent correctly reported there was no typo. |
| — | Cursor | by hand | not run | not run | not run | Not installed on the build machine. |
| — | Codex | by hand | not run | not run | not run | Not installed on the build machine. |

A stand-in run shows the instructions work on their own. It doesn't prove a
harness loads the skill. Re-run `evals/router/run.sh` after `claude login`,
and run the prompts by hand in Cursor and Codex, then add a row here.
