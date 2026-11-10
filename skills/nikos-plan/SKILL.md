---
name: nikos-plan
description: Plan the company's objectives, key results and bets in its one planning repo, and see how the code repos linked to it are delivering them. Use to set up a company's plan, add a department, group or team, plan a period, set OKRs or key results, frame or review a bet, check in on key results, or open the plan dashboard.
---

# nikos-plan

Planning sets direction; the nikOS story maps in each code repo handle delivery.
A key result is a figure with a baseline and target (`--direction down` when it
should fall), or a milestone of named steps (`--kind milestone --step`). A
milestone is marked with `kr step`, never checked in with a value.
The company keeps one planning repo. It has a folder for each level, and only
the company and departments hold key results. Every level holds bets.

```
planning/
  repos.yaml                  code repos this plan reads (nikos plan refresh)
  company/
    plan.yaml                 the company: name, year, pillars, owner
    decisions.md              the company's decisions
    krs/<kr-id>.yaml          key results: baseline, target, date and check-ins
    bets/<bet-id>.md          bets: the hypothesis, the key results they aim at, reviews
  departments/<id>/           a department: plan.yaml, decisions.md, krs/, bets/ (per quarter)
  groups/<id>/                a group: plan.yaml, decisions.md, bets/
  teams/<KEY>/                a team: team.yaml (its home and members), decisions.md, bets/
```

A bet never lists its stories. The story map says which bets it delivers: a
release in a code repo's `maps/<key>/storymap.yaml` carries `bets: [<bet-id>]`.
A bet's delivery (Shipped, Building, Not started) is worked out from those
stories; its outcome (open, awaiting evidence, won, lost, stopped) is set only
from key result evidence. Shipped is not won.

The commands are `nikos plan …`, run in the planning repo. Check `nikos --version`
against `npx -y nikos@latest --version` first: if `nikos` isn't installed or is
older, run them as `npx -y nikos@latest plan …` and tell the person once that
`npm install -g nikos@latest` updates theirs. Every write goes through the
commands or the dashboard, so the same checks always run. `--in <area>` picks
the area to write in: `company`, `departments/finance`, `groups/payments`,
`teams/WEB`, or just the id. Without it, the area is the folder you're in.

With no planning repo yet, make one first (`nikos plan init`, in a folder of
its own; the setup playbook walks through it). Never put company goals in `constitution.md`: that's one product's vision, not the company's plan.

## How to work

1. Read `principles.md` next to this file and keep it in mind.
2. Pick the playbook that matches the request, say which and why, and run
   every step of it in order:

| Playbook | File | Use when |
| --- | --- | --- |
| setup | `playbooks/setup.md` | The company has no planning repo yet, or a department, group or team needs adding. |
| wizard | `playbooks/wizard.md` | The person wants to plan a period: set objectives and key results, or the bets for a quarter, at company, department, group or team level. |
| bet | `playbooks/bet.md` | The person wants to frame one bet, or link a bet to the releases that deliver it. |
| checkin | `playbooks/checkin.md` | The person wants to check in on key results, record progress, or asks how a key result is doing. |
| review | `playbooks/review.md` | A bet is due for review, or the person wants to continue, change, stop or complete one and call its outcome. |
| status | `playbooks/status.md` | The person wants to see how the plan is doing: who is behind, delivery across the code repos, and what needs attention. |
| ladder | `playbooks/ladder.md` | A key result or bet has only `ladders_up` text and no link: list what it could link to, and link it or clear the text on the person's yes. |
| dashboard | `playbooks/dashboard.md` | The person wants to see the plan, or open or share the plan dashboard. |

3. Never write a planning file the person hasn't approved. Show what you will
   write first; write it only after their yes.
4. End with `nikos plan validate` and report every step with its evidence
   or its skip reason.
