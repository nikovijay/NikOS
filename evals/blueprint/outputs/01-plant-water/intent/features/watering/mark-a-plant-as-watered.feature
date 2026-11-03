@THI-3 @release-1 @must @activity-watering
Feature: Mark a plant as watered

  As a houseplant owner
  I want to mark a plant as watered
  So that the app knows when it is next due

  @AC1 @must
  Scenario: AC1 — A watered plant leaves today's list
    Given I see "Monstera" in the list of plants that need water today
    When I mark "Monstera" as watered
    Then I do not see "Monstera" in the list of plants that need water today

  @AC2 @must
  Scenario: AC2 — A watered plant is next due after its watering interval
    Given I have the plant "Monstera" with a watering interval of 7 days
    When I mark "Monstera" as watered today
    Then the next watering day for "Monstera" is 7 days from today
