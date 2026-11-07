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

At the start of each session in a repo with a story map, the plugin's hook
(`hooks/hooks.json`) tells the agent where things stand and what to suggest
next.

## Codex

```
codex plugin marketplace add nikovijay/NikOS
```

Then install nikOS from the Plugins directory. Update it later with `codex
plugin marketplace upgrade`.

The plugin ships the same session-start hook as Claude Code
(`hooks/hooks.json`). Codex runs a plugin's hooks only after you review and
trust them, and asks again when they change. Until you trust it, nikOS works
without it: the agent runs `nikos suggest` itself after each request. Codex's
docs say plugin hooks run for plugins installed manually in the Codex desktop
app, and that plugins with hooks can't be listed in its public plugin
directory.

## Cursor

Cursor installs plugins from a marketplace in its settings rather than a
command. Add `https://github.com/nikovijay/NikOS` as a marketplace (Plugins,
then Add Marketplace, then Import from Repo), and install nikOS from it.

To try it without a marketplace, copy the repo to
`~/.cursor/plugins/local/nikos` and run "Developer: Reload Window".

The plugin's `sessionStart` hook (`hooks/cursor-hooks.json`) adds where things
stand and what to suggest next to each new conversation, in a repo with a story
map. Cursor runs it without waiting, so on a slow first run (while `npx` fetches
nikos) it can land after your first message. It doesn't run in cloud agents.

## Packs

Packs are extra tools that install on their own, next to nikOS or without it.
Each lives in `tools/<pack>/` with its own manifests and skills, and both
marketplaces list it.

| Pack | Folder | Claude Code |
| --- | --- | --- |
| Video | `tools/video/` | `/plugin install nikos-video@nikos` |
| Planning | `tools/planning/` | `/plugin install nikos-planning@nikos` |

In Codex and Cursor, install the pack from the same marketplace as nikOS.
nikOS's router hands requests to an installed pack's skill, and gives the
install command when the pack is missing.

## Any app that runs MCP servers

`nikos mcp` runs nikOS as a local MCP server. Claude Desktop, Cursor, Codex,
Claude Code and other apps that run MCP servers on your machine can use it, with
no skills to install. Its tools are nikOS's commands, its prompts are the
playbooks, and it tells the app's model to keep the conversation going with a
short menu of next steps. Point it at one repo with `--dir`.

**Claude Desktop**: in Settings → Developer → Edit Config, add to
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nikos": { "command": "npx", "args": ["-y", "nikos", "mcp", "--dir", "/path/to/your/repo"] }
  }
}
```

**Cursor**: the same `mcpServers` entry, in `.cursor/mcp.json` in the repo.

**Codex**: in `~/.codex/config.toml`:

```toml
[mcp_servers.nikos]
command = "npx"
args = ["-y", "nikos", "mcp", "--dir", "/path/to/your/repo"]
```

**Claude Code**: `claude mcp add nikos -- npx -y nikos@latest mcp --dir "$PWD"` from
the repo. The plugin above gives Claude Code the same and more, so you only
need one of the two.

**Approvals through the app.** When you ask to approve a story, the server asks
you directly through the app's own prompt ("Do you want to approve HT-2:
Reorder tasks?"). The model never sees the question or gives the answer, and
the approval is recorded as `via: app`. If an app can't ask you directly, the
server says so and approves nothing.

## The command-line tool

The skills run the `nikos` command. When it isn't installed, or is older than
the latest release, they run it through `npx -y nikos@latest`, so nothing has
to be installed globally. `@latest` matters: a plain `npx -y nikos` can reuse
an old copy npx has cached. To install it anyway: `npm install -g nikos@latest`,
and the same again to update it. `nikos --version` says which you have, and
`nikos doctor` warns when the one on your PATH is older than the one running.

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
- Hooks, read on 2026-11-06: Cursor's https://cursor.com/docs/agent/hooks
  (`sessionStart`, JSON output with `additional_context`, `timeout` in seconds;
  a plugin points at its hooks with `hooks` in `.cursor-plugin/plugin.json`),
  and Codex's plugin page above and https://learn.chatgpt.com/docs/hooks
  (`SessionStart`, the same format as Claude Code, plain stdout added as
  context, hooks run only once trusted).

All three find skills as `skills/<name>/SKILL.md` at the plugin root.
`test/install.test.ts` checks the manifests agree with each other and with
the skills folder. `evals/install.md` records each install tried.
