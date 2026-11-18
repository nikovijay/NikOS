# wizard

Plan a period with the person, at their level, and write it to the planning repo
only once they're happy with it.

1. Establish context. You need the period (the company's year, or a department's quarter, e.g. 2027-Q1), the area (company, a department, a group, a team or a squad, by its id) and, for the company, its pillars. Use whatever the person already said. Ask only for what is still missing, and ask those together in one go, not one question at a time. Key results and objectives stop at department level: a group, team or squad plans bets only, and its bets aim at the department's or company's key results.
2. Read what's already there: `nikos plan status --in <area>`. If the company or department has key results and bets, say so and ask whether to update them or start the period fresh.
3. Follow the path for the area:
   - Company: the objectives first, then the measurable key results for each (baseline, target, date, owner). Write each objective with `nikos plan objective add <id> --title "<title>" --in company` (and `nikos plan pillar add "<name>"` for a pillar that isn't there yet). A key result's `--objective` is that id, not free text. Ask whether existing company objectives should be updated.
   - Department: ask whether company priorities and key results exist to work from. Draft the department's own key results. Each may align to one or more company key results (`--aligns-to`, repeated), or be the department's own work for the period. A figure that should fall (days to close) is `--direction down`. A milestone is named steps: `--kind milestone --step "<name>"`, once for each step, and the steps can't change after it's made. If the key result above isn't known yet, write `--ladders-up "<text>"` in its place (not for a company key result) and link it later with the ladder playbook.
   - Group, team or squad: no key results and no objectives. State its bets for the period: each names the department or company key results it should move (`--kr <id>`, with `--also` for others), and may align to bets above it (`--aligns-to`), or stand on its own. A team's stories carry its own key, in its code repo's story map. A squad sits inside a team (`nikos plan add squad <id> --home <TEAM>`).
4. For each bet, follow the steps of `bet.md` up to writing it, and collect the drafts.
5. Show the whole draft: each key result and each bet, with the commands that will write them. Let the person revise it. Write nothing until they approve it.
6. Once they approve, write it: `nikos plan kr new <id> --in <area> …` for each key result and `nikos plan bet new <id> --in <area> …` for each bet. Both refuse a link that doesn't point at a key result or bet the plan already holds, and both refuse text and a link in the same command.
7. Run `nikos plan validate` and fix every error. A bet that names a code repo's story map which isn't read yet is a warning, not an error.
8. Report every step with its evidence or its skip reason.
