# Settings, and how a company shares them

`nikos.settings.yaml`, at a code repo's root, holds the choices that shape how
nikOS works there: whether stories need approval, and which tracker the team
uses. Each code repo keeps its own file. A code repo linked to the company's
plan with `nikos join` does not inherit settings from it: it keeps its own.

Inside the company's planning repo the areas do share settings. The company sets
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
approval.policy: "required-for-release"  (this repo)
approval.routes: ["app","chat","terminal"]  (default)
tracker.system: "jira"  (this repo)
tracker.project: "PAY"  (this repo)
…
```

Change one for this repo with `nikos settings set tracker.project PAY-WEB`.
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

## Joining a company plan

```
nikos join acme/company-plan                                  # on GitHub
nikos join acme/engineering/payments-plan --host gitlab.com   # on GitLab
```

`join` runs in a code repo. It lists the repo in the planning repo's
`planning/repos.yaml`, on a `nikos/join` branch for the plan's owner to review,
so the plan can read its story maps' delivery. Nothing else in the code repo
moves, and its settings stay as they are.

## Checking a repo

`nikos doctor` checks the story map, the scenario runner, CI, approvals, the
tracker and the plan this repo is linked to. For each one it says what it found, and the
next thing to do when something's missing. Your agent runs it when something
seems off. 

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
