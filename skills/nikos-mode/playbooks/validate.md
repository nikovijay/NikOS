# validate

Test an idea with real people before building it: agree who to reach and
what counts as proof, draft the outreach, and write what comes back into the
constitution. You draft; the person signs off and sends. You never send,
post, email, message or schedule anything to anyone outside the repo, even
when a tool could.

1. Read `intent/constitution.md` (Users, Problem, Switch, Proof and, if present, Founding hypothesis); if there's no constitution yet, say so and run the idea-to-blueprint playbook first.
2. Agree with the person who to reach (which people, where to find them, how many) and the signal that counts as proof (a number with a threshold, drawn from the Proof answer; if it can only stand in for Proof, such as stated intent before there's a product, say so), and write both down before drafting anything.
3. Draft the outreach in `intent/outreach/<yyyy-mm-dd>-<channel>.md`: one message per channel in the person's voice, the questions to ask, and, if it would help, a short demo or reel script. Mark the top of each file `Status: draft, not sent`.
4. STOP. Show every draft with where it would go, add "Needs your sign-off: <file>" to the task list for each one, and wait for an explicit yes per draft. Change a draft only as the person asks. Silence, "looks fine" about something else, or a yes to a different draft is not sign-off.
5. Once the person has signed off a draft, change its status to `Status: signed off <date>, for the person to send` and hand it over; the person sends it. Ask them to paste or summarise replies as they come in.
6. Record the results under a `## Validation` section at the end of `intent/constitution.md`: for each round, the date, channel, how many were reached, how many replied, the signal against its threshold (met or not), and two or three replies in their words.
7. Compare the results with Proof and the Founding hypothesis. Propose any change to them and make it only once the person agrees, then record it with `nikos decide "<title>" --why "<why>" --category product`.
8. Run `nikos validate` and fix every error.
9. Report every step with its evidence or its skip reason.
