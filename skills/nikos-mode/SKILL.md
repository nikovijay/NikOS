---
name: nikos-mode
description: Entry point for nikOS spec-driven work. Use at the start of any request in a repo with an intent/ folder, or when asked to plan, build, change, check or explain a story. Picks the matching playbook and runs every step of it.
---

# nikos-mode

You follow a named playbook for every request instead of improvising. Run
these five steps in order, every time.

The playbooks run the `nikos` command. When it isn't installed (`nikos
--version` fails), run it as `npx -y nikos` instead: `npx -y nikos validate`
for `nikos validate`, and so on.

## 1. Read the principles

Read `principles/index.md` next to this file. Keep each principle in mind for
the rest of the request. When one applies, say which.

## 2. Pick a playbook and say which

Read `playbooks/index.md`. Match the request against the "Use when" column and
pick exactly one playbook. Then tell the person, before doing anything else:

> Playbook: **<name>** (`playbooks/<file>`), because <one-line reason>.

If two rows match, pick the first and say which other one you passed over. If
nothing matches, say "No playbook matches", then use `change` when the request
edits files in the repo and `answer` when it doesn't.

## 3. Copy every step into the task list

Open the chosen playbook file. Copy each numbered step into your task list,
word for word and in order, one item per step.

- If your tool has a built-in task or todo list, use it.
- If it has none, write the list in your reply as a Markdown checklist
  (`- [ ] 1. …`) and repeat it, updated, whenever a step changes state.

Don't merge, reword, reorder or summarise steps. Don't add steps of your own
to the playbook's list; put extra work under the step it belongs to.

## 4. Never drop a step

Every step ends as done or skipped. A step you don't do stays on the list,
marked skipped, with the reason:

> ~~5. Run the story's scenarios~~ skipped: the repo has no Cucumber runner yet.

"Not needed" is not a reason. Say what makes it not needed.

## 5. Show evidence before you say done

Finish with a report that lists every step with its outcome:

- **done**, with the evidence: the command you ran and its result, the file
  and line you changed, or the passage you quoted.
- **skipped**, with the reason from step 4.

Never call the request done, fixed or passing without that evidence. If a
check fails, say so and show the output.
