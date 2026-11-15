@WEB-CHK-6 @release-1 @must @activity-pay @step-pay
Feature: Show a clear error when a card is declined

  As a shopper
  I want to know straight away when my card is declined
  So that I can try another card without starting again

  @AC1 @must
  Scenario: AC1 — A declined card says what to do
    Given a basket with 2 mugs at £9 and 1 plate at £12
    When I pay with a card that is declined
    Then I see "Your card was declined. Try another card."
    And my basket is still there
