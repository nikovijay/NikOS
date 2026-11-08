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

## Levels

Each level is its own repo, and joins the one directly above it with
`nikos join`.

| Level | Objectives and key results | Bets |
| --- | --- | --- |
| Company | Yes | Yes, on company key results |
| Department | Yes. A key result may align to one or more company key results, or be the department's own | Yes. A bet may align to one or more company bets, or stand on its own |
| Group | No: OKRs stop at department level | Yes, on the department's (or company's) key results. A bet may align to one or more department bets, or stand on its own |

`nikos company init` writes a company plan, `nikos company init --level
department` a department's, and `nikos group init` a group's. A key result or
bet aligns only to the plan directly above it: `nikos planning kr new` and `bet
new` refuse anything else, and `nikos planning validate` checks it against the
synced copy. A plan at `level: team`, from before 0.3, still loads with a
warning: teams are assigned story maps by their group instead (see
[the RFC](rfcs/plans-bets-story-maps.md)).

## plan.yaml

**Purpose:** the planning context: the period, the level being planned
(company, department or group), its strategic pillars and objectives. A group
plan has no objectives.

```yaml
period: Q1 2027
level: department
pillars: [Retention]
objectives:
  - id: keep-plants-alive
    title: People keep their plants alive
    aligns_to: acme/company-plan#plants-alive   # optional; a list for several
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
aligns_to: acme/company-plan#kr-2   # optional: a company key result, or a list of several
stale_after_days: 14       # optional, default 14
checkins:
  - date: 2027-01-20
    value: 44
    note: First week of the new reminder time.
    evidence: https://analytics.example.com/reminders
```

Key results live in company and department plans only. Add one with `nikos
planning kr new` (`--aligns-to`, repeated for several), check in with `nikos planning checkin`,
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
aligns_to: [acme/company-plan#one-tap-pay]   # optional: bets in the plan directly above
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

A bet's `aligns_to` names the bets in the plan directly above that it
contributes to: a department bet to company bets, a group bet to department
bets. Leave it out for a bet that's the plan's own. Its outcome still comes only
from its own reviews.

Write one with `nikos planning bet new` (`--aligns-to`, repeated for several); review it with
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

## Story maps in a group repo

A group plan has `key:` in `plan.yaml`, chosen at `nikos group init --key`
(default: from the name). It's the GROUP in every story id, so each id is unique
across the company, e.g. `PAY-CHK-12`.

```
planning/plan.yaml     level: group, key: PAY
planning/bets/         the group's bets
maps/chk/              one story map per bet: storymap.yaml (key: CHK, bet: faster-checkout),
                       features/, plans/, approvals/, state.yaml
```

- `nikos map new --bet <bet-id> --key <KEY>` makes a map for one of the group's
  bets. The map's key is unique within the group, and its folder is the key, lowercased.
- With one map, the story commands work without `--map`. With more, pass `--map <id>`.
- `nikos validate` checks each map, and the group: every map has a key and a
  folder to match, and no two maps share a key.
- Keys are checked unique within the group. Checking that a group key is unique
  across the company is deferred: `nikos join` doesn't check plan keys today, and a
  group repo can't see other companies' keys.
- Team repos, assignments and status from teams: see [Teams](#teams).

## Teams

A team repo is its code, plus `nikos.team.yaml`. It takes the stories assigned to
it from one or more group repos, proves them against its own code, and keeps its
status where it can be read. Nothing is written to another repo.

```
nikos team init --name "Checkout web"             # in the team's repo; repo path from origin
nikos team join acme/payments/checkout-group      # take work from a group
nikos team member add "Priya Shah" --role Lead --handle priya-s
nikos sync                                        # fetch the assigned stories
```

In the group repo, assign the team part of a map:

```
nikos assign "Checkout web" --repo acme/checkout-web --releases 1
nikos assign "Checkout web" --repo . --map chk     # the group repo is its own team
```

`--activities`, `--releases` and `--stories` pick the part; with none, the team has
the whole map. `--url` and `--ref` say where the team's repo is and which branch to
read, when it isn't `https://github.com/<repo>.git` on `main`. They're stored in
`assignments.yaml` only when given, and a later `nikos assign` keeps them. Assigning a team more adds to what it has; `--replace` redefines its
part, and lists the stories it gave up. A story belongs to one team. Assigning a story another team holds
moves it only if it isn't done, and a done story moves only with `--include-done`.
The new team starts it at todo. `nikos validate` in the group repo lists the
stories nobody holds yet.

`nikos sync` copies what the team holds into `.nikos/assigned/<group repo>/`:
the map's storymap (releases keep only the team's stories), the features, the
bets, and the group's intent approvals. Plans and state aren't copied. The
group's `nikos.settings.yaml` and its `planning/upstream.yaml` are, so its locks
reach the team (see [Settings](settings.md)). Each copy is gitignored, and `nikos sync` rebuilds it. A group
that can't be reached keeps its last copy. When a story moves to another team,
the old team's `status/` for it gets `reassigned_to`, and the story leaves its
`nikos next`.

In a team repo, `nikos next`, `nikos state set`, `nikos verify`, `nikos approve`
and `nikos show` work on the assigned stories, by story id, so the same map key in
two groups never clashes. Status is written to `status/<id>.yaml`, and a delivery
approval to `approvals/<id>.yaml`. `done` records the commit the scenarios ran
at, and `approve` refuses when the code has changed since that commit or has
uncommitted changes. `nikos show` and `nikos validate` warn when code has changed
since an approval was tested, but an existing approval isn't lapsed by it: a
commit that only moves the team's own status or approvals doesn't count.

`nikos verify` runs the copies with the team's own step definitions. It lists any
step in the assigned stories that has no definition yet, as a warning.

A team repo can't also keep `intent/` or `maps/`. The story-writing commands
(`story`, `step`, `activity`, `release`, `map new`, `tracker import`), the plan
commands (`join`, `company`, `group`, `decide`) and `assign`, `migrate`, `planning`,
`start` and `init` are refused there, each with the place to run it instead: stories
are written in the group repo, and a team takes work with `nikos team join`. A team's
settings are its own `nikos.settings.yaml`, plus the locks of its group and company.

A team's CI runs `nikos sync` before `nikos validate` and `nikos verify`, since the
assigned stories are gitignored and a fresh checkout has none. `nikos ci setup` adds
that step to a team repo. The CI job also needs git read access to each group repo: a
private group needs a token that can clone it, which the job's default token may not
be. `nikos verify` with no story id says when nothing is synced.

`nikos doctor` in a team repo says which groups are synced, which have moved on,
and suggests a CODEOWNERS rule for the lead's approvals.

### Reading team status

A group repo sees its teams' work with `nikos map status`. It fetches each assigned
team's repo read-only, takes only its `status/`, `approvals/` and `nikos.team.yaml`,
and keeps them in `.nikos/teams/<repo>/` (gitignored). Nothing is written to a team's
repo. For each story it shows the holder's status, and whether the team proved it
against the story's current feature:

| Freshness | Meaning | What to do |
| --- | --- | --- |
| current | The team's status matches the feature. Done stories also show their delivery approval | Nothing. Where approval is required, a done story with no approval is awaiting one |
| changed | The team proved it done against an older feature | The team runs `nikos sync`, then `nikos state set <id> needs_rework`, then `in_progress`, then `done` |
| behind | Work in progress was written against an older feature | Run `nikos sync` in the team repo, then `nikos state set <id> needs_rework`, then `in_progress` |
| unverified | The status has no spec hash, from before hashes were written | Run `nikos sync` in the team repo, then `nikos state set <id> needs_rework`, then `in_progress` |
| moved | Another team holds it now | The old team runs `nikos sync` to record the move |
| unassigned | No team holds it | `nikos assign` gives it to a team |
| not-fetched | The team's repo couldn't be read | Check the repo, then run `nikos map status` |
| no-status | The team has no status for it yet | The team runs `nikos sync` and starts it with `nikos state set` |
| in-place | The group holds it itself (`--repo .`) | Nothing: its state is the group's own |

```
$ nikos map status
Map chk in acme/payments/checkout-group at 1a2b3c4 (3 stories, 2 teams)

Teams
  web  acme/checkout-web  fetched 2026-11-08 at 9f8e7d6
  pay  acme/checkout-pay  fetch failed: repository not found; showing copy from 2026-11-02 at 5c4b3a2

Stories
  STORY      TEAM  STATUS                              TICKET  DELIVERY         INTENT
  PAY-CHK-1  web   done, approved by ana 2026-11-03    PAY-12  approved by ana  approved by ana
  PAY-CHK-2  web   in_progress                         -       -                approved by ana
  PAY-CHK-3  pay   done (changed)                      -       not approved     -

Needs attention
  PAY-CHK-3  pay   proved it against an older feature: pay re-verifies and sets done again
```

Stories with no note are current. `--map <id>` reads one map; `--offline` reads the
copies from the last fetch, and never asks git; `--json` prints the same data for
an agent or a script. A team that can't be fetched doesn't fail the command: its
last good copy is shown, and its row says why. The MCP server has the same view as
`map_status`.

A story counts as done in a group's delivery only when its team's status is done,
current, and its delivery approval holds, or approval isn't required here (`approval.policy` is
`optional`, the default, or `off`). The bet's delivery (`nikos planning status`,
the dashboard, the rollout) reads the copies from the last fetch, so it doesn't wait
on the network: it says how many stories await approval, and how many teams it
couldn't read.

`nikos assign` reads a holder's done state from its copy when it's fetched. The
refusal names where it read the status and when the copy was fetched. With no copy,
it checks the group's own `state.yaml` and warns.

Limits:

- A team's copy keeps its feature text as it was, so a change to a feature in the
  group shows as `changed` or `behind` only once the team has written its status
  again. An assignment-only change (a story given to another team) shows as moved or
  no-status, not as behind.
- The cache is per machine. A new machine has no record of earlier moves, so a move
  shows as "previous team not fetched" until the first `nikos map status` there.
- Intent approvals are read, never written, for stories a team holds: a group's
  approval is `nikos approve` in the group, for its own stories.

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
