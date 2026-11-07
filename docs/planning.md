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
  downstream.yaml        optional: departments and teams that plan against this one
  decisions.md           in a plan-only repo: the plan's decisions, written by `nikos decide`
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
- repo: acme/company-plan             # on GitHub
  ref: main
- repo: acme/product/payments-plan    # on GitLab: the full path, with every group
  host: gitlab.com                    # or your self-managed host, e.g. gitlab.acme.com
- repo: acme/ops-plan
  url: ssh://git@git.example.com/acme/ops-plan.git   # any other git host
```

`repo` is the repo's path on its host: `owner/repo` on GitHub, or
`group/subgroup/project` on GitLab. The clone url is
`https://<host>/<repo>.git`, with `host` defaulting to `github.com`; `url`
overrides it for anything else, including SSH.

`nikos planning sync` clones each into `.nikos/upstream/<repo>/`
(gitignored; sync adds it to `.gitignore`) and writes the commit it read to
`upstream.lock`. It follows the chain upwards: the plans a copy names in its
own `upstream.yaml` are synced too, so a team that names its department also
gets the company plan. `nikos join <repo>` adds an entry and syncs in one step;
settings inherited this way are in [settings.md](settings.md). A repo it can't reach is reported as unresolved and planning
carries on. `nikos planning sync --check` says whether an upstream has moved
past its locked commit. This repo only stores references like
`acme/company-plan#kr-2` or `acme/product/payments-plan#faster-checkout`, never
upstream content.

## downstream.yaml and the rollout

**Purpose:** the departments and teams that plan against this one, so a
company or department can see how the rollout is going.

```yaml
- name: Payments
  repo: acme/payments-plan
- name: Growth                        # no repo yet
- name: Checkout
  repo: acme/product/checkout
  host: gitlab.com
```

Entries take the same `repo`, `ref`, `host` and `url` as `upstream.yaml`.
`nikos company init --departments` writes the names; `nikos planning
downstream add "<name>" --repo <path>` adds one or gives it its repo (add
`--host` for GitLab, or `--url` for any other git url, including SSH or a local
repo).

`nikos planning rollout` clones each listed repo read-only into
`.nikos/downstream/<repo>/` (gitignored), follows the plans each one lists in
its own `downstream.yaml`, and reports for each:

- **joined**: whether its `upstream.yaml` names this plan (this repo's path comes
  from its origin remote, or `--as <path>`)
- **synced**: when it last ran `nikos planning sync`, and whether it read this
  repo's current commit
- **delivery**: stories done, approved and in progress, from its story map
- **next**: the story its team builds next, as `nikos next` would say there
- **blocked**: each story with blockers in its state, and what's blocking it
- **decisions**: its latest three, newest first, from its `decisions.md`
- its key results and bets, and what each one points at

It also lists this repo's own latest decisions.

Above those it draws the alignment as a tree: each key result here, the key
results below that align to it (`aligns_to`), the ones that align to those in
turn, and the bets that name each one. Key results and bets that point at
nothing in the rollout are listed after the tree. The tree shows links only. A
key result's progress comes from its own check-ins and never from the ones
below it.

`--json` gives the same as data, and `--offline` reads the copies already
fetched. The dashboard's Rollout tab shows the same tree from the last fetch and
never fetches on its own. A repo it can't reach is reported as unreachable and the rest carry on.

## A plan-only repo

A company or department plan often has no story map: it plans, and the teams
below it deliver. A repo with `planning/` and no `intent/storymap.yaml` is a
plan-only repo, and needs no `nikos init`.

- `nikos decide` writes its decisions to `planning/decisions.md`, created on
  the first one, in the same format as `intent/decisions.md` (see
  [format.md](format.md)). `nikos decisions` searches it.
- `nikos doctor` checks the plan, its decisions, the approval settings it hands
  down, and the plans above and below it. It skips the story map, scenario
  runner and CI checks, which belong to the teams. It warns when
  `approval.policy` is locked and `approval.routes` isn't, since a team could
  still choose its own routes.

## views/&lt;name&gt;.html

**Purpose:** a custom dashboard view, served by `nikos planning serve` at
`/views/<name>`. It reads and writes only through the view contract in the
pack's dashboard playbook.
