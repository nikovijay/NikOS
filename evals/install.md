# Install smoke tests

Each documented install is checked against the manifests in this repo. The
skills live in `skills/` and the plugin points every tool at that folder.
`nikos-mode` was renamed to `nikos-spec` in 0.5.0. The planning skill ships
in the same plugin as `nikos-plan`.

| Tool | Version | Install run | Skills the manifest ships | Date |
| --- | --- | --- | --- | --- |
| Claude Code | not re-run on this pass | `claude plugin marketplace add nikovijay/NikOS` then `claude plugin install nikos@nikos` | The plugin's `skills/` folder: clear, clear-review, decisions, intent, nikos-plan, nikos-spec, verify | 2026-11-18 |
| Codex | not installed here | not run | same `skills/` folder, from `.codex-plugin/plugin.json` | 2026-11-18 |
| Cursor | not installed here | not run | same `skills/` folder, from `.cursor-plugin/plugin.json` | 2026-11-18 |

`claude plugin validate ./ --strict` was last recorded as passing on 4 Nov 2026.
The icon is Niko's logo, black on white, at `assets/icon.png` (1024 px square;
source `assets/icon.svg`).

Codex and Cursor manifests are checked against their documented formats
(docs/install.md) by `test/install.test.ts`. No install was re-run for this
update, because neither tool is assumed to be on the machine that edits the
doc. To record one: install on a clean profile with the command in
docs/install.md, ask the agent to use `nikos-spec` (a code repo) or
`nikos-plan` (a planning repo), and add a row.
