# build-a-story

Take a story from its feature file to passing scenarios. Done means the
scenarios pass, not that you say so.

1. Run `nikos next` to pick the story, or use the story id the person named.
2. Check the story with the clear skill, and stop if any of the five checks fails.
3. Run `nikos decisions interface`, then `nikos plan new <story-id>` and write the approach into the plan file it creates. Reuse every interface decision the story touches, and cite each in the step that uses it as `Reuses: <decision title> (intent/decisions.md:<lines>)`. If the story needs to change one, stop and ask.
4. Run `nikos state set <story-id> in_progress --by <agent>`, where `<agent>` names your tool (`claude-code`, `codex`, `cursor`), never a person, so `state.yaml` shows who is building it.
5. Implement the story, with a step definition for each step in its scenarios (see the verify skill).
6. Run `nikos verify <story-id>`, then `nikos verify` to check every other story still passes, and keep the output.
7. Record each decision you made with `nikos decide "<title>" --story <story-id> --why "<why>"`. Add `--category interface` for anything a later story must keep to: command syntax, output format, API shape.
8. Run `nikos state set <story-id> done`. If it refuses, fix the failing scenarios and go back to step 6.
9. Report every step with its evidence or its skip reason. Never run `nikos approve` or edit `intent/approvals.yaml`: approval is the person's sign-off.
