@HT-1 @release-1 @must @activity-tasks @effort-S
Feature: Add a task

  As a busy person
  I want to add a task in one step
  So that capturing it is faster than forgetting it

  @AC1 @must
  Scenario: AC1 — Adding a task shows it at the top
    Given my list is empty
    When I add the task "Call the bank"
    Then I see "Call the bank" at the top of my list

  @AC2 @should
  Scenario: AC2 — Blank tasks are ignored
    Given my list is empty
    When I add the task ""
    Then my list is still empty
