# Settings, and how a company shares them

`nikos.settings.yaml`, at a code repo's root, holds the choices that shape how
nikOS works there: whether stories need approval, and which tracker the team
uses. Each code repo keeps its own file. A code repo linked to the company's
plan with `nikos join` also takes settings from the plan: the company's, and
those of its map owner's team. Its own file comes last, and it can change only
what the plan leaves open.

Inside the company's planning repo the areas share settings too. The company sets
them once, in `nikos.settings.yaml` at the planning repo's root, and each department,
group and team inherits them down the folders, and can change anything the levels
above haven't locked.

```yaml
format_version: 1
approval:
  policy: required-for-release   # off | optional (default) | required-for-release
  routes: [app, chat]            # the ways an approval counts: app, chat, terminal
tracker:
  system: jira                   # none | jira | linear | github | gitlab | azure-devops | shortcut
  site: acme.atlassian.net
  project: PAY
  statuses:                      # each tracker status, and what it means to nikOS
    To Do: todo
    In Progress: in_progress
    Done: done
    Accepted: approved
    Won't Do: cancelled
  approvals: false               # true: a ticket moved to an "approved" status approves the story
locked: [approval.policy, approval.routes]   # the levels below can't change these
```

Every key is optional. See what applies, and where each value comes from:

```
$ nikos settings
approval.policy: "optional"  (acme/company-plan company; locked by acme/company-plan company)
approval.routes: ["app","chat","terminal"]  (default)
tracker.system: "jira"  (acme/company-plan departments/finance)
tracker.project: "PAY-WEB"  (this repo)
…
```

Change one for this repo with `nikos settings set tracker.project PAY-WEB`.
A key a level above locked is refused, and the message says who locked it.
In the planning repo, `nikos plan settings --in <area>` shows the same for an
area, and `nikos plan settings set <key> <value> --in <area>` changes it. It
refuses if a level above locked it.

## Approval policy

- **off**: no approvals. The agent doesn't ask, and `nikos approve` refuses.
- **optional** (the default): when a story is done, the agent asks "Do you want
  to approve …?". Approvals are recorded and shown, but never hold anything up.
- **required-for-release**: `nikos release check` counts a done story without a
  sign-off as a gap. Day-to-day work isn't held up; shipping is.

`approval.routes` says which ways of approving count: through the app (`nikos
mcp` asks you directly), in chat (you answered your agent), or in a terminal.
To make approvals need the right reviewer, protect the main branch and add a
`CODEOWNERS` rule for `maps/*/approvals/`. `nikos doctor` checks for it.

## Settings in the company's plan

In the planning repo, the company's settings live in `nikos.settings.yaml` at the
root, and every area inherits them down the folders: `planning/departments/<id>/`,
`planning/groups/<id>/` and `planning/teams/<KEY>/`. Each level resolves from
the defaults, then the company, then each level down to the area itself. A
locked value stays as the level that locked it set it. If two levels lock the
same key, the one nearest the top applies.

## Settings in a code repo linked to a plan

A code repo linked to the plan (see [Joining a company plan](#joining-a-company-plan))
has a committed file, `nikos.plan.yaml`, at its root. It holds a copy of the
company's settings file and of each map owner's chain of team settings: the
department and group above the team, and the team itself. Commands read that
copy and never the network, so `nikos settings`, `nikos validate`,
`nikos release check` and CI work offline.

Each map's `owner` (in its `storymap.yaml`) picks the chain its stories take.
Lowest first, each level changes only what the levels above haven't locked:

1. the defaults
2. the company's settings (the plan's root `nikos.settings.yaml`)
3. the owner's department, group and team, top to bottom
4. this repo's own `nikos.settings.yaml`

A locked key stays as the level that locked it set it. So the repo's own file
can set `tracker.project` (a value the team left open), but a value it sets on
a key the company locked is ignored, and `nikos settings` and `nikos doctor` say so.

Which chain `nikos settings` shows: the owner the repo's maps agree on. If the
maps have different owners, it shows the company's settings only and says why.
A command that works on one story (`nikos approve`, `nikos release check`) uses
that story's map owner.

- A map with no `owner`, or an owner with no team in the plan, takes the company's
  settings only. `nikos doctor` warns about it.
- A repo with no `nikos.plan.yaml` reads its own file only, as before.

### Keeping the snapshot current

`nikos.plan.yaml` is a snapshot. It doesn't change when the plan does, until you
refresh it:

```
nikos settings pull        # reads the plan, using your own git access, and rewrites nikos.plan.yaml
```

`pull` uses the plan the link already names, and needs no `--url` or `--ref`.
If a settings file in the plan doesn't read, `pull` stops, names the file, and
keeps the last snapshot. Commit the refreshed file.

`nikos.plan.yaml` is generated, so don't edit it by hand. Its `sha256` catches a
hand edit: `nikos validate` fails on a mismatch, and says to run
`nikos settings pull`. That check is there to catch careless edits, not to
stop a determined one.

`nikos doctor` warns when the snapshot is more than 14 days old. Online (the
default), it also warns when the plan has a newer commit, whether or not that
commit touches settings. `nikos doctor --offline` skips that check.

## Joining a company plan

```
nikos join acme/company-plan                                  # on GitHub
nikos join acme/engineering/payments-plan --host gitlab.com   # on GitLab
```

`join` runs in a code repo, and makes two branches:

- In the planning repo, it lists this repo in `planning/repos.yaml`, on a
  `nikos/join-…` branch for the plan's owner to review. So the plan can read
  the story maps' delivery.
- In this repo, it commits `nikos.plan.yaml` (the settings its maps take from the
  plan) on a `nikos/link` branch. The repo is left on that branch, and `join`
  prints the `git switch` that goes back to the one you were on. `main` isn't touched.

Nothing is pushed unless you add `--push`, which sends both branches to their
origins.

`join` refuses, and writes nothing, when:

- this repo has uncommitted changes (untracked files count). Commit or stash them first.
- this repo is already linked to a different plan. One code repo takes its
  settings from one planning repo.

Joining the same plan again writes nothing new. If the plan's settings have
changed since the snapshot, it says to run `nikos settings pull`.

A repo joined before this release has no `nikos.plan.yaml`. Run
`nikos join <planning repo>` in it to write one.

## Checking a repo

`nikos doctor` checks the story map, the scenario runner, CI, approvals, the
tracker and the plan this repo is linked to. For a linked repo that is: the
snapshot (a hand edit fails, and one older than 14 days warns), whether the
plan has moved on (online only; `--offline` skips it), each map owner's team in
the plan, and any of this repo's own values that the plan locks. For each one it
says what it found, and the next thing to do when something's missing. Your agent
runs it when something seems off.

`nikos validate` checks the snapshot's `sha256`, offline, so CI fails on a hand edit.

## Keeping a tracker in step

nikOS never calls Jira, Linear, GitHub or GitLab itself. Your agent reads and
writes tickets through the tracker's own MCP, which you connect and sign in to
in your app, and hands what it read to `nikos tracker`. The tracker playbook
walks through it: connect, map the statuses, import or link, keep in step.

| Command | What it does |
| --- | --- |
| `nikos tracker link <story> <ticket>` | Link a story to its ticket (`PAY-123`, `ENG-42`, `#57`), in `state.yaml` |
| `nikos tracker record <story> --status "<status>" --by "<who>"` | Record what a ticket says. A status mapped to `approved` approves the story when `tracker.approvals` is on (recorded as `via: tracker`, with who moved it); `cancelled` cancels it; anything else is only compared |
| `nikos tracker sync [--json]` | For each linked story, the status its ticket should be in. Your agent moves the tickets |
| `nikos tracker import <tickets.json>` | Bring a backlog in: `[{ "key", "title", "group" }]` become linked todo stories, each group an activity |

A ticket can never move a story to done. Done means the story's scenarios
pass, so when a ticket says Done and nikOS doesn't agree, nikOS keeps its own
status and lists the ticket to move back.
