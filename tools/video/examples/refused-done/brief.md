# Brief: done means the checks pass

The brief this example video was made from, as given to the agent.

- **Product:** nikOS, spec-driven development for AI coding agents.
- **For:** developers who use an AI coding agent, watching on the Video pack's
  page at nikos.tools. Plays muted by default, so the labels carry the story.
- **Length:** about 20 seconds, 1080p, music only.
- **The story in one line:** an agent tries to mark a story done while one of
  its checks fails; nikOS refuses, the agent fixes the code rather than the
  check, and the story finishes with every check passing.
- **In:** one desktop window, the code on the left and the terminal on the
  right. Real commands and their real output, from replaying a tip calculator
  story (TC-1: a 15% tip on 33.33 must total 38.33, and the code rounds down).
- **Out:** phones, other apps, logos, stats or claims about anyone else.
- **Close:** "Done means the checks pass.", nikos.tools and `npx nikos init`.

## Beats

| Time | Label | On screen |
| --- | --- | --- |
| 0–6.6s | 01 nikOS won't mark it done while a check fails | `npx nikos state set TC-1 done` is typed; nikOS refuses and names AC2. Push in on the refusal. |
| 6.9–11.2s | 02 The agent fixes the code, not the check | Push in on `tip.js`: `Math.floor` is selected and becomes `Math.round`. AC2's scenario, below it, is unchanged. |
| 11.5–17.4s | 03 Every check passes. Now it's done | `npx nikos verify TC-1` shows 2 scenarios passed; `state set TC-1 done` prints `TC-1: in_progress → done`, and the status turns green. |
| 17.6–24s | Close | The plate opens from the status. |

## Make it

```sh
cp ../../skills/product-tour-video/scripts/*.mjs .
npm i --prefix . --no-save --no-package-lock playwright
npx playwright install chromium
node render.mjs && node music.mjs && node mix.mjs   # → final.mp4
```
