# RFC: metrics trees

**Status:** draft, for discussion. Nothing here is built, and no command reads
`planning/metrics.yaml` yet.

## Summary

A company or department can describe the metric it ultimately cares about
(its North Star) and the input metrics believed to drive it, each with an
owner, in `planning/metrics.yaml`. A key result can then say which metric it
moves with `metric: <repo>#<metric-id>`. Rollout and the dashboard can show
which key results, at every level, point at each part of the tree.

Like `aligns_to`, this records links. It never works out a metric's value, or a
key result's progress, from anything else.

## Why

Key results change every period. The metrics they move mostly don't. Today the
only thing tying a team's key result to the company's direction is `aligns_to`,
which points at one key result in one period. When that key result is replaced
next quarter, the link has nothing to point at.

A metrics tree gives the plans a longer-lived thing to point at:

- A team can see which input metric its key result is meant to move, and who
  owns that metric, without reading the whole company plan.
- A company can see which input metrics have no key result moving them this
  period, and which have several.
- A key result that points at no metric becomes visible, which is often the
  conversation worth having.

## Concepts

- **North Star:** the one metric a plan treats as its main measure of value
  delivered. One per tree.
- **Input metric:** a metric believed to drive its parent. Inputs can have
  their own inputs. The tree records a belief, not a formula.
- **Owner:** the person or team accountable for watching a metric and for its
  definition. Owning a metric doesn't mean owning every key result that moves
  it.
- **Link from a key result:** `metric:` on a key result names the metric it is
  meant to move. A key result has at most one `metric`. `aligns_to` stays as it
  is: it says which key result above this one it supports.

## Draft schema

`planning/metrics.yaml`, in a company or department repo:

```yaml
north_star:
  id: plants-thriving
  title: Plants still thriving 90 days after they're added
  owner: Acme leadership
  unit: "%"
  definition: Share of plants added 90 days ago whose last three check-ins were healthy.
  inputs:
    - id: reminders-acted-on
      title: Watering reminders acted on the same day
      owner: Reminders team
      unit: "%"
      definition: Reminders marked done within 24 hours, over reminders sent.
    - id: care-guides-read
      title: New owners who read a care guide in week one
      owner: Content team
      unit: "%"
      inputs:
        - id: guide-search-success
          title: Care guide searches that end on a guide
          owner: Search team
          unit: "%"
```

On a key result in any plan below:

```yaml
id: reminder-timing
title: Reminders sent at each plant's real watering time
metric: acme/company-plan#reminders-acted-on   # optional
aligns_to: acme/company-plan#kr-2               # unchanged
```

Draft JSON Schema for `metrics.yaml`, following `schemas/planning/`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://nikos.tools/schemas/planning/metrics.schema.json",
  "title": "nikOS Planning metrics tree",
  "type": "object",
  "required": ["north_star"],
  "additionalProperties": false,
  "properties": {
    "north_star": { "$ref": "#/$defs/metric" }
  },
  "$defs": {
    "metric": {
      "type": "object",
      "required": ["id", "title", "owner"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string", "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$" },
        "title": { "type": "string", "minLength": 1 },
        "owner": { "type": "string", "minLength": 1 },
        "unit": { "type": "string" },
        "definition": { "type": "string" },
        "source": { "type": "string", "description": "Where the number is read, e.g. a dashboard url. Never fetched." },
        "inputs": { "type": "array", "items": { "$ref": "#/$defs/metric" } }
      }
    }
  }
}
```

And one new optional property on `kr.schema.json`, using the same reference
pattern as `aligns_to`:

```json
"metric": { "type": "string", "pattern": "<same as aligns_to>" }
```

Rules `nikos planning validate` would check:

- Metric ids are unique within a tree.
- `metric:` on a key result resolves to a metric in a synced copy (`upstream`)
  or in this repo. One that doesn't resolve is a warning, as a broken
  `aligns_to` is today.

## What it shows

- `nikos planning rollout`: under each metric, the key results across the
  rollout whose `metric` points at it, grouped by plan, the same way the
  alignment tree groups key results under the key result they align to.
- Dashboard: a Metrics view with the tree, its owners, and each metric's
  linked key results. A metric with no key result this period is marked as
  such.

## What it deliberately doesn't do

- **No values.** The tree holds definitions and owners. Numbers stay in key
  result check-ins, typed by people, with evidence links. A metric's `source`
  is a link for people to follow, never something nikOS fetches.
- **No roll-up.** A North Star is never shown as moving because its inputs, or
  the key results linked to them, are. The tree is a stated belief about cause,
  and the plans show whether the belief held only through the evidence people
  record.
- **No weights or formulas.** "Input A drives 40% of the North Star" invites
  false precision. If a team has a real model, it can link to it in
  `definition`.

## Alternatives considered

- **Metrics as key results with no end date.** Reuses the KR format, but a
  KR's `target`, `by` and check-ins don't fit something that is never
  "done", and mixing the two makes the KR list harder to read.
- **Metric field on objectives instead of key results.** Objectives are too
  broad: one objective often moves several inputs.
- **A separate metrics repo.** Possible, and listed below as an open question.
  The draft keeps it in `planning/` so it uses the existing upstream sync and
  needs no new repo kind.

## Open questions

1. **Relation to the hierarchy schema.** The levels (company, department,
   group, team) and how plans nest are still an open design. Should a
   department's tree be a subtree of the company's (its North Star is one of
   the company's inputs, by reference), or an independent tree that links up?
   This RFC assumes independent trees that can reference each other, so it
   doesn't fix the hierarchy before that design does.
2. **Relation to change impact.** When a company revises an input metric, or
   moves it to another parent, which plans below need to hear about it? The
   change-impact cascade is also open. Trees probably need the same answer as
   key results: the plans below see the change at their next
   `nikos planning sync`, and `sync --check` says something moved. Is a
   changed metric definition a bigger signal than a changed key result, and
   should rollout flag key results that point at a metric that changed since
   their plan last synced?
3. **Which repo each tree lives in.** Options: the company plan repo only;
   each department's plan repo for its own tree; or a dedicated metrics repo
   that every plan lists in `upstream.yaml`. Owners of a metric may sit in a
   different department from the one whose tree it is in.
4. **Shared ids.** Metric ids and key result ids share a namespace in
   `<repo>#<id>` references. Should references say which they mean
   (`#metric:reminders-acted-on`), or should validate refuse a metric id that
   matches a key result id in the same repo?
5. **Periods.** Key results belong to a period; a tree mostly doesn't. Does a
   tree change get recorded by period (as `original_target` is kept today),
   or is git history enough?
6. **More than one North Star.** Some companies run two (for example, one for
   customers and one for the business). Allow a list, or ask them to keep two
   trees?
7. **Bets.** Should a bet be able to name a metric directly, for work that is
   meant to move an input but has no key result this period?

## If accepted

1. Add `schemas/planning/metrics.schema.json` and the optional `metric` on
   key results, with validate checks.
2. Read `metrics.yaml` in `planning serve` and show the Metrics view.
3. Group key results by metric in `nikos planning rollout`.
4. Teach the planning skill to ask which metric a new key result moves.
