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

nikOS has two sides. **Spec** is the code side: each repo keeps its story map
in `maps/<key>/`. **Plan** is the company's objectives, key results and bets,
in one planning repo with a folder for each department, group and team. A code
repo can be linked to the plan, and the plan reads each one's delivery.

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

Then tell your agent what you want to set up ("set up the company's plan",
"set up nikOS for this product"). The `nikos-plan` skill plans the company, and
the `nikos-spec` skill sets up a code repo's story map. The skills run the
`nikos` command through `npx -y nikos@latest`, so there's nothing else to
install. More in [docs/install.md](docs/install.md).

Without an agent, run `npx -y nikos@latest start` in a terminal: it asks whether
you're setting up the company's plan or a story map for this code, and then a
few questions. Then `npx -y nikos@latest serve` opens the story map, and
`npx -y nikos@latest plan serve` opens the plan.

## Talk to it

You don't need to learn the commands. Your agent runs them and, after each
request, says where things stand and offers a short menu of what to do next.
In Claude Code, Codex and Cursor, it also does this when a session starts.
Things you can say:

- "Set up nikOS here", or "Map what this repo already does"
- "Set up our company's plan" (objectives, key results and bets, with a folder for each team)
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
| `nikos start` | Set this folder up: `--plan` makes the company's planning repo, `--map` (with `--name` and `--key`, and `--join <planning repo>`) makes a story map for this code with a scenario runner for its stack and CI for its host. In a terminal with no flags, it asks which |
| `nikos plan init` | Make the company's planning repo: `planning/company/`, with a folder for each department, group and team under `planning/` |
| `nikos plan add department\|group\|team <id>` | Add an area to the company's plan |
| `nikos plan kr new`, `plan checkin`, `plan bet new`, `plan bet review` | Key results, check-ins and bets, in the area named with `--in` (`nikos plan help` lists them all) |
| `nikos serve` | Open this repo's story map in the browser. `--export <file>` writes it as one offline page. In a planning repo, use `nikos plan serve` |
| `nikos init` | Create `maps/<key>/`, with `constitution.md` and `decisions.md` at the root, in this repo |
| `nikos activity add "<title>"` | Add an activity to the story map |
| `nikos validate` | Check each story map in `maps/` and the root `constitution.md` are well formed, and each map's `delivery.yaml` is current |
| `nikos story add "<title>"` | Add a story to the map, state and a starter feature. With several story maps, pass `--map <key>` |
| `nikos map new --key <KEY> [--bet <bet-id>] [--owner <KEY>]` | Make a story map in `maps/<key>/`, for a bet of the company's plan or on its own. Its stories get ids like `PAY-CHK-12`, `WEB-CHK-12` with `--owner WEB`, or `CHK-12` |
| `nikos step add "<title>"` | Add a step under an activity |
| `nikos release add\|rename\|move\|reorder\|remove` | Define releases and move stories between them, keeping feature tags in step |
| `nikos release check <n>` | Say whether a release is ready to ship, and what's in the way |
| `nikos clear <id>` | Check a story is ready to build |
| `nikos plan status [--in <area>] [--json]` | The plan's key results and bets, each bet's delivery from the code repos listed in `planning/repos.yaml`, and how old each copy is ([docs/plan.md](docs/plan.md)) |
| `nikos plan refresh` | Read each code repo listed in `planning/repos.yaml`, read-only, and keep a copy of its story maps' status files in the planning repo |
| `nikos plan serve [--in <area>] [--export <file>]` | Run the planning dashboard and print its link: one area at a time, with its key results, bets, ladder and each bet's delivery. `--export <file>` writes it as one offline page, for one area with `--in` or for every area without ([docs/plan.md](docs/plan.md)) |
| `nikos map status [--map <id>] [--json]` | How each story in this repo's maps is doing: its status, whether it was proved against the current feature, and its approval. Saves each map's `delivery.yaml` to commit (`--json` saves nothing) |
| `nikos verify setup` | Add a Cucumber runner for this repo's stack |
| `nikos ci setup` | Run validate and every story's scenarios on each PR (GitHub Actions) or merge request (GitLab CI), plus a release check you run by hand before shipping |
| `nikos verify [id]` | Run a story's scenarios, or all of them |
| `nikos state set <id> <status>` | Move a story; done only if its scenarios pass; cancelled needs a reason |
| `nikos approve <id>...` | Sign off done stories, in your terminal or (`--via chat`) by answering your agent (writes the story's file under `maps/<key>/approvals/`) |
| `nikos next` | Print the next story to build |
| `nikos suggest` | Where things stand, and a short menu of what to do next |
| `nikos join <repo>` | Run in a code repo: list it in the company's planning repo (`planning/repos.yaml`) on a `nikos/join-…` branch for review (`--push` sends it, `--plan-dir` uses a checkout you have). Settings aren't inherited: a code repo keeps its own ([docs/settings.md](docs/settings.md)) |
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
