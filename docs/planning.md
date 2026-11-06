# The planning/ format

The Planning pack keeps objectives, key results and bets in a `planning/`
folder at the repo root, next to `intent/`. Planning sets direction; the
story map in `intent/` handles delivery. Everything is plain text and only
changes when you (or your agent, with your yes) change it.

```
planning/
  plan.yaml              period, level, pillars and objectives
  krs/<kr-id>.yaml       key results and their check-ins
  bets/<bet-id>.md       bet cards
  upstream.yaml          optional: plans in other repos this one works toward
  upstream.lock          written by `nikos planning sync`
  views/<name>.html      optional: custom dashboard views
```

`nikos planning validate` checks every file against `schemas/planning/`.

## plan.yaml

**Purpose:** the planning context: the period, the level being planned
(company, department, group or team), its strategic pillars and objectives.

```yaml
period: Q1 2027
level: team
pillars: [Retention]
objectives:
  - id: keep-plants-alive
    title: People keep their plants alive
    aligns_to: acme/company-plan#plants-alive   # optional
```

## krs/&lt;kr-id&gt;.yaml

**Purpose:** one key result, with dated check-ins that are only ever added to.

```yaml
id: reminders-acted-on
title: Reminders acted on the same day
objective: keep-plants-alive
owner: Reminders team
unit: "%"
baseline: 41
target: 60
original_target: 60        # kept when the target is revised
by: 2027-03-31
aligns_to: acme/company-plan#kr-2   # optional, another repo's key result
stale_after_days: 14       # optional, default 14
checkins:
  - date: 2027-01-20
    value: 44
    note: First week of the new reminder time.
    evidence: https://analytics.example.com/reminders
```

Add one with `nikos planning kr new`, check in with `nikos planning checkin`,
and revise a target with `nikos planning kr target` (the original stays).

## bets/&lt;bet-id&gt;.md

**Purpose:** a bet: what we believe, the key results it should move, when we
review it, and every review decision since.

```markdown
---
id: reminders-that-stick
owner: Reminders team
team: Reminders
hypothesis: We believe reminders at each plant's real watering time get acted on the same day.
krs:
  primary: reminders-acted-on
  also: [acme/company-plan#kr-2]
starts: 2027-01-06
review_on: 2027-02-14
deadline: 2027-03-31        # optional: only a hard deadline
confidence: medium          # low | medium | high
dependencies: [Push notifications (Platform team)]
outcome: open               # open | awaiting evidence | won | lost | stopped
reviews:
  - date: 2027-02-17
    decision: continue      # continue | change | stop | complete
    reason: 55% against 60%. Keep going; review again 3 Mar.
---

## Why we think so
41% of reminders are acted on the same day; most misses arrive at night.
```

- A bet card has no `stories` field. The story map names the bets each
  release delivers (`bets:` on a release, `story_bets:` for one story; see
  [format.md](format.md)).
- `krs` may be empty for maintenance or risk-reduction work.
- Delivery (Shipped, Building, Not started) is worked out from the stories
  that deliver the bet. The outcome only changes at a review: stop sets
  `stopped`; complete sets `won` or `lost` from the key result evidence.

Write one with `nikos planning bet new`; review it with
`nikos planning bet review`.

## upstream.yaml and upstream.lock

**Purpose:** the plans in other repos this one works toward, read without
ever writing to them.

```yaml
- repo: acme/company-plan
  ref: main
  # url: https://git.example.com/acme/company-plan.git   (optional; defaults to GitHub)
```

`nikos planning sync` clones each into `.nikos/upstream/<owner>/<repo>/`
(gitignored; sync adds it to `.gitignore`) and writes the commit it read to
`upstream.lock`. A repo it can't reach is reported as unresolved and planning
carries on. `nikos planning sync --check` says whether an upstream has moved
past its locked commit. This repo only stores references like
`owner/repo#id`, never upstream content.

## views/&lt;name&gt;.html

**Purpose:** a custom dashboard view, served by `nikos planning serve` at
`/views/<name>`. It reads and writes only through the view contract in the
pack's dashboard playbook.
