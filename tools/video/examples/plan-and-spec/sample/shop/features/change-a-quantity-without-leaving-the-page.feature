@WEB-CHK-2 @release-1 @should @activity-pay @step-review-the-basket
Feature: Change a quantity without leaving the page

  As a shopper
  I want to change how many I'm buying on the checkout page
  So that a small change doesn't send me back a step

  @AC1 @must
  Scenario: AC1 — The total updates in place
    Given a basket with 2 mugs at £9 and 1 plate at £12
    When I change the mugs to 3
    Then the total is £39 without leaving the page
