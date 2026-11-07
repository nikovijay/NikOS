# nikOS 0.2: the two-minute film

Voiceover script, revised from the original brief:

- The positioning lines no longer knock hosted workspaces.
- The example team is the Tip Calc team, as in the real screenshots.
- Section 4 shows a real "Split the bill" spec written and checked with nikos 0.2.1.

Every screen is a real capture from the 0.2.1 QA run or from the spec run below. Connecting lines and labels are explanatory graphics.

## 1. Your company. Your plan. Your repo.

Your company's goals live in a deck. Delivery lives in tickets. Agents work from whatever context they're given.

What if those things were connected?

Meet nikOS. Your company plan lives in a repository, right beside the work that delivers it.

## 2. Start with the outcome

Start with your objectives and key results. What are we trying to achieve? Who owns it? How will we measure progress?

Then connect the groups and teams contributing to that outcome.

## 3. Follow the goal into the work

For the Tip Calc team, that means helping people split bills.

Connect the team's measure to the company result. Then map the stories that could move it forward.

Now everyone can see why the work matters.

## 4. Turn intent into something buildable

Before your agents build, define the intent.

Who is this for? What should happen? What does success look like?

Turn those answers into concrete examples and executable specifications. A shared agreement, not a vague handover.

## 5. Give "done" some evidence

Agents build from the specification. Tests check the behaviour.

Pending tests? Not done.

Human approval stays separate. Change the specification, and the old approval no longer holds.

## 6. Keep the connection as teams move

Teams keep their stories and specifications in their own repositories, connected to the company plan.

Work in parallel. Review delivery alongside goal progress. See when plans need syncing.

## 7. Start with what you already have

nikOS is open source, and it runs in the repositories you already use. Start with one team, with nothing new to buy.

Then shape the tool itself to fit how your company works.

## 8. Close the distance

From company direction to team intent. From intent to specifications your agents can build from.

Your plans. Your repositories. Your way of working.

Start with nikOS.

**End card:** nikOS · Company direction. Agent-ready work. · `npx nikos` · github.com/nikovijay/NikOS

## The real spec (section 4)

Written in a fresh repo with `npx nikos@0.2.1 start` and `story add "Split the bill"`, then checked with `nikos clear TC-2` (Lean ✓, Executable ✓, 2 scenarios) and `nikos validate` (✓ 2 stories, 1 release).

```gherkin
@TC-2 @release-1 @must @activity-getting-started
Feature: Split the bill

  As a group paying one bill together
  I want to split the total evenly, tip included
  So that everyone pays their fair share

  @AC1 @must
  Scenario: AC1 — An even split, tip included
    Given a bill of $90.00 with a 20% tip
    When we split it between 4 people
    Then each person pays $27.00

  @AC2 @must
  Scenario: AC2 — Rounding never loses a cent
    Given a bill of $100.00 with no tip
    When we split it between 3 people
    Then two people pay $33.33 and one pays $33.34
```
