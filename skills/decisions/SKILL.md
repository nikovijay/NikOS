---
name: decisions
description: Show why something was decided by quoting the decision log, or say plainly that no decision is recorded. Use when someone asks why a choice was made, what was rejected, or whether something was ever decided.
---

# decisions

The reason for a choice is whatever `decisions.md` at the repo root says. Never invent
one.

## 1. Search the log

```
nikos decisions "<the question or topic>"
```

It quotes every entry that mentions the topic, best match first, each with
its `decisions.md:<first>-<last>` line range. A story id (e.g. HT-1)
finds the entries tagged with it.

If nothing matches, try again with the words the spec would use: the name
of the feature, the library or the setting, and other spellings (colour and
color).

## 2. Answer from the entries

Quote the lines that answer the question, cite them as
`decisions.md:<lines>`, and give the date and story id. If an entry
says it supersedes another, quote both and say which one stands.

Only cite an entry that actually answers the question. A match on a shared
word isn't an answer.

## 3. When nothing is recorded

Say: "No decision about <topic> is recorded in decisions.md." You may
add what the git history of `decisions.md` shows (`git log -p -- decisions.md`), marked
clearly as history, not a recorded decision. Then offer to log one:

```
nikos decide "<title>" --why "<why>" --category <product|architecture|design|interface|process>
```

Log it only once the person tells you the reason. Don't write a reason for
them.
