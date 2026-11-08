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

- Team repos read other repos read-only. `nikos sync` fetches each group repo into
  `.nikos/assigned/<group repo>/` (gitignored) and rebuilds it every sync, keeping the commit
  in `.nikos/assigned/lock.yaml`. Nothing is written back to the group.
- A team's status and delivery approvals live in its own repo, in `status/<id>.yaml` and
  `approvals/<id>.yaml`. They're keyed by the group's story ids, so two groups' copies can
  share a map key without clashing.

## Trade-offs

_Record trade-offs and why._

## Key files

- `intent/` (one product's story map, in a repo with no levels) and `maps/<key>/` (a group's maps)
  are the two layouts. `src/commands/migrate-maps.ts` (`nikos migrate maps`) is the only move between them.
- `src/lib/maps.ts`: which story map a command works on, including a team's assigned copies
  (`storyMapFor`, `resolveStoryMap`).
- `src/lib/state-files.ts`: where a story's state and approvals live: intent/, maps/<id>, or a
  team repo's `status/` and `approvals/` (`StoryHome`).
- `src/lib/assignments.ts`: `maps/<id>/assignments.yaml`, which team has which stories.
- `src/lib/team.ts`: `nikos.team.yaml` and what makes a repo a team repo.
- `src/team/sync.ts`: `nikos sync`, which builds the copies and marks reassigned stories.
- `src/team/status.ts`: a group's read of its teams: the fetched index in `.nikos/teams/`, each story's
  freshness (`classify`), and the story views that `map status` and the bet delivery both use.
- `src/commands/map-status.ts`: `nikos map status`, its human and `--json` output.
- `src/commands/assign.ts`, `src/commands/team.ts`: the group-side and team-side commands.
