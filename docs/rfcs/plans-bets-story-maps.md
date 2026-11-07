# RFC: plans, bets, story maps and team assignments

**Status:** draft, for review. Design only: nothing here is built yet.

## Summary

nikOS today puts one story map in a repo, beside that repo's plan, and lets
every level (company, department, group, team) set key results. This RFC
proposes the model nikOS should follow instead:

- **OKRs stop at department level.** The company and departments set
  objectives and key results. Lower-level OKRs tend to add noise rather than
  focus.
- **Bets exist at company, department and group level.** Each level's bets are
  its own. A department bet may align to a company bet, and a group bet to a
  department bet, or stand alone.
- **Groups create story maps, one or more per bet.** A story map specs exactly
  one bet. No plan owns a story map directly.
- **Teams are assigned work.** A team gets a whole story map, or specific
  activities or releases of one. Teams have no plan of their own.
- **Teams prove their stories in their own repos.** Each team repo fetches a
  read-only copy of the stories assigned to it, runs their scenarios against
  its code, and reports status back. Nothing is ever written to another repo.

## The model

```mermaid
erDiagram
  COMPANY_PLAN ||--|{ OBJECTIVE : sets
  DEPARTMENT_PLAN ||--|{ OBJECTIVE : sets
  DEPARTMENT_PLAN }o--|| COMPANY_PLAN : "plans against"
  GROUP_PLAN }o--|| DEPARTMENT_PLAN : "plans against"
  OBJECTIVE ||--|{ KEY_RESULT : "measured by"
  KEY_RESULT }o--o| KEY_RESULT : "department KR may align to company KR"
  COMPANY_PLAN ||--o{ BET : owns
  DEPARTMENT_PLAN ||--o{ BET : owns
  GROUP_PLAN ||--o{ BET : owns
  KEY_RESULT }o--o{ BET : "moved by"
  BET }o--o| BET : "may align to a bet one level up"
  BET ||--o{ STORY_MAP : "group bets are specced by"
  STORY_MAP ||--|{ ACTIVITY : has
  STORY_MAP ||--|{ RELEASE : has
  RELEASE ||--o{ STORY : contains
  ACTIVITY ||--o{ STORY : groups
  TEAM ||--o{ ASSIGNMENT : "is given"
  ASSIGNMENT }o--|| STORY_MAP : "whole map, activities or releases"
```

| Level | Objectives and key results | Bets | Story maps |
| --- | --- | --- | --- |
| Company | Yes | Yes, each aimed at company key results | No |
| Department | Yes. A key result may align to a company one, or be the department's own | Yes. May align to a company bet, or stand alone | No |
| Group | No | Yes. May align to a department bet, or stand alone, and aims at department or company key results | Yes, one or more per bet |
| Team | No | No | No: assigned all or part of a group's story map |

Two rules from today carry over unchanged:

- **Links show alignment, not contribution.** A key result's progress comes only
  from its own check-ins, and a bet's outcome only from its own reviews. Nothing
  adds up from the levels below.
- **Each level is its own repo, and joins the one above it** with `nikos join`.
  Settings and locks are inherited down the chain as they are today.

## What changes from 0.2.4

| Today | Proposed |
| --- | --- |
| Key results at company, department, group and team level | Key results at company and department level only. `nikos planning validate` refuses them in a group plan |
| A bet links only to key results | A bet can also align to one bet in the plan directly above |
| One story map per repo, in `intent/` | A group repo holds several story maps, one per bet, under `maps/` |
| Releases name the bets they deliver (`bets:`, `story_bets:`) | The story map names its one bet; releases and stories don't |
| A bet's delivery counts stories in its own repo only | A bet's delivery counts every story map that specs it, with status from the assigned teams' repos |
| The story map and the code are in the same repo | The story map is in the group's repo; the code and the done gate are in each team's repo |
| A team repo has `intent/` and can have its own plan | A team repo has its code and a read-only copy of its assigned stories |

## Storage

### Company and department repos

As today's plan-only repos: `planning/plan.yaml` (`level: company` or
`department`), `planning/krs/`, `planning/bets/`, `planning/decisions.md`,
`planning/upstream.yaml`, `planning/downstream.yaml` and `nikos.settings.yaml`.
No `intent/`.

A bet card gains one optional field:

```yaml
aligns_to: acme/company-plan#one-tap-pay   # a bet in the plan directly above
```

### Group repos

```
planning/
  plan.yaml                 level: group, period, pillars (no objectives)
  bets/<bet-id>.md          the group's bets, each aimed at department or company key results
  decisions.md
  upstream.yaml             the department plan
maps/
  <map-id>/
    storymap.yaml           bet: <bet-id>, key, activities, steps, releases
    features/               one .feature per story, as today
    plans/                  versioned story plans, as today
    assignments.yaml        which team has which part of the map
    approvals/              intent approvals: the spec, signed off by its owners
```

A group bet card names key results the way bets do today (`krs.primary`,
`krs.also`), pointing at the department's or company's (`acme/payments-plan#kr-2`).
A group plan has no `krs/` folder.

`assignments.yaml`:

```yaml
- team: Checkout web
  repo: acme/checkout-web
  releases: [1, 2]              # or activities: [pay, confirm], or neither for the whole map
- team: Checkout API
  repo: acme/checkout-api
  activities: [refund]
```

`nikos validate` checks that every story is assigned to at most one team. It
lists the stories nobody has yet.

### Team repos

A team repo is the code, plus:

```
nikos.team.yaml             the team's name and the group repos it takes work from
.nikos/assigned/<group repo>/<map-id>/   read-only copy of the assigned stories (gitignored)
test/steps/                 step definitions, as today
status/<story-id>.yaml      the team's status for each assigned story, with evidence
approvals/<story-id>.yaml   delivery approvals: this spec, at this tested commit
```

`nikos sync` fetches the assigned stories and records the commit it read, the
same way `nikos planning sync` does for plans. `nikos verify` runs the copied
features against the team's own step definitions and code. `nikos state set`
writes `status/`, and the done gate works exactly as it does today.

## How status flows back

Nothing is written across repos. The group repo reads its teams' repos:

1. `nikos map status` in the group repo fetches each assigned team repo
   read-only, as `nikos planning rollout` does. For each story, it reads the
   team's `status/` and `approvals/`.
2. A story's status is the team's status, as long as the team proved it against
   the story's current feature (`spec_hash`) and the team's copy isn't behind.
   Otherwise it shows as changed or behind, with what to do.
3. A bet's delivery (Shipped, Building, Not started) is worked out from every
   story map that specs it. A department bet's delivery can show the group bets
   aligned to it, as delivery only. Its outcome is still its own.

Approvals split by what they sign off:

- **Intent approval**, in the group repo: the story's spec, signed off by its
  owners.
- **Delivery approval**, in the team repo: this spec, at this tested commit,
  with this evidence.

The verified-approvals RFC applies to both.

## Commands (proposed)

| Where | Command | What it does |
| --- | --- | --- |
| Company | `nikos company init` | As today |
| Department | `nikos company init --level department` | A department plan with no story map (PR #71) |
| Group | `nikos group init` | A group plan: bets, no key results, `maps/` |
| Group | `nikos map new --bet <bet-id> --key <KEY>` | A story map for one bet |
| Group | `nikos assign "<team>" --repo <path> [--activities a,b \| --releases 1,2]` | Assign a team all or part of a map |
| Group | `nikos map status` | Fetch the team repos and show each story's status |
| Team | `nikos team init` / `nikos team join <group repo>` | Make a code repo a team repo, and take work from a group |
| Team | `nikos sync` | Fetch the assigned stories |
| Team | `nikos next`, `verify`, `state set`, `approve` | As today, on the assigned stories |

Today's story map commands (`story add`, `release add`, `clear`, `show` and the
rest) run in the group repo. They take `--map <map-id>` when there's more than
one map, and work without it when there's one.

## Views

Each company and department plan gets two views for a chosen period, read left
to right:

- **OKRs and bets:** the key results above that this plan's align to, this
  plan's key results grouped by objective, its bets, and the bets above they
  align to. Bets are marked as aligned or the plan's own.
- **OKR ladder:** company and department key results in two columns, with the
  chosen plan's chain highlighted.

A group plan gets:

- **Bets and story maps:** each bet, the department bet it aligns to, its story
  maps, the teams assigned to each part, and each story's status from those
  teams.

These replace today's Rollout tab and alignment tree. Links stay links: no view
adds up progress.

### Managing from the dashboard

The dashboard (`nikos serve`) becomes the easiest way for each level to manage
its own part of the hierarchy, without the command line. Today it can already
save check-ins, bets and bet reviews. It would cover:

| Level | What it can change in the dashboard |
| --- | --- |
| Company | Objectives, key results and check-ins; bets and their reviews; which key results each bet aims at; the departments listed below; the approval settings it hands down |
| Department | The same for its own plan, plus aligning a key result to a company key result and a bet to a company bet, picked from the synced copy of the company plan |
| Group | Bets and reviews; aligning a bet to a department bet; creating a story map for a bet; activities, steps, releases and story titles (scenarios are left to the agent); assigning teams to a whole map, activities or releases |

Rules that keep it safe:

- **It only writes to its own repo.** A department aligns its key result to a
  company one by writing a reference in its own repo, never by editing the
  company's. Plans above and below are shown from read-only copies.
- **Every save goes through the same commands and checks** as the CLI, so a
  save the CLI would refuse is refused with the same message.
- **Changes are commits a person reviews.** Saves land on a branch, and the
  dashboard shows the pending changes and offers to commit them and open a pull
  or merge request. Planning changes get reviewed the same way code does, and
  approval rules apply.
- **It runs locally**, with the person's own git access, as today. It stays a
  local, single-person tool. A hosted, always-on, multi-person editing service
  is out of scope for nikOS.

### For people who don't use git

Someone who doesn't use git can still do their part, with a git user bringing
it in:

1. **A git user sends them an editable snapshot.** `nikos serve --export
   plan.html --editable` writes the dashboard as one HTML file, as
   `--export` does today, with editing switched on. It records the commit it
   was made from. By default it contains only this level's own plan, so it can't
   leak other plans; `--with-linked` adds the read-only copies the dashboard
   shows, for people allowed to see them.
2. **They edit in their browser.** They open the file, with no install and no
   network. They make their changes (a check-in, a new key result, a bet
   review), and the same checks run in the page as in the CLI. Then they choose
   **Download changes**.
3. **They get a change file.** `<plan>-changes-<date>.nikos.json` lists each
   change as an operation, such as "check in kr-2: 44 on 2027-01-20, evidence
   …", not as raw file edits. It also records who made the changes (as they
   typed it) and the commit the snapshot came from.
4. **A git user applies it.** `nikos apply <file>` makes a branch and applies
   each operation through the same commands. It runs validation and shows what
   changed, then offers to commit and open a pull or merge request. If the plan
   has moved on since the snapshot, each operation is checked against the
   current files. One that no longer applies (say, a check-in on a key result
   that was since removed) is listed with the reason, and the rest still apply.

The change file holds no credentials and does nothing on its own: it only
takes effect when a git user applies it and the change is merged, so
review and approval rules still hold. The name typed in the browser is
attribution, not verified identity (see `verified-approvals.md`).

In the dashboard, story editing stops at structure: titles, activities, steps,
releases and assignments. Gherkin scenarios are left to the agent, which writes
them, checks them with CLEAR and asks for approval.

An editable snapshot holds only this level's own plan by default. Plans above
and below, which the dashboard shows from read-only copies, are left out unless
the git user asks for them with `--with-linked`. Links to them still show as
references, so a department can still see which company key result its own
aligns to.

## The smallest setup

A small company may have one department, one group and one team. That's four
repos, which is heavy for a start. Two shortcuts keep the model without the
weight:

- A group repo can also be its team's code repo: assign the team with
  `--repo .`, and its stories are verified in place.
- A company plan can list groups directly when there are no departments. The
  group's bets then align to company bets.

## Migration from 0.2.x

- **A repo with `intent/` and code:** `nikos migrate maps` moves `intent/` into
  `maps/<key>/`, asks which bet the map specs, and assigns the repo's own team
  with `--repo .`. Releases' `bets:` and `story_bets:` become the map's `bet`,
  or stay as a warning when they named several.
- **Key results in group or team plans:** `nikos planning validate` warns and
  suggests moving each one to the department, or rewriting it as a bet aimed at
  a department key result. Nothing is deleted.
- **A team plan** (from the 0.2.4 wizard): flagged by `nikos doctor`, with the
  same suggestion.
- `nikos doctor` explains each step, and every migration is a commit the person
  reviews.

## PR #71

#71 keeps the right first question (company, department or team) and adds
`--level department`. Its team option, a story map beside a team plan, is what
this RFC replaces. Proposed: close #71 unmerged, and carry `--level department`
and the three-way question (company, department or group, with team setup
separate) into the first implementation PR.

## Open questions

1. **One parent or several.** This RFC lets a bet align to one bet above at
   most, and a department key result to one company key result at most. Should
   either allow several?
2. **Changing assignments.** When a release moves from one team to another,
   what happens to the first team's status and approvals?
3. **Story ids.** Each map has its own key. Should ids also carry the group, to
   stay unique across a department?
4. **Trackers.** Should a tracker be connected per group (one project per story
   map) or per team?
5. **Shared step definitions.** Two teams assigned parts of one map may need the
   same steps. Should those live with the map or be copied?

## Not in scope

- Verified approver identity: see `verified-approvals.md`.
- Notes, research and asset links: see `knowledge-assets.md`.
- Team structures from an HR system: see `team-structure.md`.
