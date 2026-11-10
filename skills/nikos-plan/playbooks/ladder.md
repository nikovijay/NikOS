# ladder

Link what a key result or bet ladders up to, when the person has only text for it. A link is written only on their yes.

1. Run `nikos plan ladder` (or `--json` for data). It lists each key result and bet whose `ladders_up` text has no link yet: its id, kind, where it sits and its text. If none is listed, say so and stop.
2. For each item the person wants to link, run `nikos plan ladder <id>`. It lists the candidates it could link to, each with its kind, area and the words it shares with the text. Those are the only ids you may offer.
3. If it lists no candidates, nothing above shares a word with the text. Say so, and ask whether to keep the text or clear it. Clear it only on their yes, with `nikos plan ladder clear <id>`. No other command links an existing item, so never tell the person to add a link by hand.
4. Show the person the text and the candidates for each item, as a short list. Include keeping the text as it is. Ask one question at a time.
5. Run `nikos plan ladder accept <id> <candidate>` only after the person picks that candidate. This writes the link and clears the text. If they want no link, run `nikos plan ladder clear <id>` only when they say the text isn't wanted. If they say nothing yet, leave the item alone.
6. Never invent an id, and never offer or accept a candidate the list didn't show. Never accept a link the person didn't pick, even when one candidate looks obvious.
7. The ranking counts shared words only. It can be wrong, so say so when the top candidate looks unrelated to the text.
8. Run `nikos plan validate`, then `nikos plan status`. Show each step with its evidence or its skip reason. An item still in text is "not linked yet": it counts in no figure, progress or delivery, and must not be described as linked.
