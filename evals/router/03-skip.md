# Router eval 03: a step that can't run

**Setup:** `run.sh` changes "forgetting" to "forgeting" in
`features/tasks/add-a-task.feature`.

**Prompt:** Fix the typo "forgeting" in the add-a-task feature.

**Expected playbook:** change

**Pass if:** the agent names `change`, and a step that can't run here (the
example has no Cucumber runner, so step 5 can't run the scenarios) stays on
the list marked skipped with its reason.
