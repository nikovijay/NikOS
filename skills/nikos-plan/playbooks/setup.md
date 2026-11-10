# setup

Make the company's planning repo and add its departments, groups and teams. Ask
one question at a time, and do nothing outward-facing (creating a repo, sending
anything) without a yes.

1. Check the repo: the planning repo is its own folder, not a code repo and not one with a `maps/` folder. If the folder already holds code or another project, suggest a new folder named after the company, and create it only on a yes.
2. Ask the company's name and its year (the year it plans for, e.g. 2027), and the strategic pillars for the year if they have them (a comma list, optional).
3. Run `nikos plan init --name "<name>" --year <year> --pillars "<a, b>"` in that folder. It writes `planning/company/` with its `plan.yaml` and `decisions.md`. If the folder is a git repo, ask whether to commit these files; commit only on a yes.
4. Ask which departments, groups and teams the company has, one at a time. Add each with `nikos plan add department <id> --name "<name>"`, `nikos plan add group <id> --department <id> --name "<name>"`, or `nikos plan add team <KEY> --home <id>`. A team reports to a department or a group. Ask who owns each (`--owner`) if they know.
5. Ask which code repos build the company's work, and list each in `planning/repos.yaml` with `nikos join <path>` from that repo, or with `nikos plan refresh` once it's listed. Each repo's story maps show as delivery.
6. Run `nikos plan status` and `nikos plan validate`, and fix every error.
7. Report every step with its evidence or its skip reason.
