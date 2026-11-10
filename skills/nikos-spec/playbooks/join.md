# join

Link this code repo to the company's planning repo, so its story maps can be
read into the plan, and so its maps take the company's settings and their owner's
team settings. The planning repo gets a branch for review, and this repo gets a
branch with the link.

1. Ask which planning repo the company plans in: its path, like `acme/company-plan`, and its host if it isn't GitHub (GitLab: `--host gitlab.com`). Ask only once the person has the repo in hand.
2. Check this repo has no uncommitted changes: a first join refuses one, and writes nothing. Then run `nikos join <path>` from this repo, once the person agrees. It lists this repo in the plan's `planning/repos.yaml` on a `nikos/join-…` branch, for the plan's owner to review, and commits `nikos.plan.yaml` (the settings its maps take from the plan) on a `nikos/link` branch here. Say which branches it made, and that this repo is now on `nikos/link`: `git switch <branch>` goes back. Nothing is pushed unless the person asks for `--push`.
3. Say what the link does: each map takes the company's settings and its owner's team settings from `nikos.plan.yaml`. This repo's own `nikos.settings.yaml` comes last and can change only what the plan leaves open. `nikos settings` shows where each value comes from. Say too that `main` takes these settings only once `nikos/link` is merged to it, so CI on `main` enforces none of them until then.
4. Report every step with its evidence or its skip reason.
