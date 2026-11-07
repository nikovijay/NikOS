# nikOS 0.2: the film

The voiceover script, about two and a half minutes. It's revised from the original brief:

- The positioning lines no longer knock hosted workspaces.
- The goal runs through a department (Payments) to a team (Tip Calc) and the team's bet.
- Every screen comes from a real run with nikos 0.2.1, described below.

Connecting lines and labels are explanatory graphics. So are two stand-ins:

- The pull request card in section 2 stands in for your forge's page. Its diff is the real commit.
- The `plan.acme.com` address in section 7 stands in for wherever a company hosts its view. The view itself ran in `nikos planning serve`.

## 1. Your company. Your plan. Your repo.

Your company's goals live in a deck. Delivery lives in tickets. Agents work from whatever context they're given.

What if those things were connected?

Meet nikOS. Your company plan lives in a repository, right beside the work that delivers it.

## 2. Start with the outcome

Start with your objectives and key results. What are we trying to achieve? Who owns it? How will we measure progress?

Ask your agent to add one, and it arrives as a pull request: reviewed and merged, like any other change.

Then connect the departments and teams contributing to that outcome.

## 3. Follow the goal into the work

For the Payments department, that means getting more groups paying together. It sets its own key result, aligned to the company's.

The Tip Calc team connects its measure: bills split per week. Then it places a bet: what it believes will move that number, and when it will review it.

Map the stories that deliver the bet. Now everyone can see why the work matters.

## 4. Turn intent into something buildable

Before your agents build, define the intent.

Who is this for? What should happen? What does success look like?

Turn those answers into concrete examples and executable specifications. A shared agreement, not a vague handover.

## 5. Give "done" some evidence

Agents build from the specification. Tests check the behaviour.

Pending tests? Not done.

Human approval stays separate. Change the specification, and the old approval no longer holds.

## 6. Keep the connection as teams move

Teams keep their stories and specifications in their own repositories, connected to their department and the company plan.

Work in parallel. Review each bet's delivery alongside goal progress. See when plans need syncing.

## 7. Start with what you already have

nikOS is open source, and it runs in the repositories you already use. Start with one team, with nothing new to buy.

Then shape the tool itself to fit how your company works. Your own views of the plan, at your own address.

## 8. Close the distance

From company direction to department goals and team bets. From intent to specifications your agents can build from.

Your plans. Your repositories. Your way of working.

Start with nikOS.

**End card:** nikOS · Company direction. Agent-ready work. · `npx nikos` · github.com/nikovijay/NikOS

## The run behind the screens

Everything ran with `npx nikos@0.2.1`. Local bare repos stood in for GitHub. The repos are:

- **acme/company-plan**:
  - `nikos company init --name Acme --period "Q1 2027" --departments "Payments, Growth"`.
  - Key result `kr-1`, *Grow revenue*: owned by the Board, baseline 1, target 2, by 2027-03-31, checked in at 1.2.
  - For section 2, a clone with `kr-1` removed showed it being added: `git switch -c add-kr-1`, `nikos planning kr new kr-1 --title "Grow revenue" --owner Board --baseline 1 --target 2 --by 2027-03-31`, `nikos planning validate`, then commit and push.
  - The custom view `planning/views/acme-q1.html`, built on the view contract: the company key result and the plans below it, read from the last rollout. Its source is in `views/acme-q1.html`, next to this script.
- **acme/payments-plan**, the department:
  - `planning/plan.yaml` at `level: department`, then `nikos join acme/company-plan`.
  - Key result `pay-1`, *Group payments per week*, with `--aligns-to acme/company-plan#kr-1`.
  - It lists the Tip Calc team in `planning/downstream.yaml`.
- **acme/tip-calc**, the team:
  - `nikos start`, then `nikos join acme/payments-plan`, which syncs the company plan above it too.
  - Key result `tips-1`, *Bills split per week*, aligned to `acme/payments-plan#pay-1`.
  - Bet `group-split` (`nikos planning bet new`), named by release 1 in the story map (`bets: [group-split]`).

In the team repo, the Split the bill story ran like this:

1. TC-2 was written as the spec below. `nikos clear TC-2` reported Lean ✓ and Executable ✓.
2. `state set TC-2 done` was refused while its steps were pending.
3. After `src/split.mjs` and real steps were written, the same command moved it to done.
4. `nikos approve TC-2 --via chat` recorded the approval.
5. A changed line then made `nikos validate` report that the approval no longer holds. The change was reverted afterwards.

Then the parallel work and the sync:

1. `nikos migrate per-story` gave one state file per story.
2. Branch a moved TC-1 and branch b moved TC-3, and both merged with no conflicts.
3. A company check-in (`kr-1` to 1.3) left Payments behind in `nikos planning rollout` until it ran `nikos planning sync`.

The dashboards are `nikos planning serve` at each level, captured at 2×. The story map is `nikos map`.

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
