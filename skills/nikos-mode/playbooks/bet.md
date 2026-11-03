# bet

Frame work as a time-boxed bet you can judge: what you believe, how you'll
measure it, how much you expect it to move, by when, and which stories
deliver it. The person decides the bet and calls the outcome.

1. Ask what the person wants to move and why they think this work will move it, and read Proof, Founding hypothesis and Validation in `intent/constitution.md` and the related entries in `intent/decisions.md`.
2. Frame the bet with the person and confirm it: a hypothesis ("We believe <change> will <effect> for <users> because <evidence>"), a key result (one measure with a number), the expected uplift (from what to what), a time box end date, and any known blockers.
3. Pick the stories that deliver it from `intent/storymap.yaml`; if one is missing, propose it and add it only once the person agrees, following the story conventions in the idea-to-blueprint playbook.
4. Run `nikos bet new <bet-id> --hypothesis "<…>" --kr "<…>" --uplift "<…>" --time-box <yyyy-mm-dd> --story <id>` (one `--story` per story, one `--blocker` per blocker).
5. Fill in the card's `## Why we think so` with the evidence from step 1, quoting where it came from.
6. Run `nikos validate` and fix every error.
7. When the time box ends, or the person asks to close the bet: measure the key result, write it under `## Outcome`, propose won, lost or killed, set `status` once the person agrees, and record it with `nikos decide "<title>" --why "<why>" --category product`.
8. Report every step with its evidence or its skip reason.
