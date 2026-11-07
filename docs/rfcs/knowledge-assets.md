# RFC: notes, research and asset links beside the plan

**Status:** draft, for review. Design only: nothing here is built yet.

## Summary

Goals and specs already live in the repo: `planning/` for objectives, key
results and bets, and `intent/` for the story map. The things around them do
not. Meeting notes, research and links to designs or decks end up in chat
threads, shared drives and wikis, and lose the link to the goal or story they
were about. This RFC proposes where they live at each level (company,
department, group, team, initiative), what each file says about itself, and
what nikOS checks.

Four principles run through all of it:

1. **Repos are the shared record.** Notes and research are plain Markdown
   beside the plan they belong to, changed by pull or merge request like
   everything else.
2. **Folders are not access control.** Anyone who can clone a repo can read
   every file in it. Something only some people may read goes in a restricted
   repo of its own, never in a folder of a widely read one.
3. **Links, not copies.** Large files and anything already kept in an approved
   store (designs, decks, recordings) are linked, not committed.
4. **Nothing moves without a yes.** nikOS suggests where a file belongs and
   checks its links. It never moves or deletes a person's notes on its own.

## Background

The next release gives a company or department plan its own decisions
(`planning/decisions.md`), and the rollout shows each plan's latest decisions.
A team's notes are ordinary files today: `nikos migrate` leaves them where
they are, and nothing links them to a goal or story. A QA pass put a note in
`notes/` in a widely read company repo; the rollout did not index it, but
anyone who could clone the repo could read it. That is principle 2 in practice.

## Proposed layout

At each level, beside `planning/` (and `intent/` where the level has a story
map):

```
planning/                 goals: plan.yaml, krs/, bets/, decisions.md (plan-only repos)
intent/                   specs, at levels that deliver: storymap.yaml, features/, decisions.md
knowledge/
  notes/2027-01-12-pricing-review.md
  research/checkout-drop-off.md
  assets.yaml             links to designs, decks and recordings in approved stores
```

An initiative that spans teams gets a folder under `knowledge/initiatives/<id>/`
in the plan that owns it, with the same three parts.

Decisions stay in `decisions.md`, append-only, where they are today. A note can
record that a decision was made and link to its entry; the entry is the
record.

## What each file says about itself

Notes and research start with front matter:

```markdown
---
owner: Payments product lead
date: 2027-01-12
status: published          # draft | published
related: [acme/company-plan#kr-1, one-tap-pay, PAY-2]
---
```

- `owner` is a role or team, as on key results and bets. Not a personal email.
- `related` uses the references nikOS already resolves: key result and bet ids,
  `repo#id` for another plan, and story ids.
- `status: draft` is for the company that wants notes reviewed before they
  count, the same way specs are reviewed before they're approved.

`assets.yaml` is a list of `{ title, url, owner, related }`. The url points at
the approved store; nikOS never fetches it.

## What nikOS would do

- `nikos note new "<title>"` and `nikos research new "<title>"` write the file
  with its front matter, dated, in the right folder.
- `nikos validate` and `nikos planning validate` check `related` references
  the same way they check bet and key result links: unknown local ids are
  errors, other repos' ids that aren't synced are reported as unresolved.
- `nikos decisions "<topic>"` searches notes and research too, quoting the file
  and line.
- The rollout lists the titles of a plan's latest published notes, never their
  text, so nothing is copied upward.
- `nikos doctor` warns when `knowledge/` holds files over a size limit, or
  files with no front matter, and suggests the fix. It never moves them.

## Keeping restricted material out

- No classification field pretends a file is protected. A file in a repo is as
  readable as the repo.
- `nikos note new --restricted` refuses, and says to use the restricted repo the
  company has listed for that purpose.
- Restricted repos join the rollout like any other plan. People who can't read
  them see them as unreachable, which the rollout already reports without
  treating them as missing.

## Open questions

1. The exact front matter fields, and whether `classification` is wanted at all
   given principle 2.
2. Link stability: how a note refers to a story or key result that is later
   renamed or cancelled.
3. Whether decisions should ever move to one file per decision, as story state
   did with `nikos migrate per-story`, once several people record them at once.
4. The size limit for committed files, and whether a company may opt into Git
   LFS. The default proposed here is links only.
5. How far the dashboard should go for readers who don't use git: listing
   notes, or also rendering them.

## Not in scope

- Importing from wikis, drives or meeting tools. A playbook could draft notes
  from them later, with the person's yes for each.
- Access control of any kind beyond the git provider's own.
