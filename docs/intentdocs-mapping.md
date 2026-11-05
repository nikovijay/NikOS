# Mapping intent/ to intentdocs

`intentdocs push` and `intentdocs pull` translate between the local
`intent/` folder and an intentdocs project. This table is the contract: every
local field maps to an intentdocs field, or is marked **local-only**.
Fields that exist only in intentdocs are listed at the end.

## Project and vision

| Local | intentdocs | Notes |
|---|---|---|
| `constitution.md` front matter `name` | project name | |
| `constitution.md` front matter `idea` | project idea | |
| `## Users` | vision `users` | |
| `## Problem` | vision `problem` | |
| `## Switch` | vision `switch` | |
| `## First` | vision `first` | |
| `## Proof` | vision `proof` | |
| extra `##` sections (e.g. `## Validation`) | **local-only** | pushed as a project note in a later format version |
| `storymap.yaml` `key` | project story key prefix | e.g. `HT` → `HT-1` |
| `storymap.yaml` `project` | **local-only** | slug used for paths |
| `storymap.yaml` `format_version` | **local-only** | |

## Activities and releases

| Local | intentdocs | Notes |
|---|---|---|
| `activities[].title` | story `activity` | intentdocs groups by activity name |
| `activities[].id` | **local-only** | folder slug under `features/` |
| `releases[].number` | release order | |
| `releases[].title` | release label | |
| `releases[].stories` order | build sequence within the release | |

## Stories (feature files)

| Local | intentdocs | Notes |
|---|---|---|
| story id tag, e.g. `@HT-1` | story `key` | |
| `Feature:` title | story `title` | |
| description `As a …` | `as_a` | |
| description `I want …` | `i_want` | |
| description `So that …` | `so_that` | |
| `@must` / `@should` / `@could` on the Feature | story `priority` | |
| `@release-N` | story `release` | must agree with `storymap.yaml` |
| `@activity-<id>` | story `activity` | resolved to the activity title |
| `@effort-XS` … `@effort-XL` (optional) | story `effort` | |
| file path | **local-only** | |

## Acceptance criteria (scenarios)

| Local | intentdocs | Notes |
|---|---|---|
| `@AC<n>` tag and scenario title prefix | criterion `label` | |
| scenario title after the label + its steps | criterion `text` | pushed as one Given/When/Then sentence |
| `@must` / `@should` / `@could` on the Scenario | criterion `priority` | |
| scenario pass/fail from `nikos verify` | criterion `last_result` | sent via report_criteria |
| step definition file and test name | linked tests | sent via save_tests |

## Plans

| Local | intentdocs | Notes |
|---|---|---|
| file `plans/<id>.v<N>.md` | plan `version` N | |
| front matter `summary` | plan `summary` | |
| `## <n>. <title>` | step `title` | |
| `**Why:**` | step `why` | |
| `**Criteria:**` | step `criteria` | labels resolved to criterion ids |
| `**Files:**` | step `files` | |
| `**Tests:**` (optional) | step `tests` | |
| `**Needs you:**` (optional) | step `needs_you.question` | |
| body text | step `agent_notes` | |
| front matter `risk` (optional) | plan `risk` | |
| front matter `introduces` (optional) | plan `introduces` | new dependencies |
| front matter `supersedes`, `created` | **local-only** | intentdocs keeps its own history |

## Decisions

| Local | intentdocs | Notes |
|---|---|---|
| entry heading title | decision `title` | |
| entry body | decision `description` | |
| `**Category:**` | decision `category` | |
| entry date | decision created date | |
| story id in heading | decision linked story | |
| `**Supersedes:**` | **local-only** | intentdocs amends instead |

## State

Status isn't pushed: intentdocs sets it. New stories start as To do,
existing ones keep theirs, and they move through build and acceptance in
intentdocs. `intentdocs push` still sends the local status, and says how
many it ignored.

| Local | intentdocs | Notes |
|---|---|---|
| `status: todo` | **not pushed** | intentdocs sets status |
| `status: in_progress` | **not pushed** | intentdocs sets status |
| `status: needs_rework` | **not pushed** | intentdocs sets status |
| `status: done` | **not pushed** | intentdocs sets status; its own done needs acceptance after build |
| `blockers` | raised blockers | |
| `plan_version` | current plan version | |
| `claimed_by` | story claim | |
| `run.queue` | build run story order | |
| `updated` | **local-only** | |

## Bets

| Local | intentdocs | Notes |
|---|---|---|
| `outreach/*.md`, `## Validation` | **local-only** | intentdocs keeps the vision answers, not outreach drafts or results |
| `releases[].bets`, `story_bets` | **local-only** | links to bets in `planning/`, which intentdocs doesn't have yet |

## intentdocs-only (not pulled into files)

Comments, design references, plan approvals, story approval after build,
founder to-dos, releases readiness checks, collaborators and workspace
settings stay in intentdocs. `intentdocs pull` never writes them to the repo.
