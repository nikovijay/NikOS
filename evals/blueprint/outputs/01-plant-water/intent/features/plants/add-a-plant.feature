@THI-1 @release-1 @must @activity-plants
Feature: Add a plant

  As a houseplant owner
  I want to add a plant with how often it needs water
  So that the app knows when each plant is due

  @AC1 @must
  Scenario: AC1 — A plant with a watering interval appears in my plant list
    Given my plant list is empty
    When I add the plant "Monstera" with a watering interval of 7 days
    Then I see "Monstera" in my plant list with a watering interval of 7 days

  @AC2 @should
  Scenario: AC2 — A plant without a name is not added
    Given my plant list is empty
    When I add a plant with no name and a watering interval of 7 days
    Then my plant list is still empty
