@HT-2 @release-1 @must @activity-tasks @step-focus @effort-M
Feature: See today's top three

  As a busy person
  I want to see only my three most important tasks
  So that the important one never gets lost

  @AC1 @must
  Scenario: AC1 — Only three tasks are shown
    Given I have 5 tasks ranked by importance
    When I open today's view
    Then I see exactly the 3 most important tasks
