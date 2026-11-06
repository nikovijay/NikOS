# idea-to-blueprint

Turn a one-line idea into a spec that's ready to build: a constitution, a
story map and a feature file per story, all passing CLEAR. The person
decides; you ask, propose and write it down.

1. Capture the idea in one sentence, ask for the product's name, and confirm both with the person.
2. If the repo has no `intent/` folder, run `nikos init --name "<product name>"`, then put the one-sentence idea in the `idea:` line at the top of `intent/constitution.md`.
3. Ask the five vision questions one at a time (Users, Problem, Switch, First, Proof), wait for each answer, and write it into its section of `intent/constitution.md`. If an answer contradicts the idea or an earlier answer, point it out and ask which one wins.
4. Write a `## Jobs to be done` section ("When …, I want to …, so I can …") and a `## Founding hypothesis` section ("We believe <users> will <behaviour> because <reason>. We'll know we're right when <the Proof measure>."), then confirm both with the person.
5. Propose activities, the steps a person takes in each, and releases with a one-line goal, with the First answer as release 1. Once the person agrees, write them into `intent/storymap.yaml` (`nikos step add` and `nikos release add` do this without hand-editing).
6. Write each story as `intent/features/<activity>/<story-slug>.feature`: tag it with its id, release and priority, put "As a … / I want … / So that …" under `Feature:`, and make each acceptance criterion a Scenario tagged and titled with its label (`@AC1`). Add each story to `intent/state.yaml` as `todo`, and remove the example story and its `getting-started` activity that `nikos init` created.
7. Check every story with the clear skill. For each failed check, propose the fix to the person and change the spec only once they agree.
8. Record every choice you made on the person's behalf (anything their answers didn't settle) with `nikos decide "<title>" --why "<why>" --category product`.
9. Run `nikos validate` and fix every error.
10. Report every step with its evidence or its skip reason.
