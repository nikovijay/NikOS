<p align="center">
  <img src="https://raw.githubusercontent.com/nikovijay/NikOS/main/assets/header.svg" alt="nikOS" width="840">
</p>

<p align="center"><b>Spec-driven development for AI coding agents</b></p>

I'm [@nikovijay](https://x.com/nikovijay), a Product Director with 20 years
of experience in software delivery. nikOS is my personal framework for
building products with AI coding agents. I'm sharing it to help others get
started with agentic programming practices. For where I think this is going,
see my thoughts on
[the software factory of the near future](https://www.nikovijay.com/software-factory).

## What it does

AI coding agents are quick to say "done". nikOS makes them prove it. Your
story map, plans and acceptance criteria live in your repo as plain files,
each criterion is a Cucumber scenario that runs as a test, and a story can't
be marked done until its scenarios pass. Your agent follows a named playbook
for each request instead of improvising, and every decision is written down
where the next person (or agent) can find it.

It works with Claude Code, Codex and Cursor, and brings spec-driven
development, behaviour-driven development (BDD) with Gherkin and Cucumber,
user story mapping and acceptance criteria to agentic coding.

> Early work in progress. Open source, MIT licensed.

## Try it in 10 minutes

[docs/quickstart.md](docs/quickstart.md) takes an empty repo to one passing
scenario, with every command and the output you should see.

## Install in your agent tool

| Tool | Command |
| --- | --- |
| Claude Code | `/plugin install nikos --marketplace nikovijay/NikOS` |
| Codex | `codex plugin marketplace add nikovijay/NikOS` |
| Cursor | Add `https://github.com/nikovijay/NikOS` as a plugin marketplace |
| Claude Desktop, or any app that runs MCP servers | `npx -y nikos@latest mcp --dir <repo>` as a local MCP server: see [docs/install.md](docs/install.md#any-app-that-runs-mcp-servers) |

Then tell your agent what you want to organise ("set up nikOS for my
company", "set up nikOS for this product"): the `nikos-mode` skill asks a few
questions and sets up the right repo. The skills run the `nikos` command
through `npx -y nikos@latest`, so there's nothing else to install. More in
[docs/install.md](docs/install.md).

Without an agent, run `npx -y nikos@latest start` in a terminal: it asks the
same questions. Then `npx -y nikos@latest serve` opens the dashboard.

## Talk to it

You don't need to learn the commands. Your agent runs them and, after each
request, says where things stand and offers a short menu of what to do next.
In Claude Code, Codex and Cursor, it also does this when a session starts.
Things you can say:

- "Set up nikOS here", or "Map what this repo already does"
- "Set nikOS up for our company" (a company plan every team joins)
- "What should we build next?"
- "Add a story: people can share a list with one other person"
- "Build HT-3"
- "Is release 1 ready to ship?"
- "Show me the story map"

When a story is done, your agent asks "Do you want to approve HT-3: Reorder
tasks?". Your answer is the sign-off. It's recorded in
`maps/ht/approvals/HT-3.yaml`, and your agent never approves on its own.

## The loop

```bash
npx -y nikos@latest init                # create maps/<key>/ with a starter story
# write the story's scenarios in maps/<key>/features/
npx -y nikos@latest verify setup        # add a Cucumber runner for your stack
npx -y nikos@latest verify TC-1         # run the story: it fails until it's built
# build it, then
npx -y nikos@latest state set TC-1 done # refused unless its scenarios pass
```

That's what runs underneath. With an agent, you only make the request ("add
a story for X and build it"); the playbooks run these steps and stop at each
point that needs you.

## What lives in your repo

```text
constitution.md      who it's for, the problem, what proves it works (at the root)
decisions.md         why things are the way they are, append-only (at the root)
maps/
└── ht/                  one story map, in a folder named by its key
    ├── storymap.yaml    activities and steps, releases, and the order to build stories in
    ├── state.yaml       each story's status: todo, in_progress, needs_rework, done, cancelled
    ├── approvals/       people's sign-offs on done stories, one file per story (optional)
    ├── features/        one .feature file per story; its scenarios are the criteria
    │   └── <activity>/<story>.feature
    └── plans/           how each story will be built, versioned: <story>.v<N>.md
```

Every file is plain text you can read, review and diff. The full format:
[docs/format.md](docs/format.md). Tools that work with these files without a
shell can use nikOS as a library: [docs/library.md](docs/library.md). A worked example:
[examples/hello-todo](examples/hello-todo/maps/ht).

## Commands

| Command | What it does |
| --- | --- |
| `nikos start` | Set this repo up in one go: `maps/<key>/`, a scenario runner for its stack and CI for its host. In a terminal without `--name`, it asks what you're setting up first |
| `nikos serve` | Open the dashboard: the plan's key results, bets, OKR ladder and story maps. `--export <file> --editable` writes an offline page that queues changes |
| `nikos apply <file>` | Apply a changes file from an editable dashboard page. It goes on a new branch, and nothing is pushed (`--commit`, `--pr`) |
| `nikos init` | Create `maps/<key>/`, with `constitution.md` and `decisions.md` at the root, in this repo |
| `nikos company init` | Write a company plan repo that departments and teams join ([docs/settings.md](docs/settings.md)) |
| `nikos activity add "<title>"` | Add an activity to the story map |
| `nikos validate` | Check each story map in `maps/` and the root `constitution.md` are well formed, and each map's `delivery.yaml` is current |
| `nikos story add "<title>"` | Add a story to the map, state and a starter feature. With several story maps, pass `--map <key>` |
| `nikos map new --key <KEY> [--bet <bet-id>] [--owner <KEY>]` | Make a story map in `maps/<key>/`, for one of a group's bets or on its own. Its stories get ids like `PAY-CHK-12`, `WEB-CHK-12` with `--owner WEB`, or `CHK-12` |
| `nikos step add "<title>"` | Add a step under an activity |
| `nikos release add\|rename\|move\|reorder\|remove` | Define releases and move stories between them, keeping feature tags in step |
| `nikos release check <n>` | Say whether a release is ready to ship, and what's in the way |
| `nikos clear <id>` | Check a story is ready to build |
| `nikos plan new <id>` | Start the next version of a story's plan |
| `nikos plan status [--in <area>] [--json]` | The plan's key results and bets, each bet's delivery from the code repos listed in `planning/repos.yaml`, and how old each copy is ([docs/plan.md](docs/plan.md)) |
| `nikos plan refresh` | Read each code repo listed in `planning/repos.yaml`, read-only, and keep a copy of its story maps' status files under `.nikos/` |
| `nikos plan serve [--in <area>] [--export <file>]` | Run the planning dashboard and print its link: one area at a time, with its key results, bets, ladder and each bet's delivery. `--export <file>` writes it as one offline page, for one area with `--in` or for every area without ([docs/plan.md](docs/plan.md)) |
| `nikos map status [--map <id>] [--json]` | How each story in this repo's maps is doing: its status, whether it was proved against the current feature, and its approval. Saves each map's `delivery.yaml` to commit (`--json` saves nothing) |
| `nikos verify setup` | Add a Cucumber runner for this repo's stack |
| `nikos ci setup` | Run validate and every story's scenarios on each PR (GitHub Actions) or merge request (GitLab CI), plus a release check you run by hand before shipping |
| `nikos verify [id]` | Run a story's scenarios, or all of them |
| `nikos state set <id> <status>` | Move a story; done only if its scenarios pass; cancelled needs a reason |
| `nikos approve <id>...` | Sign off done stories, in your terminal or (`--via chat`) by answering your agent (writes the story's file under `maps/<key>/approvals/`) |
| `nikos next` | Print the next story to build |
| `nikos migrate maps` | Move a repo's `intent/` story map to `maps/<key>/`, converting it to the current format. Shows the plan first (`--dry-run`); writes on `nikos/migrate-maps`, uncommitted unless `--commit` |
| `nikos suggest` | Where things stand, and a short menu of what to do next |
| `nikos join <repo>` | Join a plan in another repo. A planning repo gets this repo listed on a `nikos/join-…` branch for review (`--push` sends it, `--plan-dir` uses a checkout you have). An older plan's settings are inherited ([docs/settings.md](docs/settings.md)) |
| `nikos settings` | The settings that apply here, and where each comes from |
| `nikos doctor` | Check the repo is set up well, and what to do next |
| `nikos tracker link\|record\|sync\|import` | Keep the story map and Jira, Linear, GitHub or GitLab issues in step, through the tracker's MCP |
| `nikos show <id>` | Summarise a story: feature, status, plan, bets, decisions |
| `nikos decide "<title>"` | Append a decision to `decisions.md` |
| `nikos decisions "<q>"` | Quote the decisions about a topic or story |
| `nikos map` | Write a read-only story map page |
| `nikos export --format prd\|linear\|jira` | Write the story map as a PRD or a Linear or Jira import |

## Links

- Home: https://nikos.tools
- Quickstart: [docs/quickstart.md](docs/quickstart.md)
- Install: [docs/install.md](docs/install.md)
- Format: [docs/format.md](docs/format.md)
- Writing stories as features: [docs/gherkin.md](docs/gherkin.md)

MIT licensed.
