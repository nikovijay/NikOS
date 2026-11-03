# change

Make a change to the repo and prove it works.

1. Restate the request in one sentence and name the story id it belongs to, or say it has none.
2. Read the story's `.feature` file and its latest plan in `intent/plans/`.
3. If the change alters behaviour, start a new plan version with `nikos plan new <story-id>` and write the approach in it.
4. Make the change.
5. Run the story's scenarios and the project's tests, and keep the output.
6. Append each decision you made to `intent/decisions.md`.
7. Set the story's status in `intent/state.yaml`, using `done` only if step 5 passed.
8. Report every step with its evidence or its skip reason.
