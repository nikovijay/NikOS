# Brief: nikOS Plan and Spec

The brief this example video was made from.

- **Product:** nikOS, with its two products: nikOS Plan (the company's objectives, key results and bets) and
  nikOS Spec (each code repo's story map, with criteria that run as tests).
- **For:** product and engineering leads deciding whether to try nikOS. Plays muted by default, so the
  labels carry the story.
- **Length:** about 80 seconds, 1080p, music only.
- **The story in one line:** one bet goes from the company's plan to proven code, and its delivery comes back
  to the plan.
- **In:** nikOS's real pages. `sample/build.mjs` builds an example company (Acme) and its shop-web repo
  with nikOS, adds the key result and the bet through the dashboard's own save API, runs the checkout
  stories' scenarios with Cucumber, and saves each page and each command's output. The terminal shows what
  those commands really printed, including the refusal when a scenario fails.
- **Out:** other companies' apps or logos, and stats or claims about anyone. The agent and the terminal are
  drawn plainly, not as any one tool. Acme and its people are an example.
- **Close:** "Plan the bets. Prove the build.", nikos.tools and `npx -y nikos@latest start`. The author's N
  mark sits bottom-left throughout.

## Beats

| Time | Label | On screen |
| --- | --- | --- |
| 0–5.6s | 01 Company goals live in one repo | The plan dashboard on Acme's 2026 key result, Online revenue reaches £12m. |
| 6–13s | 02 Departments set key results each quarter | Commerce: Add a key result, typed in, aligned to the company's, and saved. |
| 13.4–20.2s | 03 Teams make bets on them | The Web team: Add a bet, One-page checkout, aimed at the new key result. |
| 20.6–26.8s | 04 The ladder shows how it all connects | The ladder from the bet up to the company's key result. |
| 27.2–34s | 05 The bet becomes a story map in the code | shop-web's story map, which delivers one-page-checkout. |
| 34.2–41.4s | 06 Every story has criteria that run as tests | WEB-CHK-5's panel, and its Given, When and Then. |
| 41.8–50.8s | 07 Done only when its scenarios pass | `nikos state set WEB-CHK-5 done` is refused; the fix; the scenario passes; done. |
| 51–56.8s | 08 You sign off every story | The agent asks to approve WEB-CHK-5; the answer is recorded. |
| 57–64.8s | 09 Delivery flows back to the plan | The bet shows 4 of 8 stories done; a check-in moves conversion to 2.6%. |
| 65–72s | 10 Every change goes on a branch you review | The save bar: one saved change on a nikos/plan branch, with Commit and Push. |
| 72.2–79s | Close | The plate opens from Push. |

## Make it

```sh
npm run build                                       # in the nikOS repo: the pages come from this build
node sample/build.mjs <an empty folder>             # the example, for real → screens/
node assemble.mjs                                   # screens/ into tour.html
cp ../../skills/product-tour-video/scripts/*.mjs .
printf '{"private":true,"type":"module"}\n' > package.json
npm i --no-save --no-package-lock playwright
node render.mjs && node music.mjs && node mix.mjs   # → final.mp4
```

`screens/` is committed, so the video renders again without rebuilding the example. Rebuild it when the
pages change.
