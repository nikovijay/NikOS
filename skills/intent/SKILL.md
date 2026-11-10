---
name: intent
description: Explain what a story is meant to do and where it stands, from the repo's specs. Use when someone asks what a story is for, what it covers, or what state it's in, by its id (e.g. HT-2) or by topic.
---

# intent

Say what the spec says, not what the code happens to do.

## 1. Find the story

If you have a story id, use it. If you only have a topic, search the
`Feature:` lines under `maps/<key>/features/` and pick the story that matches.
If more than one could match, list them and ask which one.

## 2. Read everything recorded about it

```
nikos show <story-id>
```

It prints the feature (user story and scenarios), its status from
the map's `state.yaml`, its release, the latest plan, any bets it's linked to,
and decisions tagged with its id. Open the feature file and the plan it
names when you need more than the summary.

## 3. Answer in plain words

Say, in a few sentences:

- who it's for and what they get (the "As a / I want / So that" lines),
- what has to be true for it to be done (each scenario, by its AC label),
- where it stands: status, who has it (`claimed_by`), blockers, and the latest
  plan. A story in the run queue but unclaimed is waiting, not being worked
  on.

Cite each claim as `path:line`, including the bet and plan files `nikos show`
names. If the spec doesn't say something, say so.
Don't fill the gap from the code or from guesswork.
