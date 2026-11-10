# The story map format

Format version: **1**

nikOS keeps a project's intent — what it's for, what to build, how it's going —
in plain files in the repo. Each story map lives in its own folder, `maps/<key>/`,
and the vision and the decision log sit at the root. Everything is plain text, so
agents, humans, git and code review all see the same thing.

```
constitution.md          the project's vision (one per repo)
decisions.md             append-only decision log (one per repo)
maps/
  <key>/                 one story map, named by its key (maps/ht/ for HT-1, HT-2 …)
    storymap.yaml        activities, releases and story order
    features/
      <activity>/
        <story-slug>.feature   one story, its criteria as scenarios
    plans/
      <story-id>.v<N>.md   versioned implementation plans
    state.yaml           status, blockers and the run queue
    approvals/
      <story-id>.yaml    optional: each person's sign-off, one file per story
    delivery.yaml        the map's status, as of its last write
    outreach/            optional, drafts from the validate playbook
      <date>-<channel>.md
```

A repo with one story map has one folder under `maps/`. A repo can hold one map per
bet, and a monorepo can hold several teams' maps. The repo's `planning/` folder, when
it has one, is described in [plan.md](plan.md).

Two rules hold across every file:

1. **Specs describe intent, not implementation.** Feature files and the
   constitution say what and why. File paths, frameworks and code belong in
   plans and decisions.
2. **Changing state never edits a spec.** Status, owners, blockers and dates
   live in `state.yaml`, so a spec's diff only changes when the intent does.

Every file below is listed with its **purpose**, **path** and **format**.

---

## constitution.md

**Purpose:** the project's vision, answered once and refined as you learn.
Every story should trace back to it.

**Path:** `constitution.md` at the repo root. There is one per repo, checked once
by `nikos validate`, whichever maps the repo holds.

**Format:** Markdown with YAML front matter and exactly these five `##`
sections, in this order:

```markdown
---
name: Hello Todo
idea: A todo list that only shows today's three most important tasks.
---

## Users
Who it's for.

## Problem
What hurts today, in their words.

## Switch
What makes them switch now, and from what.

## First
The smallest first version that proves it.

## Proof
How you'll know it's working.
```

Further `##` sections may follow the five required ones. The
idea-to-blueprint playbook writes `## Jobs to be done` and
`## Founding hypothesis`; the validate playbook writes `## Validation`, one entry per round of
outreach, and keeps its drafts in `maps/<key>/outreach/`. A draft is marked
`Status: draft, not sent` until the founder signs it off; the founder sends it.
`nikos validate` checks the front matter has `name` and `idea`, and that the
five vision sections come first, in order, and aren't empty.

---

## storymap.yaml

**Purpose:** the shape of the product: activities and their steps (columns),
releases (rows) and the order stories should be built in. It is an index; the stories
themselves live in feature files.

**Path:** `maps/<key>/storymap.yaml`

**Format:** YAML.

```yaml
format_version: 1
project: hello-todo
key: HT                     # the map's folder is maps/ht/; its stories are HT-1, HT-2 …
owner: WEB                  # optional: a team key, which then prefixes the ids: WEB-HT-1
personas:                   # optional: who the product is for; a story tags them @persona-<id>
  - id: busy
    title: Busy person
    description: Juggles work and home; opens the app for seconds at a time.   # optional
activities:
  - id: tasks               # slug, matches the features/<activity>/ folder
    title: Manage tasks
    steps:                  # optional: the steps a person takes in this activity
      - id: capture         # slug, unique across the map; a story tags it @step-capture
        title: Capture a task
      - id: focus
        title: Focus on today
releases:
  - number: 1
    title: MVP
    goal: Capture tasks and see only today's top three.   # optional, one line
    stories: [HT-1, HT-2]   # build order within the release
  - number: 2
    title: Enhancements
    stories: [HT-3]
```

Rules:

- Every story id appears in exactly one release.
- Every story id has exactly one feature file and one `state.yaml` entry.
- Release numbers start at 1 and have no gaps.
- Step ids are unique across the map. A story's `@step-<id>` must name a step
  of its own activity. A story with no step sits under the activity's first
  step on the map.
- A story's `@release-N` tag should match the release that lists it;
  `nikos validate` warns when they differ.
- Persona ids are unique, and a story's `@persona-<id>` must name one.
- A story id is the map's `key` and a number, with a prefix first. The prefix is
  the map's `owner` if it has one, else nothing: `WEB-HT-1` or `HT-1`. Every
  story in one map uses the same prefix, and a map with no owner keeps the bare
  `HT-1`. Adding an owner later doesn't rename existing ids: they keep their
  prefix, and `nikos validate` accepts it.
- A story's `@depends-<id>` must name another story, and dependencies can't
  form a loop. `nikos validate` warns when a story depends on one in a later
  release, or on a cancelled one. `nikos next` won't pick a story until
  everything it depends on is done.

### Bet links (optional)

A release can name the bets it delivers, and a single story can override its
release's list. The bets themselves live in the company's planning repo, under
`planning/<area>/bets/` (see [plan.md](plan.md)).

```yaml
releases:
  - number: 1
    title: MVP
    bets: [fewer-missed-tasks]                 # a bet id from the company's plan
    stories: [HT-1, HT-2]
story_bets:
  HT-2: [focus-mode]                           # this story serves this bet
```

- A bet is named by its bare id, the same in every repo. `nikos validate` checks
  its form only: `repo#bet` is refused, and nothing is fetched.
- A story's `story_bets` entry replaces its release's `bets` for that story.

Add a story with `nikos story add "<title>" --activity <id> [--step <id>]`.
It takes the next free id, adds it to the last release (or `--release <n>`),
gives it a `todo` entry in `state.yaml` and writes a starter feature file to
fill in.

The map's shape has commands too, so nobody has to hand-edit the YAML. Each
keeps comments and leaves the rest of the file as it was:

| Command | What it does |
| --- | --- |
| `nikos step add "<title>" --activity <id>` | Add a step under an activity (`--id` to choose its id) |
| `nikos release add "<title>" [--goal "<goal>"]` | Add the next numbered release, with no stories yet (titles must be unique) |
| `nikos release rename <n> ["<title>"] [--goal "<goal>"]` | Change a release's title or goal (`--goal ""` removes it) |
| `nikos release move <story-id> <n>` | Move a story to the end of another release and retag its feature |
| `nikos release reorder <n> <position>` | Move a release, renumber them all from 1 and retag every moved story |
| `nikos release remove <n>` | Remove a release with no stories or bets, renumber the rest and retag their stories |
| `nikos release check <n> [--run]` | Say whether a release is ready to ship and list what's in the way (`--run` reruns each done story's scenarios); exits 1 when it isn't |

`nikos export --format prd|linear|jira` writes the map in another tool's shape:
a PRD in Markdown, Linear issues (releases become milestones), or the body of
Jira's bulk create (`POST /rest/api/2/issue/bulk`). `--release <n>` exports one
release; `--project-key` sets Jira's project (default: the map's key). The
exports are copies: keep editing the map's folder.

---

## features/&lt;activity&gt;/&lt;story-slug&gt;.feature

**Purpose:** one user story and its acceptance criteria, written so they
run as tests.

**Path:** `maps/<key>/features/<activity-id>/<story-slug>.feature`, where the
activity id matches `storymap.yaml` and the slug is the story title in
kebab-case.

**Format:** Gherkin. One `Feature` per file. The description holds the user
story; each acceptance criterion is a `Scenario` (or `Scenario Outline`)
titled with its label. Full rules are in [gherkin.md](gherkin.md).

```gherkin
@HT-1 @release-1 @must @activity-tasks @step-capture
Feature: Add a task

  As a busy person
  I want to add a task in one step
  So that capturing it is faster than forgetting it

  @AC1 @must
  Scenario: AC1 — Adding a task shows it at the top
    Given my list is empty
    When I add the task "Call the bank"
    Then I see "Call the bank" at the top of my list
```

---

## plans/&lt;story-id&gt;.v&lt;N&gt;.md

**Purpose:** how a story will be built. Plans are versioned: a new approach
is a new file, so history is never lost.

**Path:** `maps/<key>/plans/<story-id>.v<N>.md`, for example
`maps/ht/plans/HT-1.v2.md`. `N` starts at 1 and increases by one.

**Format:** Markdown with front matter, then one `##` section per step:

```markdown
---
story: HT-1
version: 2
created: 2026-11-03
supersedes: 1          # omit for v1
summary: One to three plain sentences on the approach.
---

## 1. Store tasks locally
**Why:** tasks survive a refresh.
**Criteria:** AC1
**Files:** src/lib/store.ts

Notes for the agent.
```

Start a new version with `nikos plan new <story-id>`. It writes the next
`v<N>` from a template, sets `supersedes`, and refuses to overwrite an
existing file.

---

## decisions.md

**Purpose:** why things are the way they are. Append-only; never rewrite an
entry, add a new one that supersedes it.

**Path:** `decisions.md` at the repo root. In a planning repo, each area keeps its own at
`planning/<area>/decisions.md`: the company's is `planning/company/decisions.md`, and
`nikos decide --in <area>` picks another (see [plan.md](plan.md))

**Format:** Markdown. One `##` entry per decision, newest last:

```markdown
## 2026-11-03 — Store tasks in localStorage (HT-1)
**Category:** architecture
**Supersedes:** none

Why this, and what we rejected.
```

The heading is `date — title (story id)`; the story id is optional for
project-wide decisions. Category is one of `product`, `architecture`,
`design`, `interface`, `process`. Use `interface` for a choice other stories
must keep to: a command's syntax, an output format, an API's shape. The
build-a-story playbook reads these before planning.

---

## state.yaml

**Purpose:** everything that changes as work happens: status, who's on it,
blockers, and the run queue. Kept apart so specs stay clean.

**Path:** `maps/<key>/state.yaml`, one file per map. Every story in the map has
its entry here, so two maps never share a state file.

**Format:** YAML.

```yaml
format_version: 1
stories:
  HT-1:
    status: done            # todo | in_progress | needs_rework | done | cancelled
    spec_hash: 3f9a1c2b7d4e # set at done: a fingerprint of the feature from Feature: on
    done_at: 2026-11-03T14:02:11Z  # set at done
    claimed_by: claude-code # optional
    plan_version: 2         # optional, the plan in use
    blockers: []            # optional, plain sentences
    updated: 2026-11-03
  HT-2:
    status: todo
run:                        # optional, an ordered build queue
  queue: [HT-2]
```

Status moves `todo → in_progress → done`, or `in_progress → needs_rework →
in_progress`. Only a passing verification can set `done` (see the
build-a-story playbook).

- **Approval** isn't a status. It's a person's sign-off, kept in
  its own file in [approvals/](#approvalsstory-idyaml) so a repo can protect it.
- **Cancelled** keeps a story you've decided not to build, with a reason:
  `nikos state set <id> cancelled --reason "<why>"` from todo, in_progress or
  needs_rework. It's saved as `cancelled_reason`. `cancelled → todo` brings it back.
  Cancelled stories don't count towards a release or a bet, and `nikos next` skips them.
- **Spec changed:** `spec_hash` records what the scenarios proved. If the feature
  changes after done or approved, `nikos validate` warns, the map shows the
  story as "spec changed", and `nikos release check` counts it as a gap. Tags
  above `Feature:` aren't part of the fingerprint, so moving a story between
  releases doesn't count as a change.

Two people or agents moving different stories in one repo both touch `state.yaml`,
so keep each branch's stories apart: the approvals are files of their own, and a
merge conflict in `state.yaml` is a small, plain one. Commit a change to a map's
story set on its own, from a branch nobody else is moving stories on.

## approvals/<story-id>.yaml

**Purpose:** a person's sign-off on a done story. Each sign-off is its own file,
apart from `state.yaml`, which agents write all the time, so a `CODEOWNERS` rule can
protect the sign-offs.

**Path:** `maps/<key>/approvals/<story-id>.yaml`, one file per approved story. The
first approval creates the folder.

**Format:** YAML, the same fields for every story:

```yaml
by: Niko Vijay              # git's user.name
on: 2026-11-06
via: chat                   # app, chat, terminal or tracker: how it was given
spec_hash: 3f9a1c2b7d4e     # the feature that was approved
done_at: 2026-11-03T14:02:11Z   # the done that was approved
```

`nikos approve <id>` writes one, in one of three ways:

- **Through the app.** With `nikos mcp`, the approve tool asks the person
  directly through their app's own prompt. The model never sees the question
  or gives the answer. Recorded as `via: app`.

- **In chat.** When a story reaches done, the agent asks "Do you want to
  approve HT-1: Add a task?". Only if the person answers Approve does it run
  `nikos approve HT-1 --via chat`. The playbooks never let an agent approve on
  its own judgement, and `via: chat` records how the approval was given.
- **In a terminal.** The person runs `nikos approve HT-1` and types the id
  back. It refuses to run without an interactive terminal, which is how coding
  agents run commands.

Either way, it approves only a done story whose feature hasn't changed since,
and reruns its scenarios first.

An approval holds while the story stays done, since that same done, with the
same feature. Move it to needs_rework, take it through done again, or change its
feature, and the approval lapses: `nikos validate` warns, and the map shows the
story as done rather than approved. A person then approves it again.

On the map, in exports and in `nikos release check`, a story with an approval
that holds shows as **approved**, and counts as done.

**Make approvals need a review.** Protect the default branch and add a
`CODEOWNERS` rule for the file, so a change to it only merges when that person
approves the pull request (GitHub) or merge request (GitLab):

```
/maps/*/approvals/      @your-product-lead
```

On GitLab, requiring code-owner approval needs a paid tier.

---

## outreach/&lt;date&gt;-&lt;channel&gt;.md (optional)

**Purpose:** outreach drafted to test the idea with real people, kept so the
founder can review it and the results can be traced back to it.

**Path:** `maps/<key>/outreach/<yyyy-mm-dd>-<channel>.md`, one folder per map

**Format:** Markdown. The first line is the status: `Status: draft, not sent`
until the founder signs it off, then `Status: signed off <date>, for the
person to send`. Then who it's for, the message, the questions to ask and,
optionally, a demo or reel script. Written by the validate playbook; the
founder sends it, never the agent.

---

## delivery.yaml

**Purpose:** what each story's status and approval are, as of the last write, so the plans above a repo can read delivery without the story files.

**Path:** `maps/<key>/delivery.yaml`, one per map.

**Format:** YAML with `version`, `map`, an optional `owner` (the map's owner, when it has one), `read_at`, and `stories` (id, status, approval, and proof). `nikos map status`, `state set`, `approve` and `map new` write it, and `nikos validate` checks it is current. Commit it with the map. A planning repo reads it with unknown fields allowed, so a newer nikOS can add to it; a `version` newer than 1 is refused, and the message says which repo to upgrade.

---

## planning/repos.yaml

**Purpose:** the code repos a planning repo reads delivery from. `nikos plan refresh` reads each one, read-only.

**Path:** `planning/repos.yaml` in the planning repo, optional.

**Format:** YAML with `version: 1` and `repos`, a list of entries with `repo` (owner/repo, or group/project on GitLab), and optional `host`, `ref` (the default is the repo's default branch) and `url`. A planning repo reads it with unknown fields allowed, so a newer nikOS can add to it; a `version` newer than 1 is refused, and the message says which repo to upgrade. `nikos join` writes it, and `nikos plan validate` checks it. Its copies are kept under `.nikos/delivery/`, which is never committed. See [docs/plan.md](plan.md).

## Upgrading from intent/

A repo from before 0.5 keeps its story map in `intent/`, and nikOS refuses it
until it moves. Move it by hand, as the CHANGELOG's 0.5 notes say: `git mv intent
maps/<key>`, with `constitution.md` and `decisions.md` at the repo root. Then run
`nikos validate` and `nikos map status`, and commit the result.

## Versioning this format

`format_version` in `storymap.yaml` and `state.yaml`, and `version` in
`delivery.yaml` and `planning/repos.yaml`, is the version of this document.
Breaking changes bump it.
A reader refuses a file whose version is newer than this nikOS reads, and
says which repo to upgrade. Readers in a planning repo accept unknown fields
in `storymap.yaml`, `delivery.yaml` and `planning/repos.yaml`; the writers in
a story map repo stay strict, and `nikos validate` reads it and explains any
migration needed.
