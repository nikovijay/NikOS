# Planning pack

Objectives, key results and bets in your repo, linked to the nikOS story map
that delivers them. Your agent plans with you, checks in on key results, and
runs a local dashboard where you can see and edit the plan.

- **Bets live in `planning/bets/`.** Each has an owner, a hypothesis, the key
  results it should move, a review date and every review decision since.
- **The story map says which bets it delivers.** A release in
  `maps/<key>/storymap.yaml` carries `bets: [<bet-id>]`; in a group repo, each map
  under `maps/<id>/` names its one bet in `bet:`. A bet's delivery status comes
  from those stories, and is never confused with its outcome.
- **Key results keep their history.** Check-ins are dated and only ever
  added; a revised target keeps the original.
- **Plans above yours stay where they are.** List them in
  `planning/upstream.yaml`; `nikos planning sync` reads them into a
  gitignored folder and this repo stores only references.
- **A local dashboard.** `nikos planning serve` shows key results, check-in
  charts, bets and a timeline on 127.0.0.1, with safe edits.

## Install

Claude Code, in a session:

```
/plugin marketplace add nikovijay/NikOS
/plugin install nikos-planning@nikos
```

Codex and Cursor: add `nikovijay/NikOS` as a marketplace (see
[docs/install.md](../../docs/install.md)) and install `nikos-planning` from it.

The commands come with the `nikos` command-line tool (`npx -y nikos planning help`).

## Use it

Ask your agent:

> Plan our Q1 bets for the reminders team.

> Check in on my KRs.

> Review the reminders-that-stick bet.

> Open the planning dashboard.

## Commands

| Command | What it does |
| --- | --- |
| `nikos planning bet new <id>` | Write a bet card |
| `nikos planning bet review <id> <decision>` | Record continue, change, stop or complete, with the reason |
| `nikos planning kr new <id>` | Write a key result |
| `nikos planning checkin <kr> <value>` | Add a dated check-in |
| `nikos planning kr target <id> <n>` | Revise a target, keeping the original |
| `nikos planning status` | Every bet's delivery and outcome, every key result's latest value |
| `nikos planning validate` | Check `planning/` |
| `nikos planning sync [--check]` | Fetch upstream plans read-only, or check whether they've moved |
| `nikos planning serve [--export <file>]` | Open the local dashboard, or write a read-only snapshot |
| `nikos planning serve --export <file> --editable [--with-linked]` | Write a snapshot that queues changes and downloads them as a change file |
| `nikos apply <file> [--commit] [--pr]` | Apply a change file on a new nikos branch, with the same checks |

The file format: [docs/planning.md](../../docs/planning.md).
