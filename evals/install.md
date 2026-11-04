# Install smoke tests

Each documented install, run on a clean profile, then checked for the
`nikos-mode` skill.

| Tool | Version | Install run | nikos-mode available | Date |
| --- | --- | --- | --- | --- |
| Claude Code | 2.1.318 | `claude plugin marketplace add <repo>` then `claude plugin install nikos@nikos`, in a fresh `CLAUDE_CONFIG_DIR` | Yes: `claude plugin details nikos@nikos` lists 6 skills: clear, clear-review, decisions, intent, nikos-mode, verify | 2026-11-04 |
| Codex | not installed here | not run | not checked | 2026-11-04 |
| Cursor | not installed here | not run | not checked | 2026-11-04 |

`claude plugin validate ./ --strict` passes with nothing to report. The icon
is Niko's logo, black on white, at `assets/icon.png` (1024 px square; source
`assets/icon.svg`).

Codex and Cursor manifests are checked against their documented formats
(docs/install.md) by `test/install.test.ts`, but no install was run, because
neither tool is on this machine. To record one: install on a clean profile
with the command in docs/install.md, ask the agent to "use nikos-mode", and
add a row.
