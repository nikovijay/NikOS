# UX pack

Turn the design system you already have into a component library page and a
brief any coding agent can build from. Your agent reads your real tokens and
components, puts them in one data module, renders every specimen from it, and
adds a "Copy prompt" button that hands another agent the same rules.

See one: [nikos.tools/ux/library](https://nikos.tools/ux/library).

The pack is one skill, `design-library`. nikOS's router sends any request for
a component library or design system page to it through the `ux-library`
playbook. You can also install the pack on its own and ask directly.

## Install

Claude Code, in a session:

```
/plugin marketplace add nikovijay/NikOS
/plugin install nikos-ux@nikos
```

Codex and Cursor: add `nikovijay/NikOS` as a marketplace (see
[docs/install.md](../../docs/install.md)) and install `nikos-ux` from it.

## Make one

Ask your agent, in the repo with your components:

> Make a component library page from our existing design system, with a Copy prompt button that gives other agents the same brief.

The agent finds your tokens, components and any written design rules, lists
the gaps, and gives you an outline to approve: where the page lives, its
sections and its principles. Then it writes the data module, builds the page
from it, screenshots it at phone and desktop widths, and adds tests that fail
if the page and your code drift apart.

## What you get

- **One data module**: tokens with their values in every theme and their job,
  type roles, spacing, radii, shadows, components by source file, and do and
  don't lines.
- **A library page** drawn in your own design language, with your real
  components rendered live.
- **A brief for agents**: the same rules as Markdown, behind a Copy prompt
  button.
- **Tests** that check the module against your CSS or config.
