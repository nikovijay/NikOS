# Settings, and how a company shares them

`nikos.settings.yaml`, at a repo's root, holds the choices that shape how
nikOS works there: whether stories need approval, and which tracker the team
uses. A company sets them once in its plan repo. Departments, groups and teams
that plan against it inherit them, and can change anything the levels above
haven't locked.

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
locked: [approval.policy]        # the levels below can't change these
```

Every key is optional. See what applies, and where each value comes from:

```
$ nikos settings
approval.policy: "required-for-release"  (acme/company-plan; locked by acme/company-plan)
approval.routes: ["app","chat","terminal"]  (default)
tracker.system: "jira"  (acme/company-plan)
tracker.project: "PAY"  (acme/engineering/payments-plan)
…
```

Change one for this repo with `nikos settings set tracker.project PAY-WEB`.
It refuses if a level above locked it.

## Approval policy

- **off**: no approvals. The agent doesn't ask, and `nikos approve` refuses.
- **optional** (the default): when a story is done, the agent asks "Do you want
  to approve …?". Approvals are recorded and shown, but never hold anything up.
- **required-for-release**: `nikos release check` counts a done story without a
  sign-off as a gap. Day-to-day work isn't held up; shipping is.

`approval.routes` says which ways of approving count: through the app (`nikos
mcp` asks you directly), in chat (you answered your agent), or in a terminal.
To make approvals need the right reviewer, protect the main branch and add a
`CODEOWNERS` rule for `intent/approvals.yaml`. `nikos doctor` checks for it.

## Joining a company or department plan

```
nikos join acme/company-plan                                  # on GitHub
nikos join acme/engineering/payments-plan --host gitlab.com   # on GitLab
```

`join` adds the repo to `planning/upstream.yaml`, fetches a read-only copy
(`nikos planning sync`), and shows the settings this repo now inherits.
Nothing in the repo moves, so a team that started on its own keeps everything
it has.

Sync follows the chain upwards. A team that joins its department also gets the
department's company plan, so company settings reach every level. Each copy is
read-only, in `.nikos/upstream/` (gitignored), and `planning/upstream.lock`
records the commit each one was read at.

Resolution goes from the top down: the defaults, then each level from the
company down, then this repo. A locked value stays as the level that locked it
set it.

## Checking a repo

`nikos doctor` checks the story map, the scenario runner, CI, approvals, the
tracker and the upstream plans. For each one it says what it found, and the
next thing to do when something's missing. Your agent runs it when something
seems off. `--offline` skips asking upstream repos whether they've moved on.
