# wizard

Plan a period with the person, at their level, and save it to `planning/`
only once they're happy with it.

1. Establish context. Ask for the planning period (e.g. Q1 2027), the level (company, department or group) and the strategic pillars for that period. Ask one question at a time. OKRs stop at department level: a group plans bets only, and teams don't plan at all (their group assigns them work). A team repo joins its group with nikos team init and nikos team join; teams don't plan.
2. If `planning/upstream.yaml` lists plans above this one, run `nikos planning sync` and read the key results it fetched. If there is none, or a repo is unresolved, say so and carry on: parent alignment is optional, never an entry requirement.
3. Follow the path for the level:
   - Company: ask whether existing company OKRs should be updated. If there are none, start fresh: the objectives first, then the measurable key results for each (baseline, target, date, owner).
   - Department: ask whether there are company priorities and OKRs to work from. Draft the department's own objectives and key results. Each key result may align to one or more company key results (`--aligns-to`, repeated) or be the department's own: work it must do this period that the company didn't specify. Then its bets: each may align to one or more company bets, or stand on its own.
   - Group: no objectives or key results. Read the department's key results and bets from the synced copy. If they aren't, continue independently. State the group's bets for the period: each names the department (or company) key results it should move (`--kr acme/payments-plan#kr-id`), and may align to one or more department bets (`--aligns-to`), or stand on its own.
4. For each bet, follow the steps of `bet.md` up to writing it, and collect the drafts.
5. Show the whole draft: `plan.yaml` (period, level, pillars, objectives), each key result and each bet, as the files that will be written. Let the person revise it. Write nothing until they approve it.
6. Once they approve, write it: `planning/plan.yaml` by hand from the approved draft (a group plan has no `objectives`), `nikos planning kr new …` for each key result and `nikos planning bet new …` for each bet. Both refuse a link that doesn't point at the plan directly above.
7. Run `nikos planning validate` and fix every error. Report unresolved upstream references as unresolved, not as errors.
8. Report every step with its evidence or its skip reason.
