# onboard

Someone has just installed nikOS. Find out which level they're setting up,
set up the right repo for it, and end with something they can see. Ask one
question at a time, and offer a recommended answer with each.

Company and department plans hold objectives, key results and bets, and have no
story map. A story map only exists in a team's repo, beside the team's own plan,
where it specs the team's bets into stories organised by activity and step.

1. Check the `nikos` command: run `nikos --version` and `npx -y nikos@latest --version`. If `nikos` is missing or older, use `npx -y nikos@latest` for every command from here and tell the person, in a sentence, that `npm install -g nikos@latest` updates theirs.
2. Ask which level they're setting up, with these three choices and a sentence on each:
   - **A company plan:** objectives, key results and bets that departments and teams plan against from their own repos (`nikos company init`).
   - **A department plan:** the department's key results and bets, aligned to the company's (`nikos company init --level department`).
   - **A team:** its own key results and bets, and a story map that specs each bet into stories with a done gate (`nikos start`).
   A company that's only one team still sets up a company plan and a team repo that joins it: never put a story map in a company or department plan.
3. Ask where it should live. Never set nikOS up in the home folder or a folder that already holds another project: suggest a new folder named after the company, department or team, and create it only on a yes. If it isn't a git repo, offer `git init`.
4. Ask the name and the planning period (suggest the current quarter). For a team, suggest a story key from the name (e.g. "Payments Squad" → PS) and ask the person to confirm it, saying it prefixes every story id and is hard to change later. Never take one word as both the name and the key without asking. For a company or department, ask which departments or teams will plan against it, if they know. For a department or team, ask which plan above it works toward, as its repo path.
5. Run the setup and say what it did in a sentence, not a list of files:
   - a company: run the company playbook from its step 2.
   - a department: run the company playbook from its step 2, with `--level department`, then `nikos join <plan above>` once that repo is reachable.
   - a team: run the start playbook from its step 1, with `--name` and `--key`. Then the planning wizard at team level, so the team's key results and bets exist before any story, and `nikos join <plan above>` once that repo is reachable.
6. Show it: offer to start `nikos serve`, which opens the dashboard for the plan, with the story map a click away in a team repo. Tell them what they'll see there.
7. Offer the next step as a choice: for a company or department, this period's objectives and key results (planning wizard) or connecting their tracker (tracker playbook); for a team, its first bet (planning bet playbook), then specifying that bet into stories in a release that names it.
8. Report every step with its evidence or its skip reason.
