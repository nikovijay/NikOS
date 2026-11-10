---
name: clear-review
description: Get a sceptical second review of a story's spec before building it, from another model or a fresh agent when one is available. Use when a spec is about to be built and the person wants it challenged, or when CLEAR passed but something feels off.
---

# clear-review

One reviewer misses things. A second one, with no stake in the spec, finds
more.

## 1. Run CLEAR first

Check the story with the clear skill. If a check fails, stop and report it.
There's no point reviewing a spec that already fails.

## 2. Ask a second reviewer to attack it

If you can hand work to another model or a fresh agent with no memory of this
conversation, give it only:

- the story's `.feature` file,
- `constitution.md` at the root,
- the entries from `nikos decisions "<story-id>"`,

and this brief: "You are a sceptical reviewer. Find what's ambiguous,
missing, contradictory, untestable or risky in this spec. For each problem,
quote the line and say what could go wrong. Don't suggest code."

Don't share your own CLEAR results or opinion with it, so its read isn't
anchored on yours.

If you can't hand work off, do the review yourself as a separate pass: reread
the feature as that sceptical reviewer, line by line, and say in the report
that it was a single-model review.

## 3. Merge into one list

Combine your CLEAR results and the reviewer's findings into one list. Drop
duplicates, and say who raised each finding. For each one, say whether it
blocks building (the spec is wrong or untestable) or is a note.

## 4. Stop for the person

Show the list. Change the spec only once the person agrees to each change.
A finding is a question for them, not a fix for you.
