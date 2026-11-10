# Architecture

Your AI coding agent reads this before implementing features.
Keep it up to date — it's how the agent knows how your system is built.

## Stack

Node.js (TypeScript)

## Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-11-03 | Project initialised | Story-map-driven development |

## Patterns

- Each story map lives in the repo that builds it, under `maps/<key>/`. Its `storymap.yaml` names an
  `owner` (a team key such as `WEB`), so story ids are `<OWNER>-<KEY>-<n>` (`WEB-INB-1`). Nothing is
  copied between repos.
- `maps/<key>/delivery.yaml` is the map's delivery summary. It is written from the map's own state and
  approvals by `nikos map status`, `state set`, `approve`, `map new`, `story new` and `migrate maps`, and
  committed. `nikos validate` fails when it is missing or no longer matches the files. The rollout reads it from
  each repo's committed copy; no command reads another repo's stories.

## Trade-offs

_Record trade-offs and why._

## Key files

- `intent/` (one product's story map, in a repo with no levels) and `maps/<key>/` (a group's maps, one per bet)
  are the two layouts. `src/commands/migrate-maps.ts` (`nikos migrate maps`) is the only move between them.
- `src/lib/maps.ts`: which story map a command works on (`resolveStoryMap`), and a map's owner and story id
  prefix (`mapOwnerOf`, `storyPrefix`). A map with no owner takes the group key in `planning/plan.yaml`.
- `src/lib/state-files.ts`: where a story's state and approvals live: `intent/`, or `maps/<key>/`.
- `src/lib/map-data.ts`: a map's files as data (`loadMapData`, `mapStoryIds`).
- `src/lib/map-summary.ts`: a map's delivery summary, worked out from its own files, and the drift check
  that `nikos validate` runs. Pure reads: no git, no network.
- `src/lib/delivery-summary.ts`: `maps/<key>/delivery.yaml`, its schema and writer. Read by every rollout.
- `src/lib/keys.ts`: the one key pattern for groups and maps, and the key clash checks.
- `src/planning/stops.ts`: a stopped bet and the bets aimed at it (rule 10).
- `src/commands/map-status.ts`: `nikos map status`, its human and `--json` output. Local only.
