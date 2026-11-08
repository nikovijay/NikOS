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
  `approvals/<id>.yaml`. They're keyed by the story ids, so two groups' copies can
  share a map key without clashing.
- A team can own story maps (`maps/<key>/` in its own repo, ids like `WEB-INB-1`). They're read and
  written in place, and their status and approvals sit at the team's root, not in the map. A group's
  or another team's share of one is recorded in `maps/<key>/assignments.yaml` beside it. Nothing
  fetches a team's status except `nikos map status`, and a rollout reads only the `delivery.yaml` each
  map owner commits (`src/lib/delivery-summary.ts`).

## Trade-offs

_Record trade-offs and why._

## Key files

- `intent/` (one product's story map, in a repo with no levels) and `maps/<key>/` (a group's maps, or a
  team's own map) are the two layouts. `src/commands/migrate-maps.ts` (`nikos migrate maps`) is the only move between them.
- `src/lib/maps.ts`: which story map a command works on, including a team's assigned copies
  (`storyMapFor`, `resolveStoryMap`).
- `src/lib/state-files.ts`: where a story's state and approvals live: intent/, maps/<id>, or a
  team repo's `status/` and `approvals/` (`StoryHome`).
- `src/lib/assignments.ts`: `maps/<id>/assignments.yaml`, which team has which stories.
- `src/lib/team.ts`: `nikos.team.yaml` (key, home, format 2) and what makes a repo a team repo; `teamOptedIn`
  is the one test for a team that has taken up the amendment (a key, a home or a map).
- `src/lib/keys.ts`: the one key pattern for groups, teams and maps, and the key clash checks (D5).
- `src/lib/delivery-summary.ts`: `maps/<key>/delivery.yaml`, written by `nikos map status`, read by every rollout.
- `src/planning/stops.ts`: a stopped bet and the bets aimed at it (rule 10).
- `src/team/sync.ts`: `nikos sync`, which builds the copies and marks reassigned stories. `readSource` takes a
  group or a team as a source, read-only.
- `src/team/status.ts`: a group's read of its teams: the fetched index in `.nikos/teams/`, each story's
  freshness (`classify`), and the story views that `map status` and the bet delivery both use.
- `src/commands/map-status.ts`: `nikos map status`, its human and `--json` output.
- `src/commands/assign.ts`, `src/commands/team.ts`: the group-side and team-side commands.
