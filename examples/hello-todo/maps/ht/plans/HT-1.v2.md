---
story: HT-1
version: 2
created: 2026-11-03
supersedes: 1
summary: Store tasks in the browser so they survive a refresh, newest first.
---

## 1. Store tasks locally
**Why:** tasks shouldn't vanish when the page reloads.
**Criteria:** AC1, AC2
**Files:** src/store.ts

Wrap localStorage behind a small store with add and list.

## 2. Show the newest task first
**Why:** the task you just added is the one you're looking for.
**Criteria:** AC1
**Files:** src/list.ts
**Tests:** test/steps/tasks.steps.ts > Adding a task shows it at the top
