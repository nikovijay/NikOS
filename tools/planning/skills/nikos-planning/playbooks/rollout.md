# rollout

See how the plans below this one are doing (the departments and teams that plan
against it) without ever writing to their repos.

1. Run `nikos planning rollout`. It reads `planning/downstream.yaml`, fetches a read-only copy of each plan listed (and of the ones they list in turn) into `.nikos/downstream/` (gitignored), and reports for each: joined or not, when it last synced this plan, its delivery from its story map, and the key results and bets that point here.
2. If nothing is listed, ask which departments or teams plan against this one. Add each with `nikos planning downstream add "<name>" --repo <path>` once the person agrees (`--host gitlab.com` for GitLab, `--url` for any other git url). A name with no repo yet is fine.
3. Lead with what needs someone's attention: plans that haven't joined (offer the join line from the README), plans behind this one (they need `nikos planning sync`), stale key results, and plans it couldn't reach. An unreachable plan may only be one the person can't see: say so, never treat it as missing.
4. Then sum up delivery and alignment in a few lines: how many plans joined, stories done across them, and which key results here have nothing pointing at them.
5. Offer the Rollout tab in the dashboard (`nikos planning serve`) for the full view. A snapshot of it includes other repos' plans: share it only with people allowed to see them.
6. Never message a team or open an issue in their repo yourself. Draft what the person could send, if they ask.
7. Report every step with its evidence or its skip reason.
