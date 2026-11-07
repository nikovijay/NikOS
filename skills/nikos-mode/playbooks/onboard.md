# onboard

Someone has just installed nikOS. Find out what they're organising, set up the
right repo for it, and end with something they can see. Ask one question at a
time, and offer a recommended answer with each.

1. Check the `nikos` command: run `nikos --version` and `npx -y nikos@latest --version`. If `nikos` is missing or older, use `npx -y nikos@latest` for every command from here and tell the person, in a sentence, that `npm install -g nikos@latest` updates theirs.
2. Ask what they're setting up, with these three choices and a sentence on each:
   - **A team building a product:** a story map, specs as Gherkin scenarios, and a done gate that only passes when the scenarios do (`nikos start`).
   - **A company or department plan:** objectives, key results and bets that teams plan against from their own repos (`nikos company init`).
   - **Both, in one repo:** a small company with one product team. The plan and the story map live side by side.
   Recommend "both" for a company with one team, and "a company plan" when several teams will join it.
3. Ask where it should live. Never set nikOS up in the home folder or a folder that already holds another project: suggest a new folder named after the company or product, and create it only on a yes. If it isn't a git repo, offer `git init`.
4. Ask the name. For a team or both, suggest a story key from it (e.g. "Acme Robotics" → AR) and ask the person to confirm it, saying it prefixes every story id and is hard to change later. Never take one word as both the name and the key without asking. For a company plan, ask the period (suggest the current quarter) and the departments, if they know them.
5. Run the setup and say what it did in a sentence, not a list of files:
   - a team: run the start playbook from its step 1, with `--name` and `--key`.
   - a company plan: run the company playbook from its step 2.
   - both: `nikos start --name "<name>" --key <KEY>`, then `nikos company init --name "<name>" --period "<period>"` in the same folder, then the planning wizard for this period's objectives and key results.
6. Show it: offer to start `nikos serve`, which opens the dashboard for the plan, with the story map a click away. Tell them what they'll see there.
7. Offer the next step as a choice: the first key result (planning wizard), the first story (build-a-story), or connecting their tracker (tracker playbook).
8. Report every step with its evidence or its skip reason.
