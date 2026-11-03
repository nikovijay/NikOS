@NUD-2 @release-1 @must @activity-reminders
Feature: Draft a payment reminder for an overdue invoice

  As a solo freelancer with clients who are past their payment date
  I want the app to draft a payment reminder for each overdue invoice that names the invoice, its amount and its due date and asks for payment
  So that I can chase late payment without writing each message myself

  @AC1 @must
  Scenario: AC1 — An overdue invoice gets a drafted reminder waiting for my approval
    Given I have an unpaid invoice for "Acme Design" for 1200.00 due on 2026-11-01
    When today is 2026-11-03
    Then a reminder for "Acme Design" that names the 1200.00 invoice due on 2026-11-01 and asks for payment is waiting for my approval

  @AC2 @must
  Scenario: AC2 — Nothing is sent to the client until I approve the reminder
    Given a reminder for "Acme Design" is waiting for my approval
    When I have not approved the reminder
    Then no message has been sent to "Acme Design"

  @AC3 @must
  Scenario: AC3 — An approved reminder is sent to the client
    Given a reminder for "Acme Design" is waiting for my approval
    When I approve the reminder
    Then the reminder is sent to "Acme Design"

  @AC4 @should
  Scenario: AC4 — An invoice that is not yet due gets no reminder
    Given I have an unpaid invoice for "Beta Studio" for 800.00 due on 2026-11-30
    When today is 2026-11-03
    Then no reminder for "Beta Studio" is waiting for my approval
