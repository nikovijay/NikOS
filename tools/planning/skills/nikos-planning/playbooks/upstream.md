# upstream

Plan against plans in other repos (a company or department plan) without ever
writing to them.

1. Ask which repos hold the plans above this one, and their branch. Repo access is the permission model: if the person can clone it, they can plan against it.
2. Add each to `planning/upstream.yaml` as `- repo: <owner>/<repo>` with `ref: <branch>` (and `url:` if it isn't on GitHub), once the person agrees.
3. Run `nikos planning sync`. It fetches a read-only copy of each into `.nikos/upstream/` (gitignored) and records the commit it read in `planning/upstream.lock`.
4. Report any repo it couldn't reach as unresolved, and carry on: an inaccessible plan is not evidence that it doesn't exist.
5. Refer to upstream key results and bets only by reference (`<owner>/<repo>#<id>`) in this repo's files. Never copy their content into this repo.
6. To see whether the plans above have moved on, run `nikos planning sync --check`; resync when it says a copy is stale.
7. Report every step with its evidence or its skip reason.
