# Brief: from install to a story map

The brief this example video was made from, as given to the agent.

- **Product:** nikOS, spec-driven development for AI coding agents.
- **For:** developers who use an AI coding agent, watching on the Video pack's
  page at nikos.tools. Plays muted by default, so the labels carry the story.
- **Length:** under a minute, 1080p, music only.
- **The story in one line:** install nikOS, tell the agent an idea, and finish
  with a checked story map in your own repo, ready to build.
- **In:** one desktop window: the repo's files and the open file on the left,
  the agent session on the right. Real commands and their real output, from
  running nikOS on an example idea: Sprout, which reminds people with a few
  houseplants when each one needs water.
- **Out:** phones, other companies' apps or logos, stats or claims about
  anyone else. The agent session is drawn plainly, not as any one tool.
- **Close:** "From idea to story map, in your repo.", nikos.tools and the
  install command. The author's N mark sits bottom-left throughout.

## Beats

| Time | Label | On screen |
| --- | --- | --- |
| 0–5.4s | 01 Install nikOS in your agent | `/plugin install nikos --marketplace nikovijay/NikOS` is typed. |
| 5.6–12.2s | 02 Tell it your idea | The idea is typed; the agent names the playbook it runs and asks for the name. |
| 12.4–17s | 03 nikOS sets up intent/ in your repo | `nikos init` runs; its six files appear and the constitution opens. |
| 17.2–27.5s | 04 Five questions shape the constitution | Push in on the constitution as Users, Problem, Switch, First and Proof fill in. |
| 27.7–34s | 05 Activities and releases become the story map | `storymap.yaml` gets two activities and two releases; four `nikos story add` calls fill it. |
| 34.2–41s | 06 Every story gets criteria you can test | SP-1's feature file is written; `nikos clear SP-1` checks it. |
| 41.2–47s | 07 Checked, and ready to build | `nikos validate`: 4 stories, 2 releases. `nikos next`: SP-1. |
| 47.4–54s | Close | The plate opens from the status. |

## Make it

```sh
cp ../../skills/product-tour-video/scripts/*.mjs .
npm i --prefix . --no-save --no-package-lock playwright
npx playwright install chromium
node render.mjs && node music.mjs && node mix.mjs   # → final.mp4
```
