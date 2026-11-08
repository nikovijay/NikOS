# Changelog

## Unreleased

### Added

- Story maps in group repos: a group keeps one story map per bet under `maps/<id>/`, made with `nikos map new --bet <bet-id> --key <KEY>`. Story ids carry the group and map keys, `GROUP-MAP-n` (e.g. `PAY-CHK-12`), and `nikos group init --key` sets the group key. Repos with `intent/` work as before.
- Plan levels follow the model in `docs/rfcs/plans-bets-story-maps.md`: OKRs stop
  at department level. Company and department plans set objectives and key
  results. A group plan only makes bets, aimed at the department's (or
  company's) key results. `nikos planning validate` refuses key results and
  objectives in a group plan, and `nikos planning kr new` won't write one there.
- Bets can align to bets: a department bet to company bets, a group bet to
  department bets (`aligns_to` on the bet card, `nikos planning bet new
  --aligns-to`). The rollout draws them under the bets they align to.
- `aligns_to` can name several key results or bets (repeat `--aligns-to`). A
  single reference still works as before.
- A key result or bet only aligns to the plan directly above it, of the level
  above: `kr new` and `bet new` refuse anything else, and `validate` checks it
  against the synced copy. A company plan aligns to nothing.
- `nikos group init` writes a group plan. `nikos company init --level
  department` writes a department plan.

### Changed

- `nikos map` with `new` makes a map in a group repo. In a repo with `intent/` it no longer writes a page for `nikos map new`: bare `nikos map` still writes `storymap.html`.
 loads with a warning: teams are assigned story maps by
  their group instead. Its key results and objectives are warnings, not errors,
  until a later release migrates them.
- `nikos planning rollout --json`, the dashboard's data and custom views give
  `aligns_to` as a list on key results and bets. A key result also carries
  `aligned`, every key result it aligns to. `upstream` is still the first.
- The dashboard's guide shows company, department and group, with the story map
  under a bet.

## 0.2.4 (2026-11-07)

### Added

- A first-run wizard. `nikos start` in a terminal, without `--name`, asks
  what you're setting up (a team's product, a company or department plan, or
  both in one repo), where, the name, and the story key separately, then sets
  it up. It won't set up in your home folder, checks before using a folder
  that already has files in it, and offers `git init`. Agents pass flags and
  never see it.
- The `onboard` playbook asks the same questions in chat. The nikOS skill now
  starts it when someone has just installed nikOS or wants to organise their
  company, department, team or product, in any folder, not only in a repo
  that already has `intent/`.
- `nikos serve` opens the dashboard: the plan, its rollout, and the story map.
  `nikos start` and `nikos company init` end with how to open it.
- `nikos verify setup`, `nikos start` and a failing `nikos verify` say when
  this Node can't run Cucumber 12 (it needs Node 20, 22, or 24 and later), and
  how to switch, before anything is installed.

### Changed

- The skills, session hooks, README and docs run `npx -y nikos@latest`. A plain
  `npx -y nikos` could reuse an old cached copy.
- `nikos doctor`, the session hook and the wizard warn when the `nikos` on
  your PATH is older than the one running, and say how to update it. The
  skills compare `nikos --version` with `npx -y nikos@latest --version` before
  their first command, and never follow an old version's help.
- The planning skill sets a company plan up with `nikos company init`, and
  never puts company goals in `intent/constitution.md`.

## 0.2.3 (2026-11-07)

### Added

- A company or department plan with no story map works on its own. `nikos
  decide` writes to `planning/decisions.md` (created on the first decision),
  and `nikos decisions` searches it. `nikos doctor` checks the plan, its
  decisions, the approval settings it hands down and the plans below, and
  passes without an `intent/` folder.
- `nikos planning rollout` and the dashboard's Rollout tab show, for each plan
  below, the story it builds next, its blocked stories with what's blocking
  them, and its latest three decisions. They list this plan's own latest
  decisions too. `--json` has them as `next`, `blockers` and `decisions`.
- The dashboard's Rollout tab shows the commit each plan synced, not just the
  date.

### Changed

- `nikos company init` suggests locking `approval.routes` with
  `approval.policy`, and `nikos doctor` warns in a plan-only repo when the
  policy is locked and the routes aren't, since a team below could still
  choose its own routes.

## 0.2.2 (2026-11-07)

### Added

- `nikos planning rollout` and the dashboard's Rollout tab draw the alignment
  as a tree: company key result, the department and team key results aligned
  to it, then the bets on each, following nested `downstream.yaml` plans. It
  shows links only and never works out progress from the key results below.
  `--json` has it as `tree`.
- `nikos planning downstream add --url <git url>`, for a department or team on
  another git host, over SSH or in a local repo. The MCP `add_downstream` tool
  takes it too.

### Fixed

- `nikos planning rollout` says when a plan further down is behind the plan it
  sits below: "behind acme/payments-plan: ask them to run nikos planning sync",
  in the text, in `--json` (`synced.current: false`) and on the dashboard's
  Rollout tab. It used to say nothing.
- `nikos doctor` and `nikos migrate` say "1 story" and "1 approval", not
  "1 stories" and "1 approvals".
- `nikos release check` says when a story's approval no longer holds: "TC-1's
  feature changed after it was done, so Niko's approval no longer holds", and,
  when approvals are required, "TC-1 isn't approved: it went through done again
  since Niko approved it".
- `nikos join` no longer says "Joined" when it can't fetch the plan. It says it
  couldn't, that the entry stays listed for a later `nikos planning sync`, and
  how to drop it.
- Moving a story to done names steps that are still pending, or have no step
  definition yet, as well as the failing scenarios.
- A key result with no check-ins reads "no check-ins yet" in the rollout and on
  the dashboard, instead of "stale".
- The dashboard's Rollout tab no longer says "no repo yet" twice for a plan
  without a repo.

## 0.2.1 (2026-11-06)

### Added

- **A release check in CI.** `nikos ci setup` also writes a check you run by
  hand when a release is meant to ship: a "nikos release check" workflow on
  GitHub (run it from the Actions tab with the release number), or a
  `nikos-release` job on GitLab (run a pipeline with `NIKOS_RELEASE` set). It
  fails while a story isn't done, a spec changed after done, or, with
  `approval.policy: required-for-release`, a story isn't approved. On GitLab,
  a job file written by 0.2.0 isn't rewritten: `ci setup` prints the job to add.
- **Session-start hooks for Codex and Cursor**, like Claude Code's: at the
  start of a session in a repo with a story map, the agent hears where things
  stand and what to suggest next. Codex runs the hook once you trust it. In
  Cursor it can land after your first message on a slow first run. See
  [docs/install.md](docs/install.md).

## 0.2.0 (2026-11-06)

nikOS becomes conversational, works beyond Claude Code, and scales from one
team to a whole company, on GitHub or GitLab.

### Added

**Talk to it**

- **`nikos suggest`**: where things stand, and two to four things to do next,
  worked out from the repo. Agents end every request with it as a short menu,
  and ask "Do you want to approve HT-1: Add a task?" when a story is done. A
  SessionStart hook shows it when a Claude Code session opens. The menu also
  offers a bet review when one is due and a check-in when a key result is
  stale.
- **`nikos mcp`**: nikOS as a local MCP server, so Claude Desktop and any app
  that runs local MCP servers can read and change the story map through tools.
  Approvals go through the app's own prompt (`via: app`), so the model never
  answers for the person.
- **The nikOS core as a library** (`import { … } from "nikos"`) with swappable
  storage: load a repo's files into a `MemoryStore`, run nikOS on them, and
  commit what changed. See [docs/library.md](docs/library.md).

**Get started**

- **`nikos start`** sets a repo up in one go: `intent/`, a scenario runner for
  its stack and CI for its host. The start playbook takes the first session
  through to one story proved done; the map-existing playbook drafts the story
  map from an existing codebase.
- **`nikos company init`** writes a company plan repo that departments and
  teams join. **`nikos join <repo>`** links a team to it in one step.
- **`nikos doctor`** checks the repo is set up well and says what to do next.
- **`nikos activity add`**.

**Companies, settings and trackers**

- **Settings** in `nikos.settings.yaml`, inherited from the company plan down
  through every department, group and team, with `locked` keys. **`nikos
  settings`** shows each value and where it comes from. See
  [docs/settings.md](docs/settings.md).
- **The approval policy** (`approval.policy`): `off`, `optional` or
  `required-for-release`, and which routes count (`approval.routes`).
- **`nikos tracker`** keeps the story map and Jira, Linear, GitHub or GitLab
  issues in step, through the tracker's own MCP: link stories to tickets, map
  the tracker's statuses, import a backlog, and list which tickets should move.
  A ticket can approve (when `tracker.approvals` is on) or cancel a story, never
  mark it done.
- **`nikos planning rollout`**: which departments and teams below a plan have
  joined, whether they're behind, their delivery, and the key results and bets
  that point up. `nikos planning downstream add` lists them, and the planning
  dashboard has a Rollout tab.

**GitLab**

- Upstream plans and cross-repo references accept GitLab's nested groups
  (`group/subgroup/project`) and a `host:` for gitlab.com or a self-managed host.
- **`nikos ci setup`** writes a GitHub Actions workflow or a GitLab CI job that
  runs `nikos validate` and every story's scenarios on each pull or merge
  request.

**Story map**

- **Approvals**, a person's sign-off after done: `nikos approve <id>` writes it
  to `intent/approvals.yaml`. A person approves in their terminal (typing the id
  back), by answering their agent's "Do you want to approve …?" (`--via chat`),
  or through their app's own prompt with `nikos mcp`. An agent never approves on
  its own. It reruns the scenarios and records who approved, when and how. Protect the file with
  `CODEOWNERS` to make approvals need a review on GitHub or GitLab. The map,
  exports and release check show approved stories, and count them as done.
- **Cancelled**, with a reason: `nikos state set <id> cancelled --reason "…"`.
  The story stays on the map, struck through. `nikos next` skips it, and it no
  longer counts towards its release or bets. `state set <id> todo` brings it back.
- **Spec changed after done.** Done records a fingerprint of the feature. If the
  feature changes afterwards, `nikos validate` warns and the map marks the story
  "spec changed". An approval lapses when the feature changes, or when the story
  goes back through done.
- **Dependencies:** `@depends-<id>` tags. `nikos next` waits until a story's
  dependencies are done, the map shows "Waits on …", and `nikos validate`
  catches unknown ids, loops and a dependency in a later release.
- **`nikos release check <n>`** says whether a release is ready to ship, and
  lists what's in the way. `--run` reruns each done story's scenarios. It exits
  1 when the release isn't ready, so CI can use it.
- **`nikos export --format prd|linear|jira`** writes the story map as a PRD in
  Markdown, Linear issues or a Jira bulk-create body.
- **Personas** (`personas:` in `storymap.yaml`, `@persona-<id>` on features) and
  **story types** (`@type-technical`, `@type-bug-risk`).
- **The dashboard's story map has filters:** search, release, type, persona and
  status, plus a switch that shows every release's stories in one row. The page
  `nikos map` writes stays free of scripts.
- **One file per story**, for repos where many people or agents work at once:
  `nikos migrate per-story` moves each story's state to `intent/state/<ID>.yaml`
  and each approval to `intent/approvals/<ID>.yaml`, so parallel branches never
  conflict. `nikos migrate single-file` moves them back.

### Changed

- The map's release tally reads "2 of 3 done", and adds approved and
  spec-changed counts. A release is stamped Shipped only when every story that
  isn't cancelled is done or approved and unchanged since.
- `nikos planning sync` follows the chain of plans upwards, so a team that
  names its department also gets the company plan.

## 0.1.1 (2026-11-06)

### Added

- `nikos release remove <n>` removes an empty release (no stories, no bets),
  then renumbers the releases after it and retags their stories.
- `nikos --version` (also `-v`, `version`) prints the installed version.

### Fixed

- `nikos release add` and `release rename` refuse a title another release
  already has (ignoring case), so running `add` twice no longer makes two
  releases with the same name.
- `nikos init --name` or `--key` with no value is now an error. Before, it
  fell back to the folder name and picked a key you didn't expect.

## 0.1.0 (2026-11-06)

### Breaking

- **Bets have moved out of core nikOS into the Planning pack.** `nikos bet`,
  `intent/bets/`, `schemas/bet.schema.json`, the bet checks in
  `nikos validate`, the bet playbook and the two bet principles are gone.
  Install the Planning pack (`/plugin install nikos-planning@nikos`) and
  use `nikos planning bet new`: bets now live in `planning/bets/`, and the
  story map names the bets each release delivers (`bets:` on a release,
  `story_bets:` for one story) instead of each bet listing its stories. See
  [docs/planning.md](docs/planning.md) and [tools/planning](tools/planning).

### Added

- Steps under activities: `steps:` in `storymap.yaml`, a `@step-<id>` tag
  on features, `nikos step add`, and `nikos story add --step`. The story map
  shows a step row and puts each story under its step.
- Release commands: `nikos release add` (with an optional `goal:`),
  `rename`, `move` (a story to another release) and `reorder`, all keeping
  feature `@release-N` tags in step. `nikos validate` now warns when a tag
  and the map disagree.
- The story map is restyled: a sticky activity and step spine, numbered
  release dividers with a tally, goal and Shipped stamp, status-tinted
  cards, and a panel per story with its acceptance criteria. The planning
  dashboard has a How it works page.
- The Planning pack (`tools/planning/`, `nikos-planning`): key results with
  check-ins, bet cards with review decisions, delivery status worked out
  from the story map, upstream plans from other repos, a local dashboard
  with safe edits, custom views and read-only snapshots.
- `bets:` on releases and `story_bets:` in `storymap.yaml`, checked by
  `nikos validate`; `nikos show` lists a story's bets and where they came from.
- `nikos map`: a read-only story map page.
