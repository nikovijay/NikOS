# Changelog

## Unreleased

### Added

- **nikOS Plan: the company's plan in one repo.** `nikos plan init` makes a planning repo with a folder for each level: `planning/company/`, `planning/departments/<id>/`, `planning/groups/<id>/` and `planning/teams/<KEY>/`. Add them with `nikos plan add department|group|team`. Key results, bets, check-ins, target changes and reviews work as `nikos planning` does, in the area named with `--in` or the area folder you're in. The company plans by year and departments by quarter: a department's key result needs `--period 2027-Q1` inside the company's year, and is due at the quarter's end. Ids are unique within the company, so links inside the repo are just ids. A link goes up a level, never down. Settings come down the folders: each area's `settings.yaml` changes what nobody above it locked. `nikos plan status` and `nikos plan validate` cover the whole company. See `docs/plan.md`. This is the first of the changes in `docs/rfcs/plan-and-spec.md`. The dashboard, and delivery from code repos, come in later releases.

### Changed

- **Every story map lives in `maps/<key>/`, and `intent/` is gone.** A repo's one story map and a group's maps use the same layout: `maps/<key>/` holds its `storymap.yaml`, `features/`, `plans/`, `state.yaml`, `approvals/` (one file per approval), `outreach/` and `delivery.yaml`. `constitution.md` and `decisions.md` sit at the repo root, and the constitution is checked once. `nikos init`, `start` and `map new` write there, and `validate`, `doctor` and the other commands refuse a repo that still keeps `intent/`, pointing to `nikos migrate maps`. Commands find a story's map from its id, so `state set`, `approve`, `show`, `plan new`, `release move` and the rest need no `--map` when the id is in one map only; `nikos next` with several maps and no `--map` refuses. An id in two maps, or a `--map` that doesn't hold the id, is refused. Story ids take the map's owner, then the group key, then nothing: `WEB-CHK-3`, `PAY-CHK-3` or, in a solo map, `HT-1`. Every story in one map uses the same prefix. The approval and code gates apply to every map in a git repo, and a change to `decisions.md` or `constitution.md` never lapses an approval.
- **`nikos migrate maps` is a plain move with a format conversion.** It moves an `intent/` story map into `maps/<key>/`, folds `state/<id>.yaml` into `state.yaml`, splits `approvals.yaml` into one file per approval, moves `constitution.md` and `decisions.md` to the root, and checks the converted copy before it writes anything. It makes no group and writes no plan. Story ids are renamed only when `planning/plan.yaml` has a key the ids lack. `nikos validate` fails a repo with `intent/` and points to the migration.
- **This release changes the layout.** Each story map lives in the repo that builds it, under `maps/<key>/`, and its `storymap.yaml` can name an `owner` (a team key such as `WEB`). Its story ids are then `WEB-CHK-3`: `nikos map new --owner <KEY>` sets it, and a map with no owner takes the group key as before. A map's `bet:` is optional. A map's state and approvals are kept in its own folder.
- `nikos map status` is local: it reads the map's own files, with no fetch, no `--offline` and no team section. It writes `maps/<key>/delivery.yaml` for each map, and the plans above read that committed file. `nikos state set`, `approve`, `map new`, `story new` and `nikos migrate maps` keep `delivery.yaml` current too.
- `nikos validate` fails when a map's `delivery.yaml` is missing or no longer matches its files, such as after a hand edit. Run `nikos map status` and commit the result.
- In a group's repo, approval now checks the code it was tested at, as a team's repo did: `nikos approve` refuses a story whose code changed since it was tested, or with uncommitted code, and `validate` warns about it. Approval lapses on a code change in group repos from this release. A story done before this release has no recorded test commit, so approve refuses it until its scenarios run again: `nikos state set <id> needs_rework`, then `in_progress`, `done`, and `approve`.

### Removed

- `nikos migrate per-story` and `nikos migrate single-file`, the `state/<id>.yaml` and single `approvals.yaml` layouts, `templates/intent/`, and the `findIntentDir`, `perStory` and `migrate` library exports. The `--group-key`, `--rename-ids` and `--bet` options of `nikos migrate maps` and the MCP `migrate` tool are gone too. To move a repo by hand, `git mv intent maps/<key>`, move `constitution.md` and `decisions.md` up to the repo root, fold each `state/<ID>.yaml` into `state.yaml` under `stories:`, and split `approvals.yaml` into one `approvals/<ID>.yaml` per approval. `nikos validate` names any of these it still finds.
- `nikos assign`, `nikos sync`, `nikos team` (`init`, `join`, `member`, `show`), `nikos.team.yaml`, `assignments.yaml`, `.nikos/assigned/` and `.nikos/teams/`, and the team `status/` and `approvals/` folders, are gone. Nothing migrates them, and nikOS ignores those files from this release. To keep a team's story map, move it by hand into `maps/<key>/` in the repo that builds it, as `intent/` moves. The company plan's team level (`nikos plan add team`) is unchanged.

## 0.4.3 (2026-11-09)

### Changed

- The planning dashboard (`nikos serve`) is redesigned: clearer page titles and hierarchy, key result cards with their status, bets titled in words with their delivery and outcome side by side, a check-in form on each key result, and empty states that say what's missing and how to add it. It follows the system's light or dark setting, and works at phone width: the sidebar becomes a row of tabs, and the OKR columns and timeline scroll sideways. Every page meets WCAG 2.2 AA contrast, can be used with a keyboard (a skip link, visible focus, focus moved to the title on each page), and names its parts for screen readers. Save buttons say "Saving…" until the save comes back. Saves, Push, the token and the exports work as before.
- The story map page uses the same colours and type, follows dark mode, links back to the plan, and says what to do when it has no stories.
- `nikos start` asks plain questions. In your home folder, it asks what to call the new folder, and an answer like yes or no is asked again instead of making a folder called `yes`. Before writing anything it shows what it will set up and the full path, and asks to go ahead. Its next steps are numbered, and none has a placeholder left to fill in: when the repo isn't on GitHub or GitLab yet, it says so instead of printing `<owner>/…`.
- A mistyped command gets the nearest one, in two lines, instead of the whole help: `Unknown command 'serv'. Did you mean: nikos serve?`. `nikos planning` does the same, and a planning command with something missing shows just its own usage.
- `nikos serve` says in plain words that the dashboard is running, which link to open, that the link is private, and where changes are saved.
- The help (`nikos help`, `nikos planning help`) is grouped by task and written in everyday words, and the messages of `company init`, `group init`, `team init`, `join`, `doctor`, `apply` and the common errors were rewritten the same way. `nikos doctor` ends with a one-line summary.

## 0.4.2 (2026-11-09)

### Fixed

- A bet with no stories of its own (a company bet that a department's bet and a group's bet deliver) no longer says "Not started" in `nikos planning status`, the dashboard's Bets page or the rollout. It names what delivers it below, with each bet's and map's counts, as the last `nikos planning rollout` read them.
- A story whose proof is for an older version of its feature is no longer counted done above the group. `nikos map status` writes `proof: changed` (or `behind`, `unverified`) beside it in `delivery.yaml`. The rollout, `planning status` and the dashboard then say "1 not current with its feature", as the group's own page does. A summary with this field can't be read by 0.4.1 or earlier: upgrade the plans above with the group.
- The rollout's `next` for a group reads each story's status from its committed `delivery.yaml`, not the group's own `state.yaml`, so it no longer names a story the summary counts done. A story whose proof isn't current isn't next either: it is work to redo.
- `nikos suggest` on a company or department plan with no story map offers the plan's menu (check in, review a bet, the rollout, the plan) instead of "nikOS isn't set up". On a group with several maps it shows each map's progress instead of failing, and `--map` now reaches every check it runs. The MCP `status` tool takes `map` too.

## 0.4.1 (2026-11-09)

### Fixed

- In a team repo that owns a map, committing `maps/<key>/delivery.yaml` (written by `nikos map status`) or `maps/<key>/assignments.yaml` (written by `nikos assign`) no longer makes the team's approvals read as stale: `nikos validate`, `show` and `approve` said "the code has changed since it was tested". Neither file is code, as a team's `status/` and `approvals/` aren't. An uncommitted `delivery.yaml` no longer counts as uncommitted code for `nikos state set … done` either.

## 0.4.0 (2026-11-09)

Part of the teams amendment (see `docs/rfcs/plans-bets-story-maps.md`, "Amendment status", for what is built and where it differs). A team can own story maps, give its stories to other teams, and report their delivery through committed summaries. A repo that doesn't opt in (a 0.3.0 team with no key, home, map or joined plan) behaves as before.

### Added

- A team that has a key can own story maps: `nikos map new --bet <bet-id>|<repo>#<id> --key <KEY>` in a team repo makes `maps/<key>/`, whose story ids are `<TEAM>-<KEY>-n` (e.g. `WEB-INB-1`). Its status and approvals stay at the team's root (`status/`, `approvals/`). `nikos story`, `step`, `activity`, `release`, `state`, `approve`, `validate`, `doctor`, `next`, `show` and `verify` work on its own maps.
- A team's own bets live in its `planning/bets/`, aimed at company or department key results (`krs: <repo>#<kr-id>`) and optionally aligned to bets in the plans it joins. `planning kr new` stays refused in a team repo.
- `nikos team join <team repo>` takes stories from another team that owns a map, read-only, as it takes them from a group. Its key names the story ids. `nikos sync` fetches them into `.nikos/assigned/`.
- `nikos assign "<team>" --repo <path|.>` works in a team repo for its own maps: `--repo .` is its own share, and another team's share is written the way a group writes it, in `maps/<key>/assignments.yaml`.
- `nikos map status` works in a team repo for its own maps: its own stories are read in place, other teams are fetched as a group fetches them, and `maps/<key>/delivery.yaml` is written for the plans above.
- `nikos planning downstream add <name> --home <repo>` (and the `add_downstream` tool's `home`) marks a team or group that is homed in another plan. The rollout says "homed in <repo>".
- `nikos join` and `nikos team join` refuse a key that clashes with a key in the chain's copies, naming both repos. The rollout reports two copies below it with one key as an error line.
- `nikos doctor` suggests a CODEOWNERS rule for each map's `assignments.yaml`, naming the home plan's lead. The lead is an optional `lead:` in `planning/plan.yaml`; without one the suggestion shows `@<home-lead>`. Nothing is written.
- `nikos migrate maps` in a team repo moves its `intent/` into the team's `maps/<key>/` in place. The team's key (`--team-key`), its home (`--home <repo>`) and its bet (`--bet`, `--new-bet` or `<repo>#<id>`) come from `nikos.team.yaml` or those flags. The plan is shown first and the layout is checked on a copy, as for a group.

- `nikos team init --key WEB` gives a team its key. A team file with a key or a home is format 2, which 0.3.0 can't read: a team upgraded this way must be upgraded in its groups too. A team with no key keeps format 1.
- `nikos map status` writes `maps/<key>/delivery.yaml` in the group's repo, one line per story: its team, status, approval (a name, not a verified identity) and when it was read. Commit it: the plans above read it. Rollouts and the bet lines say how old each summary is, and how many stories have no summary yet. Offline reads write nothing.
- A map below that delivers another plan's bet (a team's map for a company bet) shows in that plan's rollout: under the bet in the alignment tree, and on the copy's line as `map <key> → <repo>#<bet>` with its counts. `nikos planning status` there gives such a bet the maps' counts, as the last rollout read them.
- `nikos map status` in a team repo shows the team's approval of its own share ("approved by …") and writes it to `delivery.yaml`. The team's own row reads "this team (--repo .)".
- A bet that aligns to a stopped bet is flagged in the rollout: "aligns to <bet>, which was stopped on <date>". Nothing else changes.
- A team repo may run `nikos planning bet new`, `planning sync`, `planning status`, `planning validate`, `planning rollout`, and `nikos join`, once it has a key, a home, a map of its own or a plan joined. `planning kr new` there is refused with the key-result wording. A team repo with none of those is refused as in 0.3.0.
- `nikos join <plan> --home` makes a plan a team's home (a group, department or company plan, with a key that isn't the team's own), records it in `nikos.team.yaml` at format 2, and refuses a second home. A group's `--home` marks the plan in its `planning/upstream.yaml`. `nikos doctor` warns about a team that joins a plan with no home.
- A team's settings and locks come only from its home's chain. A group marked with a home takes its settings from that plan's chain alone.

### Changed

- A team repo with `intent/` and no key is still refused by `nikos migrate maps`, now with the key to pass (it was refused with a move it couldn't make).
- `nikos assign` and `nikos map status` in a team repo are refused only when the team has no map of its own, with the 0.3.0 wording kept.
- Rollouts read a team's delivery from its committed `delivery.yaml` (its own maps), the same as a group's, and never from its `status/`.
- A team's `nikos.team.yaml` may name a `home` and `key` (format 2): 0.3.0 can't read it.
- A plan aligns to any plan above it that it joins, not only the one directly above. A group may align a bet to a company bet it joins. The "isn't the plan directly above this one" message is now "isn't a plan this <level> joins".
- Key-result targets in `krs:` (cross-plan) are checked like `aligns_to`.
- `nikos state set <id> done` exits 0 once the move is written; a problem found elsewhere is printed as a `!` warning.

### Fixed

- `nikos <command> --help` prints that command's help and runs nothing. `team init --help`, `init --help`, `start --help`, `join <repo> --help` and `planning downstream add --help` used to run the command and write files.
- `--map` takes the key `map new` prints, case-insensitively (`--map HR` finds `maps/hr`).
- The rollout's delivery read "0 of 0" for a group with several maps, and "team status not read here" for a bet. Both now come from the owner's summary.
- The alignment tree printed a group bet twice: under the bet it aligns to, and under the key result. It's now shown under the bet only.
- A bet aimed at a stopped bet is flagged in the dashboard's OKRs and bets page too, and in the rollout when the stopped bet is in the plan being rolled out.
- A bet's delivery line says how old the summary it counts is, as the plan line does.
- The rollout's next story and story titles come from every map of a group, not only a group with one map.
- `nikos map status` can run twice in one repo: it overwrites `delivery.yaml` instead of failing with EEXIST.
- `nikos map status --json` writes nothing, so a piped run leaves the group's tree clean.
- A 0.3.0 team repo with no key or home no longer gets a "team plan" warning from `nikos doctor`.
- A team's settings no longer include a plan it joined that isn't its home, and a team with a home is no longer read by the generic walk.

### Review fixes

- A 0.3.0 team with no key, home or maps is refused, read and settled as before. A team with a `planning/` folder reads the locks of the plans it joined again, and `nikos doctor` adds no home warning for it. A keyless team can still be made in a group repo with no maps (`nikos team init`); a keyed one can't.
- `nikos team init --key WEB` gives a team that has no key yet its key (format 2). A key already set is kept.
- `nikos team join --home` is refused: a home is set with `nikos join <plan> --home`.
- `nikos.team.yaml` with a `key` must be format 2, as a home already was.
- `nikos team show` lists the team's key, home and own maps.
- `nikos assign --repo .` names the team it's run in: another team's name is refused with the repo to use.
- A team's own map with no assignments gets its `delivery.yaml`, its stories read from the team's status. A rollout reads no team status for next-up or blockers.
- A bet named as `<repo>#<id>` matches the same bet from the repo it names.
- `nikos migrate maps` in a team repo writes each story's state and approval to the team's `status/` and `approvals/`, and says "team key" where it means one. `nikos migrate maps --help` prints the usage.
- `nikos state set` names only the story it changed when an approval has lapsed.
- `nikos planning status` puts a space before a word unit (12 days) and keeps % tight.
- `nikos map new` in a team needs its home (as well as its key), and says which join to run.

## 0.3.0 (2026-11-08)

### Added

- `nikos migrate maps` moves a 0.2.x repo's `intent/` story map to `maps/<key>/` of a group, and makes the repo its own team (`nikos assign <team> --repo .`). It shows the whole plan first (`--dry-run`), checks the new layout on a copy of the repo, and writes nothing until confirmed (or `--yes`). The changes are left uncommitted on `nikos/migrate-maps`, or committed with `--commit`, which commits only the paths it wrote; nothing is pushed. If a write or the check fails, the repo is put back as it was. Files under `intent/` that migrate doesn't move (other than `.gitkeep` and Finder or Explorer files) stop it before any write, and an unknown `--option` is a usage error. Story ids keep their names unless `--rename-ids` is given (`KEY-n` becomes `GROUP-KEY-n`, and tags are rewritten above `Feature:` only). Bet links that a map can't keep are listed as dropped, with what to add by hand. Team repos with `intent/` are refused, with the steps to move it.
- `nikos doctor` explains a 0.2.x repo's layout and points at `nikos migrate maps`. It warns about a team plan (`planning/plan.yaml` at `level: team`) in any repo, and about a runner config that doesn't list the story's folder. A 0.2.x repo is never failed for either.
- Onboarding levels. `nikos start` (in a terminal) asks what's being set up: 1 a company plan, 2 a department plan, 3 a group (with its key, and whether it's its own team, with `--repo .`), 4 a team repo that joins a group, 5 one product in one repo, 6 both. A team repo is refused before any question when its folder has `intent/` or `maps/`.
- The `migrate` command's usage text lists `maps`, and `nikos migrate maps` is not exposed through the MCP server.

- Editable snapshots. `nikos planning serve --export plan.html --editable` (and `nikos serve`) writes one offline page that queues changes, shows them, and downloads `<plan>-changes-<date>.nikos.json`. It holds this level's own files, with team status left out. `--with-linked` also embeds the copies of the plans above and below, read-only. Nothing in the page is sent anywhere.
- `nikos apply <file>` applies a change file from an editable snapshot to the repo, on a new `nikos/plan-<level>-<date>` branch, through the same checks as the dashboard. Operations that no longer apply are listed with the reason and the rest still apply (exit 2). It commits only with `--commit` (or a typed y), and opens a pull or merge request only with `--pr` after a second confirm. Nothing is pushed unless asked for. `--dir` picks the repo.
- The change file format, `schemas/planning/changes.schema.json`: operations and their `expect` hashes, with no field that could carry a token, a password, a url or a command.
- Dashboard views. A company or department plan has *OKRs and bets* (the key results above and by objective, its bets and the bets above them, with group bets aligned to one of its bets shown as delivery only) and an *OKR ladder*. A group plan has *Bets and story maps*, with each team's status from its last `nikos map status` on this machine. The views never fetch on render.
- Editing from the dashboard. Key results, check-ins, bets (fields, review, alignment), story titles, activity and step titles, and team assignments are saved through `POST /api/op`, which runs each change through the command the CLI uses. The same checks refuse a save with the same message.
- Saves on a branch. In a git repo, the first save on the base branch makes `nikos/plan-<level>-<date>`. A pending bar shows the changes not yet committed, with Commit, Push branch, and Open pull request (GitHub with `gh`, GitLab with `glab`, or the command to copy). Nothing is committed, pushed or opened without its click. Commit stages only `planning/`, `maps/` and `intent/`.
- `nikos` story and map commands gained the functions the dashboard uses (`renameStory`, `removeStory`, `renameActivity`, `renameStep`, `newMap`, `unassign`); their output is unchanged.
- The UX pack (`tools/ux/`, install `nikos-ux`): the `design-library` skill turns a product's existing tokens and components into a component library page and a Copy prompt brief for agents, both from one data module, with tests that keep it matched to the source. nikOS's router sends requests for a component library or design system page to it through the new `ux-library` playbook. Example: nikos.tools/ux/library.
- Status flowing back. In a group repo, `nikos map status [--map <id>] [--offline] [--json]` shows each assigned team's status on each story: the team's repo is fetched read-only (its `status/`, `approvals/` and `nikos.team.yaml` only), and a story's status counts only when the team proved it against the story's current feature. Each story shows its freshness (current, changed, behind, unverified, moved, unassigned, not-fetched, no-status or in-place), its delivery approval and the group's intent approval. A team that can't be fetched shows its last good copy and says why; the command still exits 0. The MCP server has it as `map_status`.
- A bet's delivery in a group repo counts a team's done stories only when they're current and their delivery approval holds, and says how many await approval and how many teams aren't fetched. A team repo's own delivery now counts its own status (it used to read the group's empty state and show 0 of N).
- `nikos assign` checks a holder team's done state in its fetched copy, and names where it read it. With no copy, it checks the group's own `state.yaml` and warns. `--url` and `--ref` record a team's repo and branch when they're not the default.
- Team settings: a group's and company's locks reach a team on `nikos sync`, with the same "locked by" message. Unlocked values above a team don't apply to it.
- `nikos doctor` in a group repo warns when an assigned team has never been fetched, or its last fetch failed; in a team repo it names settings problems in the group copies.

### Changed

- Breaking, for scripts that pipe answers into the terminal wizard: its menu is now six choices (see the onboarding note above). The old `1` (a team's product) is now `5`, `2` (a company plan) is now `1`, and `3` (both) is now `6`. Flags and non-terminal runs are unchanged.
- `nikos start` refuses a repo that has `maps/` (a group's story maps): add a product's story map with `nikos map new` there.
- The behave runner template's header now says what it runs. behave takes folders, not globs: `nikos verify setup` in a group repo lists one `maps/<key>/features` folder per map (a multi-line `paths =`), and keeps `paths = intent/features` in a 0.2.x repo.
- `nikos doctor`'s runner check warns when a runner config lists paths but not the story folder. A config with no paths of its own still passes.

- The dashboard's Rollout tab and its alignment tree are replaced by the views above. The rollout's list of plans below (joined, last synced, delivery) stays in `nikos planning rollout`; the dashboard doesn't show it.
- Behaviour change in git repos: the first save from the dashboard on the base branch now creates a `nikos/plan-<level>-<date>` branch. Plain writes remain for folders that aren't git repos, and with HEAD detached.
- Saves from the dashboard in a git repo go on a branch, not on the base branch (see Added).
- `/api/op` refuses to set a bet's outcome: only a bet review sets it. The older `/api/bet` still accepts `outcome`.
- POST requests to the dashboard need a JSON content type, and are refused when their Origin or Sec-Fetch-Site comes from another site (403), or the body is not JSON (415). A token in the dashboard address is removed from the address bar after the page loads.
- Story ids in `/api/op` are checked by the kind of id they are, so a group's story ids (`PAY-CHK-12`) work.

- A team's `state set` writes `spec_hash` on every status write, not only on done, so a team's status shows which feature it was written against.
- Release note: where `approval.policy` is `required-for-release`, a group's done stories with no delivery approval count as awaiting approval, so its bets can show Building where they showed Shipped. Under `optional` (the default) and `off`, done stories count without an approval.
- Release note: `assignments.yaml` takes `url` and `ref`. A CLI older than this one rejects a group that uses them.

- Teams. A code repo becomes a team repo with `nikos team init` (its name and repo path, in `nikos.team.yaml`), and takes work from a group with `nikos team join <group repo>`. `nikos team member add|remove` and `nikos team show` manage its members, names and roles only.
- `nikos assign "<team>" --repo <path|.>` in a group repo gives a team all or part of a map: `--activities`, `--releases` or `--stories`, adding to what the team has (`--replace` redefines it). A story belongs to one team; a done story moves only with `--include-done`. `maps/<id>/assignments.yaml` holds the assignments, and `nikos validate` reports overlaps and the stories nobody holds yet.
- `nikos sync` in a team repo fetches each group read-only and copies the stories assigned to the team into `.nikos/assigned/` (gitignored). A story another team now holds is marked `reassigned_to` in the team's `status/`.
- Team status and delivery approvals. In a team repo `nikos next`, `state set`, `approve`, `show`, `verify` and the tracker commands work on the assigned stories: status goes to `status/<id>.yaml`, and an approval to `approvals/<id>.yaml`, recorded against the commit the scenarios ran at. Story ids are the group's (`PAY-CHK-12`), so stories from several groups coexist.
- `nikos verify` in a team repo lists the steps in its assigned stories that have no step definition yet.
- `nikos doctor` understands a team repo: its groups (synced, moved on, or not yet), its runner, and a CODEOWNERS suggestion for the lead.

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

- The Cucumber runner configs (`cucumber.mjs`, `behave.ini`) read the team's assigned copies: `nikos verify setup` writes the new paths for new repos. An existing config isn't rewritten; add `.nikos/assigned/**/features/**/*.feature` to its `paths` yourself (doctor says so).
- `nikos map` with `new` makes a map in a group repo. In a repo with `intent/` it no longer writes a page for `nikos map new`: bare `nikos map` still writes `storymap.html`.
 loads with a warning: teams are assigned story maps by
  their group instead. Its key results and objectives are warnings, not errors,
  until a later release migrates them.
- `nikos planning rollout --json`, the dashboard's data and custom views give
  `aligns_to` as a list on key results and bets. A key result also carries
  `aligned`, every key result it aligns to. `upstream` is still the first.
- The dashboard's guide shows company, department and group, with the story map
  under a bet.


### Fixed

- `nikos planning rollout` no longer deletes a plan's last good copy when a fetch fails: the copy is shown with a note saying when it was read.

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
