@WEB-CHK-3 @release-1 @must @activity-pay @step-enter-delivery
Feature: Enter a delivery address with lookup

  As a shopper
  I want to find my address from my postcode
  So that I don't type it all out

  @AC1 @must
  Scenario: AC1 — A postcode finds its addresses
    When I enter the postcode "N1 9GU"
    Then I can pick from 2 addresses
