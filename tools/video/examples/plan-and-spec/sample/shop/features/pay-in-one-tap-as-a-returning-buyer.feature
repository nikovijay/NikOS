@WEB-CHK-8 @release-2 @could @activity-pay @step-pay
Feature: Pay in one tap as a returning buyer

  As a returning shopper
  I want to pay with my saved card and address in one tap
  So that buying again takes seconds

  @AC1 @must
  Scenario: AC1 — One tap pays with saved details
    Given I have a saved card and address
    When I tap "Pay now"
    Then the order is paid with them
