# status

See how the plan is doing across its areas and the code repos linked to it,
without ever writing to those repos.

1. Run `nikos plan refresh` if the copies are old. It reads each code repo listed in `planning/repos.yaml`, read-only, and keeps its delivery copy under `.nikos/delivery/` on this machine. Git doesn't commit that copy, so each person who reads the plan runs it on their own machine. An unreachable repo keeps its last copy and is reported as unreachable.
2. Run `nikos plan status` (with `--in <area>` for one area, or `--json` for data). For each bet: its delivery, how old the copy is, and its outcome.
3. Lead with what needs someone's attention: stale key results, bets past their review date, bets whose story maps aren't read yet, and repos that couldn't be reached. An unreachable repo may only be one the person can't see: say so, never treat it as missing.
4. Then sum up in a few lines: how many bets are shipped or building, what each area is working toward, and which key results have nothing pointing at them.
   A story counts as done only when its code repo's own `nikos map status` says so; the plan shows that copy, not the live state.
5. Offer the dashboard (`nikos plan serve`) for the full view. A snapshot (`--export`) includes every area's plan: share it only with people allowed to see all of it.
6. Never message a team or open an issue in their repo yourself. Draft what the person could send, if they ask.
7. Report every step with its evidence or its skip reason.
