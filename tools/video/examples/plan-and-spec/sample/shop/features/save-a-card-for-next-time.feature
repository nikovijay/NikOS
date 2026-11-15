@WEB-CHK-7 @release-2 @should @activity-pay @step-pay
Feature: Save a card for next time

  As a returning shopper
  I want to save my card when I pay
  So that I don't type it in again

  @AC1 @must
  Scenario: AC1 — A saved card is offered next time
    Given I saved my card on my last order
    When I open the checkout
    Then my saved card is offered first
