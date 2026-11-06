# upstream

Plan against plans in other repos (a company or department plan) without ever
writing to them.

1. Ask which repos hold the plans above this one, and their branch. Repo access is the permission model: if the person can clone it, they can plan against it.
2. Add each to `planning/upstream.yaml` as `- repo: <path>` with `ref: <branch>`, once the person agrees. The path is the repo's path on its host: `owner/repo` on GitHub, or the full `group/subgroup/project` on GitLab. Add `host: gitlab.com` (or their self-managed host) for GitLab, or `url:` for any other git host.
3. Run `nikos planning sync`, or `nikos join <path>` to add one and sync in a single step. It fetches a read-only copy of each into `.nikos/upstream/` (gitignored), follows each one's own upstream plans up to the company, and records the commit it read in `planning/upstream.lock`. Show the person the settings this repo now inherits (`nikos settings`).
4. Report any repo it couldn't reach as unresolved, and carry on: an inaccessible plan is not evidence that it doesn't exist.
5. Refer to upstream key results and bets only by reference (`<repo path>#<id>`) in this repo's files. Never copy their content into this repo.
6. To see whether the plans above have moved on, run `nikos planning sync --check`; resync when it says a copy is stale.
7. Report every step with its evidence or its skip reason.
