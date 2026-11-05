# review

Review a bet on its date and record the decision with its reason.

1. Run `nikos planning status` and read the bet's card in `planning/bets/<bet-id>.md`: hypothesis, key results, earlier reviews, delivery and outcome.
2. Show the evidence: the latest check-ins of its key results against their baseline and target, and its delivery status. Say plainly if it has shipped but the evidence isn't in yet.
3. Ask the person to decide: continue, change, stop or complete, and why. Propose one with your reasoning; the person decides.
4. For complete, the outcome comes from the key result evidence: ask whether it's won or lost. For change, update the card's fields (review date, key results, confidence) after the review is recorded, with the person's yes.
5. Run `nikos planning bet review <bet-id> <decision> --why "<reason>" [--outcome won|lost]`. Earlier reviews stay as they are; stop sets the outcome to stopped.
6. Record it in the decision log too: `nikos decide "<bet-id>: <decision>" --why "<reason>" --category product`.
7. Report every step with its evidence or its skip reason.
