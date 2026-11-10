@STA-3 @release-1 @must @activity-review
Feature: Hide teammates' answers until I have posted mine

  As a team member
  I want to see my teammates' standup answers only after I have posted my own
  So that my answers are not shaped by theirs

  @AC1 @must
  Scenario: AC1 — Teammates' answers stay hidden until I have posted
    Given "Ben" has posted his standup today
    And I have not posted my standup today
    When I open today's standups page
    Then I do not see the answers of "Ben"

  @AC2 @must
  Scenario: AC2 — Teammates' answers are shown once I have posted
    Given "Ben" has posted his standup today
    When I post my standup for today
    And I open today's standups page
    Then I see the answers of "Ben"
