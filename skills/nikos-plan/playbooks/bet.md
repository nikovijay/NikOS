# bet

Frame one bet the person can judge later: what they believe, the key results it
should move, when it's reviewed, and which releases deliver it.

1. Ask what the person wants to move and why they think this work will move it. Read the area's `decisions.md` and the company's `decisions.md` for related entries.
2. Draft the bet with the person: a hypothesis ("We believe <change> will <effect> for <users> because <evidence>"), an owner, the team, its primary key result and any others it contributes to (or none, for maintenance or risk-reduction work), a review date, a deadline only if there's a hard one, confidence (low, medium, high) and dependencies with their owners.
3. Confirm the draft. Write nothing before the person's yes.
4. Run `nikos plan bet new <bet-id> --in <area> --owner "<…>" --hypothesis "<…>" --review <yyyy-mm-dd> [--kr <kr-id>] [--also <kr-id>] [--aligns-to <bet-id>] [--team "<…>"] [--starts <date>] [--deadline <date>] [--confidence <level>] [--dependency "<…>"] --evidence "<what we saw, and where>"`. If the key result or bet it should ladder up to isn't known yet, use `--ladders-up "<text>"` instead of `--kr` or `--aligns-to`, never both. The ladder playbook links it later, once the person picks the item.
5. Ask which story map delivers it. In the code repo, a release in `maps/<key>/storymap.yaml` names the bet (`bets: [<bet-id>]`), or `story_bets: { <story-id>: [<bet-id>] }` for one story. The bet id is the bare id, the same in every repo. Add stories first with the core story conventions if they're missing, once the person agrees.
6. Run `nikos plan validate` in the planning repo, and `nikos validate` in the code repo. Fix every error.
7. Report every step with its evidence or its skip reason.
