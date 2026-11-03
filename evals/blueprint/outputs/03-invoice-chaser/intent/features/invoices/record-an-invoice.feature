@NUD-1 @release-1 @must @activity-invoices
Feature: Record an invoice

  As a solo freelancer
  I want to record an invoice with its client, amount and due date
  So that the app knows what I am owed and when it is due

  @AC1 @must
  Scenario: AC1 — A recorded invoice appears in my invoice list
    Given my invoice list is empty
    When I record an invoice for the client "Acme Design", amount 1200.00 in the currency I bill in, due on 2026-11-30
    Then I see the invoice for "Acme Design" for 1200.00 due on 2026-11-30 in my invoice list

  @AC2 @must
  Scenario: AC2 — An invoice without a client is not recorded
    Given my invoice list is empty
    When I record an invoice with no client, amount 1200.00 and due on 2026-11-30
    Then my invoice list is still empty
    And I am told the client is required

  @AC3 @must
  Scenario: AC3 — An invoice without a due date is not recorded
    Given my invoice list is empty
    When I record an invoice for the client "Acme Design" for 1200.00 with no due date
    Then my invoice list is still empty
    And I am told the due date is required

  @AC4 @must
  Scenario: AC4 — My invoices are visible only to me
    Given I have recorded an invoice for the client "Acme Design"
    When another person opens the app
    Then that person sees no invoices and no client names
