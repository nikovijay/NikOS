# onboard

Someone has just installed nikOS. Find out whether they're setting up the
company's plan or a story map for this code, set that up, and end with something
they can see. Ask one question at a time, and offer a recommended answer with each.

1. Check the `nikos` command: run `nikos --version` and `npx -y nikos@latest --version`. If `nikos` is missing or older, use `npx -y nikos@latest` for every command from here and tell the person, in a sentence, that `npm install -g nikos@latest` updates theirs.
2. Ask what they're setting up, with these two choices, one line each:
   1. **The company's plan:** objectives, key results and bets for the whole company, with a folder for each department, group and team, in one planning repo. The nikos-plan skill sets it up.
   2. **A story map for this code:** the stories, scenarios and done gate for one repo, in `maps/<key>/` (this skill, `nikos start --map`).
   Recommend the plan for the repo that will hold the company's goals, and a story map for a product's code. A code repo can join a company plan later.
3. Ask where it should live. Never set nikOS up in the home folder or a folder that already holds another project: suggest a new folder named after the company or product, and create it only on a yes. If it isn't a git repo, offer `git init`. Then, for a git repo with no origin remote, ask where the repo should live: GitHub, GitLab, or only on this computer for now. Never pick for them, even when `gh` or `glab` is signed in. For GitHub or GitLab, ask its path (owner or group, and name; suggest their own account) and whether it's private (recommend private). Make it only through nikOS, with `--github <owner/name>` or `--gitlab <group/name>` (and `--public` only if they said public) on the setup command in step 5. Never push: say they can push when they're ready.
4. Ask the name. For a story map, suggest a story key from it (e.g. "Acme Robotics" → AR) and ask the person to confirm it, saying it prefixes every story id and is hard to change later. Never take one word as both the name and the key without asking. For the company's plan, the nikos-plan skill asks the name and the year.
5. Run the setup and say what it did in a sentence, not a list of files:
   - the company's plan: hand over to the nikos-plan skill and its setup playbook, from its step 1. Only in a new folder.
   - a story map: run the start playbook from its step 1, with `--name` and `--key`. If a company plan exists, ask for its repo and add `--join <planning repo>`.
   A repo with an `intent/` story map from before this release is not set up by `nikos start`. Its map moves by hand to `maps/<key>/` (the CHANGELOG says how), and then `nikos start` can run.
6. Show it: for a story map, offer to run `nikos serve`, which opens the story map in the browser. For the company's plan, the nikos-plan skill offers `nikos plan serve`. Tell them what they'll see there.
7. Offer the next step as a choice: the first story (build-a-story), connecting their tracker (tracker playbook), or, for a code repo with a plan above it, joining it (join playbook).
8. Report every step with its evidence or its skip reason.
