# dashboard

Show the plan in the local dashboard, share a read-only snapshot, or build a
custom view the person describes.

1. To view or edit the plan, run `nikos planning serve` and give the person the URL it prints (it carries the start-up token). It serves 127.0.0.1 only. Edits write to `planning/` through the same checks as the commands, name the file they wrote, and commit nothing.
2. To share, run `nikos planning serve --export <file>.html`. The snapshot is one offline file that can't edit anything. If it warns that it includes plans from other repos, tell the person and confirm they may share those before they send it.
3. For a custom view, ask what the person wants to see and do: which key results or bets, filtered how, and whether it should save anything. Show a sketch of the view and wait for their yes.
4. Build it as one HTML file at `planning/views/<name>.html` (lowercase words joined by hyphens). Use only the view contract below, inline CSS and JavaScript, and no external scripts.
5. Open it at `/views/<name>` in the running dashboard and check it shows the right data. If it saves, make one test edit with the person watching and show the file it wrote.
6. Report every step with its evidence or its skip reason.

## The view contract

The dashboard adds `/nikos-view.js` to every page in `planning/views/`. It
defines `window.nikos`:

- `await nikos.data()` returns the plan: `plan` (period, level, pillars,
  objectives), `krs` (each with `id`, `title`, `baseline`, `target`, `by`,
  `checkins`, `latest`, `stale`, `progress`, `hash`, `file` and its resolved
  upstream alignment), `bets` (each with its card fields, `delivery`, `hash`,
  `file`), the story map summary, and `upstream` plans.
- `await nikos.save(kind, payload)` writes through the dashboard's checks and
  returns `{ wrote }`, the file it wrote. Every payload carries the `id` and
  the `expect` hash of the version the view loaded; a stale hash is refused
  and the view should reload with `nikos.data()`.
  - `"checkin"`: `{ id, expect, value, note?, evidence? }`
  - `"bet"`: `{ id, expect, fields }` with any of owner, team, hypothesis,
    starts, review_on, deadline, confidence, dependencies
  - `"review"`: `{ id, expect, decision, reason, outcome? }`

A view never writes files itself and never calls anything but `nikos.data()`
and `nikos.save()`.
