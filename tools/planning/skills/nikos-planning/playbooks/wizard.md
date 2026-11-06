# wizard

Plan a period with the person, at their level, and save it to `planning/`
only once they're happy with it.

1. Establish context. Ask for the planning period (e.g. Q1 2027), the level (company, department, group or team) and the strategic pillars for that period. Ask one question at a time.
2. If `planning/upstream.yaml` lists plans above this one, run `nikos planning sync` and read the key results it fetched. If there is none, or a repo is unresolved, say so and carry on: parent alignment is optional, never an entry requirement.
3. Follow the path for the level:
   - Company: ask whether existing company OKRs should be updated. If there are none, start fresh: the objectives first, then the measurable key results for each (baseline, target, date, owner).
   - Department: ask whether there are company priorities and OKRs to work from, and whether the department wants its own OKRs. Draft them, and assign groups to each department key result.
   - Group or team: identify the group, and pull in its assigned key results where they're available upstream. If they aren't, continue independently: state the bets for the period, assign them to teams, and optionally map them to department key results.
4. For each bet, follow the steps of `bet.md` up to writing it, and collect the drafts.
5. Show the whole draft: `plan.yaml` (period, level, pillars, objectives), each key result and each bet, as the files that will be written. Let the person revise it. Write nothing until they approve it.
6. Once they approve, write it: `planning/plan.yaml` by hand from the approved draft, `nikos planning kr new …` for each key result and `nikos planning bet new …` for each bet.
7. Run `nikos planning validate` and fix every error. Report unresolved upstream references as unresolved, not as errors.
8. Report every step with its evidence or its skip reason.
