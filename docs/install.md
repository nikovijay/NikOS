# Installing nikOS in your agent tool

nikOS is one set of skills in `skills/`. Each tool reads its own small
manifest, and every manifest points at that same folder, so no skill file is
copied per tool.

| Tool | Manifest | Install |
| --- | --- | --- |
| Claude Code | `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | `/plugin install nikos --marketplace nikovijay/NikOS` |
| Codex | `.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json` | `codex plugin marketplace add nikovijay/NikOS` |
| Cursor | `.cursor-plugin/plugin.json` | Add the repo as a marketplace (below) |

After installing, ask the agent to plan, build or check a story. The
`nikos-mode` skill picks the playbook.

## Claude Code

In a session:

```
/plugin install nikos --marketplace nikovijay/NikOS
```

That works in one step on Claude Code 2.1.275 or later. On older versions,
add the marketplace first, then install:

```
/plugin marketplace add nikovijay/NikOS
/plugin install nikos@nikos
```

From a terminal, the same commands are `claude plugin marketplace add
nikovijay/NikOS` and `claude plugin install nikos@nikos`.

## Codex

```
codex plugin marketplace add nikovijay/NikOS
```

Then install nikOS from the Plugins directory. Update it later with `codex
plugin marketplace upgrade`.

## Cursor

Cursor installs plugins from a marketplace in its settings rather than a
command. Add `https://github.com/nikovijay/NikOS` as a marketplace (Plugins,
then Add Marketplace, then Import from Repo), and install nikOS from it.

To try it without a marketplace, copy the repo to
`~/.cursor/plugins/local/nikos` and run "Developer: Reload Window".

## Packs

Packs are extra tools that install on their own, next to nikOS or without it.
Each lives in `tools/<pack>/` with its own manifests and skills, and both
marketplaces list it.

| Pack | Folder | Claude Code |
| --- | --- | --- |
| Video | `tools/video/` | `/plugin install nikos-video@nikos` |

In Codex and Cursor, install the pack from the same marketplace as nikOS.
nikOS's router hands requests to an installed pack's skill, and gives the
install command when the pack is missing.

## The command-line tool

The skills run the `nikos` command. When it isn't installed, they run it
through `npx -y nikos`, so nothing has to be installed globally. To install
it anyway: `npm install -g nikos`.

## Formats checked

Plugin formats change often. These were read on 2026-11-04, and the display
name fields again on 2026-11-05 (no page showed a version):

- Claude Code: https://code.claude.com/docs/en/plugins-reference and
  https://code.claude.com/docs/en/plugins/marketplace-reference. Checked with
  `claude plugin validate .` on Claude Code 2.1.318. `displayName` is the
  name shown in the UI. A marketplace entry's `displayName` wins over the
  plugin's. The marketplace `name` stays the install id (`nikos@nikos`).
- Cursor: https://cursor.com/docs/reference/plugins. That page does not list
  `displayName`. `.cursor-plugin/plugin.json` still sets it so a listing can
  show nikOS, and `name` stays the kebab-case id.
- Codex: https://developers.openai.com/plugins/build/plugins. The plugin
  title is `interface.displayName` in `.codex-plugin/plugin.json`. The
  marketplace title is the same field on `.agents/plugins/marketplace.json`.

All three find skills as `skills/<name>/SKILL.md` at the plugin root.
`test/install.test.ts` checks the manifests agree with each other and with
the skills folder. `evals/install.md` records each install tried.
