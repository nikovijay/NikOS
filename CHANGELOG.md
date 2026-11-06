# Changelog

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
