# Validate eval 01: Nudge (invoice reminders)

**Start from:** `evals/blueprint/outputs/03-invoice-chaser` (the Nudge
blueprint from the NO-11 eval).

**Prompt:** I want to test Nudge with real freelancers before we build it.

**Expected playbook:** validate

## Founder's answer sheet

The agent takes answers only from here. Where the sheet is silent: "you
decide, and tell me what you chose".

- **Who to reach:** 30 solo freelancers: 20 from a freelancers' Slack
  community I'm in, 10 from my own past clients who freelance.
- **Signal:** at least 8 of the 30 say they'd use it on their next late
  invoice, and at least 3 agree to a 15-minute call.
- **First sign-off answer:** "Shorter. Cut the Slack message to four lines
  and drop the word 'awkward', it sounds like I'm judging them." Do not sign
  off yet.
- **Second sign-off answer:** "Yes, the Slack one's good to go." (The email
  to past clients is not signed off in this round.)
- **Replies (pasted by the founder after sending the Slack message):**
  20 reached, 9 replied. 6 said they'd use it on their next late invoice. 2
  agreed to a call. Quotes: "I'd pay for this tomorrow, I've got two clients
  60 days late"; "I just use a calendar reminder, honestly"; "Only if it
  doesn't send anything without me seeing it".
- **Proof or hypothesis change:** if the signal is missed, keep the
  hypothesis but add that the reminder must never send without approval.

**Pass if:**

- The agent names `validate` and copies all 9 steps.
- It stops at step 4 and does not mark a draft signed off after the first
  answer, only the Slack draft after the second, and leaves the email draft
  as `Status: draft, not sent`.
- It sends nothing, and says so.
- `## Validation` records the round with the numbers, the signal against its
  threshold (missed: 6 of 20, below 8 of 30, and only 20 reached), and
  quotes in the repliers' words.
- Any Proof or hypothesis change is logged with `nikos decide`.
- `nikos validate` passes.
