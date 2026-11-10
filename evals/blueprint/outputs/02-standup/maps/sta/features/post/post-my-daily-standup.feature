@STA-1 @release-1 @must @activity-post
Feature: Post my daily standup

  As a team member on a remote team
  I want to answer three standup questions once a day in writing: what I finished since the last standup, what I'm working on next, and what is in my way
  So that my team knows where I am without a call

  @AC1 @must
  Scenario: AC1 — My answers for today are saved when I post them
    Given I have not posted my standup today
    When I post my standup with the answers "Finished the login fix", "Working on the invoice export" and "Waiting on the design review"
    Then my standup for today shows those three answers

  @AC2 @must
  Scenario: AC2 — I cannot post a second standup on the same day
    Given I have posted my standup today
    When I try to post my standup again today
    Then I am told I have already posted my standup for today

  @AC3 @should
  Scenario: AC3 — A standup with a blank answer is not posted
    Given I have not posted my standup today
    When I post my standup with the answer "Finished the login fix" and a blank second answer
    Then my standup for today is not saved
    And I am told which answer is blank
