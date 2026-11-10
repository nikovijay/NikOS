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
  approvals by `nikos map status`, `state set`, `approve`, `map new` and `story new`, and committed.
  `nikos validate` fails when it is missing or no longer matches the files. The company's plan reads it from
  each repo's committed copy (`nikos plan refresh`); no command reads another repo's stories.

## Trade-offs

_Record trade-offs and why._

## Key files

- `maps/<key>/` is the one layout for a story map, whether a repo has one map or one per bet.
  `constitution.md` and `decisions.md` sit at the root. A 0.4 `intent/` is moved by hand (the CHANGELOG says how);
  nikOS refuses it until then.
- `src/lib/maps.ts`: which story map a command works on (`resolveStoryMap`: by `--map`, or by the story id
  when a command takes one), and a map's owner and story id prefix (`mapOwnerOf`, `storyPrefix`). A map with
  no owner keeps bare ids.
- `src/lib/state-files.ts`: where a story's state and approval live, in its map's folder: `state.yaml`, and
  `approvals/<id>.yaml`.
- `src/lib/map-data.ts`: a map's files as data (`loadMapData`, `mapStoryIds`).
- `src/lib/map-summary.ts`: a map's delivery summary, worked out from its own files, and the drift check
  that `nikos validate` runs. Pure reads: no git, no network.
- `src/lib/delivery-summary.ts`: `maps/<key>/delivery.yaml`, its schema and writer. Read by `nikos plan refresh`.
- `src/lib/keys.ts`: the one key pattern for maps and areas.
- `src/commands/map-status.ts`: `nikos map status`, its human and `--json` output. Local only.
