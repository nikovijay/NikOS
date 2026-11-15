@WEB-CHK-4 @release-1 @should @activity-pay @step-enter-delivery
Feature: Pick a delivery slot

  As a shopper
  I want to pick when my order arrives
  So that I'm in when it comes

  @AC1 @must
  Scenario: AC1 — The next slots are offered
    When I choose delivery
    Then I see 2 slots to pick from
