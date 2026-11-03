@HT-3 @release-2 @should @activity-tasks @effort-S
Feature: Reorder tasks

  As a busy person
  I want to drag a task up or down
  So that I can change what matters today

  @AC1 @must
  Scenario: AC1 — Moving a task changes its rank
    Given I have the tasks "A", "B" and "C" in that order
    When I move "C" to the top
    Then my tasks are in the order "C", "A", "B"
