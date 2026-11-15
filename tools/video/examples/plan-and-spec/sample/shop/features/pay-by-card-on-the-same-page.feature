@WEB-CHK-5 @release-1 @must @activity-pay @step-pay
Feature: Pay by card on the same page

  As a shopper
  I want to pay without going to another page
  So that buying takes one step, not four

  @AC1 @must
  Scenario: AC1 — Paying charges the basket and delivery
    Given a basket with 2 mugs at £9 and 1 plate at £12
    When I pay by card
    Then I am charged £34, with delivery
    And I see an order number
