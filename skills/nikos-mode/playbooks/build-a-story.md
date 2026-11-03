# build-a-story

Take a story from its feature file to passing scenarios. Done means the
scenarios pass, not that you say so.

1. Run `nikos next` to pick the story, or use the story id the person named.
2. Check the story with the clear skill, and stop if any of the five checks fails.
3. Run `nikos plan new <story-id>` and write the approach in the new plan.
4. Run `nikos state set <story-id> in_progress`.
5. Implement the story, with a step definition for each step in its scenarios (see the verify skill).
6. Run `nikos verify <story-id>` and keep the output.
7. Record each decision you made with `nikos decide "<title>" --story <story-id> --why "<why>"`.
8. Run `nikos state set <story-id> done`. If it refuses, fix the failing scenarios and go back to step 6.
9. Report every step with its evidence or its skip reason.
