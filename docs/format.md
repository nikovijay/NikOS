# The intent/ format

Format version: **1**

nikOS keeps a project's intent — what it's for, what to build, how it's going —
in an `intent/` folder at the root of the repo. Everything is plain text, so
agents, humans, git and code review all see the same thing.

```
intent/
  constitution.md        the project's vision
  storymap.yaml          activities, releases and story order
  features/
    <activity>/
      <story-slug>.feature   one story, its criteria as scenarios
  plans/
    <story-id>.v<N>.md   versioned implementation plans
  decisions.md           append-only decision log
  state.yaml             status, blockers and the run queue
  outreach/              optional, drafts from the validate playbook
    <date>-<channel>.md
```

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

**Path:** `intent/constitution.md`

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
outreach, and keeps its drafts in `intent/outreach/`. A draft is marked
`Status: draft, not sent` until the founder signs it off; the founder sends it.
`nikos validate` checks the front matter has `name` and `idea`, and that the
five vision sections come first, in order, and aren't empty.

---

## storymap.yaml

**Purpose:** the shape of the product: activities and their steps (columns),
releases (rows) and the order stories should be built in. It is an index; the stories
themselves live in feature files.

**Path:** `intent/storymap.yaml`

**Format:** YAML.

```yaml
format_version: 1
project: hello-todo
key: HT                     # story id prefix: HT-1, HT-2 …
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

### Bet links (optional)

A release can name the bets it delivers, and a single story can override its
release's list. The bets themselves live outside `intent/`, in `planning/`
(the Planning pack, see [planning.md](planning.md)).

```yaml
releases:
  - number: 1
    title: MVP
    bets: [fewer-missed-tasks]                 # a bet in planning/bets/
    stories: [HT-1, HT-2]
story_bets:
  HT-2: [acme/company-plan#focus-mode]         # this story serves another repo's bet
```

- A bet id must have a `planning/bets/<id>.md` in the same repo.
- `owner/repo#id` names another repo's bet. `nikos validate` checks its form
  only and never fetches it.
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

---

## features/&lt;activity&gt;/&lt;story-slug&gt;.feature

**Purpose:** one user story and its acceptance criteria, written so they
run as tests.

**Path:** `intent/features/<activity-id>/<story-slug>.feature`, where the
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

**Path:** `intent/plans/<story-id>.v<N>.md`, for example
`intent/plans/HT-1.v2.md`. `N` starts at 1 and increases by one.

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
**Files:** src/store.ts

Notes for the agent.
```

Start a new version with `nikos plan new <story-id>`. It writes the next
`v<N>` from a template, sets `supersedes`, and refuses to overwrite an
existing file.

---

## decisions.md

**Purpose:** why things are the way they are. Append-only; never rewrite an
entry, add a new one that supersedes it.

**Path:** `intent/decisions.md`

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

**Path:** `intent/state.yaml`

**Format:** YAML.

```yaml
format_version: 1
stories:
  HT-1:
    status: done            # todo | in_progress | needs_rework | done
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

---

## outreach/&lt;date&gt;-&lt;channel&gt;.md (optional)

**Purpose:** outreach drafted to test the idea with real people, kept so the
founder can review it and the results can be traced back to it.

**Path:** `intent/outreach/<yyyy-mm-dd>-<channel>.md`

**Format:** Markdown. The first line is the status: `Status: draft, not sent`
until the founder signs it off, then `Status: signed off <date>, for the
person to send`. Then who it's for, the message, the questions to ask and,
optionally, a demo or reel script. Written by the validate playbook; the
founder sends it, never the agent.

---

## Versioning this format

`format_version` in `storymap.yaml` and `state.yaml` is the version of this
document. Breaking changes bump it; `nikos validate` reads it and explains
any migration needed.
