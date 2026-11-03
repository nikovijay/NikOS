@STA-2 @release-1 @must @activity-review
Feature: See the team's standups on one page

  As a team lead
  I want to see every team member's standup answers for the day on one page
  So that I know what the team is doing without a call

  @AC1 @must
  Scenario: AC1 — The lead sees every posted standup for the day on one page
    Given I have posted my standup today
    And "Ana" and "Ben" have posted their standups today
    When I open today's standups page
    Then I see the answers of "Ana" and "Ben" on that page

  @AC2 @should
  Scenario: AC2 — The lead sees who has not posted yet
    Given I have posted my standup today
    And "Ana" has posted her standup today but "Ben" has not
    When I open today's standups page
    Then I see that "Ben" has not posted yet
