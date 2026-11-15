@WEB-CHK-1 @release-1 @must @activity-pay @step-review-the-basket
Feature: See the whole basket on one page

  As a shopper
  I want to see everything I'm buying on the checkout page
  So that I don't have to go back to the basket to check

  @AC1 @must
  Scenario: AC1 — Every line and the total are on the page
    Given a basket with 2 mugs at £9 and 1 plate at £12
    When I open the checkout
    Then I see 2 lines and a total of £30
