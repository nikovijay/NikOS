# join

Link this code repo to the company's planning repo, so its story maps can be
read into the plan. Nothing is written to the planning repo by this playbook.

1. Ask which planning repo the company plans in: its path, like `acme/company-plan`, and its host if it isn't GitHub (GitLab: `--host gitlab.com`). Ask only once the person has the repo in hand.
2. Run `nikos join <path>` from this repo, once the person agrees. It lists this repo in the plan's `planning/repos.yaml` on a `nikos/join` branch, for the plan's owner to review. Say which branch it made.
3. Say what joining does not do: settings don't come from the plan. This repo keeps its own `nikos.settings.yaml`, and `nikos settings` shows what applies here.
4. Report every step with its evidence or its skip reason.
