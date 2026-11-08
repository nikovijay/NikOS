---
name: nikos-planning
description: Plan objectives, key results and bets in the repo's planning/ folder, linked to the nikOS story map that delivers them. Use when someone wants to organise their company's or department's goals, plan a period or quarter, set OKRs or key results, frame or review a bet, check in on their KRs, see or build a planning dashboard, or plan against a company or department plan in another repo.
---

# nikos-planning

Planning sets direction; the nikOS story map handles delivery. Planning lives
in `planning/` at the repo root, next to `intent/`:

```
planning/
  plan.yaml              period, level, strategic pillars and objectives
  krs/<kr-id>.yaml       key results: baseline, target, date and check-ins
  bets/<bet-id>.md       bets: what we believe, the KRs they should move, reviews
  upstream.yaml          optional: plans in other repos this one works toward
  upstream.lock          written by `nikos planning sync`
  downstream.yaml        optional: departments and teams that plan against this one
  views/<name>.html      optional: custom dashboard views
```

A bet never lists its stories. The story map says which bets it delivers: in a
group repo, each map under `maps/<id>/` names its one bet in `bet:`; in an
`intent/` repo, a release in `intent/storymap.yaml` carries `bets: [<bet-id>]` (or
`owner/repo#bet-id` for another repo's bet), and `story_bets:` overrides that
for a single story. A bet's delivery status (Shipped, Building, Not started)
is worked out from those stories; its outcome (open, awaiting evidence, won,
lost, stopped) is only ever set from the key result evidence. Shipped is not
won.

The commands are `nikos planning …`. Check `nikos --version` against
`npx -y nikos@latest --version` first: if `nikos` isn't installed or is older,
run them as `npx -y nikos@latest planning …` and tell the person once that
`npm install -g nikos@latest` updates theirs. Every write goes through them or
the dashboard, so the same checks always run.

With no `planning/` folder yet, set one up before planning: for a company or
department, `nikos company init` in a folder of its own (the nikOS skill's
onboard playbook walks through it); for a team, `nikos start` and then this
skill's wizard. Never put company goals in `intent/constitution.md`: that's one
product's vision, not the company's plan.

## How to work

1. Read `principles.md` next to this file and keep it in mind.
2. Pick the playbook that matches the request, say which and why, and run
   every step of it in order:

| Playbook | File | Use when |
| --- | --- | --- |
| wizard | `playbooks/wizard.md` | The person wants to plan a period: set objectives and key results, or the bets for a quarter, at company, department, group or team level. |
| bet | `playbooks/bet.md` | The person wants to frame one bet, or link a bet to the releases that deliver it. |
| checkin | `playbooks/checkin.md` | The person wants to check in on their KRs, record progress, or asks how a key result is doing. |
| review | `playbooks/review.md` | A bet is due for review, or the person wants to continue, change, stop or complete one and call its outcome. |
| upstream | `playbooks/upstream.md` | The person wants to plan against a company or department plan in another repo, or refresh it. |
| rollout | `playbooks/rollout.md` | The person wants to see how the departments or teams below their plan are doing: who has joined, who is behind, delivery and alignment across repos. |
| dashboard | `playbooks/dashboard.md` | The person wants to see the plan, open the dashboard, share a snapshot, or have a custom dashboard view built. |

3. Never write a planning file the person hasn't approved. Show what you will
   write first; write it only after their yes.
4. End with `nikos planning validate` and report every step with its evidence
   or its skip reason.
