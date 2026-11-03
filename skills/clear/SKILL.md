---
name: clear
description: Check a story is Clear, Lean, Executable, Accurate and Responsible before anyone plans or builds it. Use before building any story, or when asked to review or check a spec.
---

# clear

A story must pass all five checks before it's built. Bad specs caught here
never become bad code.

## 1. Run the mechanical checks

Run `nikos clear <story-id>` in the repo. It finds the story's `.feature` file
and decides **Lean** and **Executable**, which a script can check better than
a person. Use its result for those two checks; don't overrule it.

If the command isn't available, check them by hand:

- **Executable:** the feature has at least one Scenario, and every Scenario
  has a When step and a Then step.
- **Lean:** the feature names no file paths, SQL, frameworks, databases or
  storage mechanisms.

## 2. Judge the other three

Read the story's `.feature` file, `intent/constitution.md` and
`intent/decisions.md`.

- **Clear:** every sentence has one reading. Two people would build the same
  thing from it. Vague words ("fast", "easy", "some", "etc.") fail.
- **Accurate:** it agrees with the constitution (who it's for, the problem,
  the proof) and with every decision in `decisions.md`. Name the line it
  contradicts.
- **Responsible:** where the story touches personal data, money, safety,
  outreach to real people or accessibility, a scenario or the description
  covers it. A story that touches none of these passes and says so.

## 3. Report all five, in this order

One line per check, every time, even when it passes:

```
Clear: pass. <why>
Lean: pass. <why>
Executable: fail. <what's missing>. Fix: <the change to make>
Accurate: pass. <why>
Responsible: pass. <why>
```

Every fail names what's missing and the fix.

## 4. Stop on a fail

If any check fails, don't plan or build the story. Report the failures and
the fixes, and wait for the spec to change.
