@NUD-3 @release-1 @must @activity-reminders
Feature: Mark an invoice as paid

  As a solo freelancer
  I want to mark an invoice as paid
  So that I stop being reminded about it and can see what I have been paid

  @AC1 @must
  Scenario: AC1 — A paid invoice stops being overdue
    Given the invoice for "Acme Design" for 1200.00 due on 2026-11-01 is overdue
    When I mark the invoice for "Acme Design" as paid
    Then the invoice for "Acme Design" is no longer overdue

  @AC2 @must
  Scenario: AC2 — No reminder is drafted for a paid invoice
    Given the invoice for "Acme Design" for 1200.00 due on 2026-11-01 is marked as paid
    When today is 2026-11-03
    Then no reminder for "Acme Design" is waiting for my approval
