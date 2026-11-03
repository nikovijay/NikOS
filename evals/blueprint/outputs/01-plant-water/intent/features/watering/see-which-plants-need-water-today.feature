@THI-2 @release-1 @must @activity-watering
Feature: See which plants need water today

  As a houseplant owner who often forgets when each plant was watered
  I want to see the plants that need water today
  So that I water the right plants and don't drown or dry them out

  @AC1 @must
  Scenario: AC1 — A plant that is due today or overdue is listed
    Given I have the plant "Monstera" with a watering interval of 7 days, last watered 7 days ago
    When I open my list of plants that need water today
    Then I see "Monstera" in that list

  @AC2 @must
  Scenario: AC2 — A plant that is not yet due is not listed
    Given I have the plant "Fern" with a watering interval of 7 days, last watered 2 days ago
    When I open my list of plants that need water today
    Then I do not see "Fern" in that list

  @AC3 @should
  Scenario: AC3 — A plant that has never been watered is listed
    Given I have the plant "Cactus" with a watering interval of 14 days that has never been watered
    When I open my list of plants that need water today
    Then I see "Cactus" in that list

  @AC4 @must
  Scenario: AC4 — A plant that is overdue is listed
    Given I have the plant "Ivy" with a watering interval of 7 days, last watered 10 days ago
    When I open my list of plants that need water today
    Then I see "Ivy" in that list
