# bet

Frame one bet the person can judge later: what they believe, the key results
it should move, when it's reviewed, and which releases deliver it.

1. Ask what the person wants to move and why they think this work will move it. Read `intent/constitution.md` (Proof, Validation) and the related entries in `intent/decisions.md`.
2. Draft the bet with the person: a hypothesis ("We believe <change> will <effect> for <users> because <evidence>"), an owner, the team, its primary key result and any others it contributes to (or none, for maintenance or risk-reduction work), a review date, a deadline only if there's a hard one, confidence (low, medium, high) and dependencies with their owners.
3. Confirm the draft. Write nothing before the person's yes.
4. Run `nikos planning bet new <bet-id> --owner "<…>" --hypothesis "<…>" --review <yyyy-mm-dd> [--kr <kr-id>] [--also <ref>] [--team "<…>"] [--starts <date>] [--deadline <date>] [--confidence <level>] [--dependency "<…>"] --evidence "<what we saw, and where>"`.
5. Ask which release (or single story) delivers it, and add the bet to it in `intent/storymap.yaml`: `bets: [<bet-id>]` on the release, or `story_bets: { <story-id>: [<bet-id>] }` for one story. Add stories first with the core story conventions if they're missing, once the person agrees.
6. Run `nikos validate` and `nikos planning validate`, and fix every error.
7. Report every step with its evidence or its skip reason.
