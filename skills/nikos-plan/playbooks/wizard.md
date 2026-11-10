# wizard

Plan a period with the person, at their level, and write it to the planning repo
only once they're happy with it.

1. Establish context. Ask for the period (the company's year, or a department's quarter, e.g. 2027-Q1), the area (company, a department, a group or a team, by its id) and, for the company, its pillars. Ask one question at a time. Key results stop at department level: a group or team plans bets only, and its bets aim at the department's or company's key results.
2. Read what's already there: `nikos plan status --in <area>`. If the company or department has key results and bets, say so and ask whether to update them or start the period fresh.
3. Follow the path for the area:
   - Company: the objectives first, then the measurable key results for each (baseline, target, date, owner). Ask whether existing company objectives should be updated.
   - Department: ask whether company priorities and key results exist to work from. Draft the department's own key results. Each may align to one or more company key results (`--aligns-to`, repeated), or be the department's own work for the period.
   - Group or team: no key results. State its bets for the period: each names the department or company key results it should move (`--kr <id>`, with `--also` for others), and may align to bets above it (`--aligns-to`), or stand on its own. A team's stories carry its own key, in its code repo's story map.
4. For each bet, follow the steps of `bet.md` up to writing it, and collect the drafts.
5. Show the whole draft: each key result and each bet, with the commands that will write them. Let the person revise it. Write nothing until they approve it.
6. Once they approve, write it: `nikos plan kr new <id> --in <area> …` for each key result and `nikos plan bet new <id> --in <area> …` for each bet. Both refuse a link that doesn't point at a key result or bet the plan already holds.
7. Run `nikos plan validate` and fix every error. A bet that names a code repo's story map which isn't read yet is a warning, not an error.
8. Report every step with its evidence or its skip reason.
