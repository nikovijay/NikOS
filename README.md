```text
           _   _        ___    ____
   _ __   (_) | | __   / _ \  / ___|
  | '_ \  | | | |/ /  | | | | \___ \
  | | | | | | |   <   | |_| |  ___) |
  |_| |_| |_| |_|\_\   \___/  |____/

  spec-driven development for AI coding agents
```

Your story map, plans and acceptance criteria live in your repo as plain
files and executable Cucumber features, and the agent can't call a story done
until its scenarios pass.

> Early work in progress. Start with [the intent/ format](docs/format.md).

## Install

| Tool | Command |
| --- | --- |
| Claude Code | `/plugin install nikos --marketplace nikovijay/NikOS` |
| Codex | `codex plugin marketplace add nikovijay/NikOS` |
| Cursor | Add `https://github.com/nikovijay/NikOS` as a plugin marketplace |

Then ask your agent to plan or build a story: the `nikos-mode` skill takes it
from there. Details and the formats each tool expects: [docs/install.md](docs/install.md).

- Home: https://nikos.tools
- Format spec: [docs/format.md](docs/format.md)
- Mapping to intentdocs: [docs/intentdocs-mapping.md](docs/intentdocs-mapping.md)
- Worked example: [examples/hello-todo](examples/hello-todo/intent)

MIT licensed.
