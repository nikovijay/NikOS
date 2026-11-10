# onboard

Someone has just installed nikOS. Find out what they're organising, set up the
right repo for it, and end with something they can see. Ask one question at a
time, and offer a recommended answer with each.

1. Check the `nikos` command: run `nikos --version` and `npx -y nikos@latest --version`. If `nikos` is missing or older, use `npx -y nikos@latest` for every command from here and tell the person, in a sentence, that `npm install -g nikos@latest` updates theirs.
2. Ask what they're setting up, with these five choices, one line each:
   1. **A company plan:** objectives, key results and bets for the whole company, with departments or groups planning below it (`nikos company init`).
   2. **A department plan:** a department's objectives, aligned to the company plan (`nikos company init --level department`, then `nikos join` the company plan from it).
   3. **A group:** its plan and story maps, one per bet. Each map's owner names the team whose story ids it carries (`nikos group init`, then `nikos planning bet new` and `nikos map new` in it).
   4. **One product in one repo:** its own story map in `intent/`, with no levels, and a done gate (`nikos start`).
   5. **A company plan and a product, in the same repo:** the older path.
   Recommend "a company plan" when departments or groups will plan against it, "a group" for a small company that builds its bets in one repo, and "one product" for a single repo with no plan above it.
3. Ask where it should live. Never set nikOS up in the home folder or a folder that already holds another project: suggest a new folder named after the company or product, and create it only on a yes. If it isn't a git repo, offer `git init`.
4. Ask the name. For one product, or both, suggest a story key from it (e.g. "Acme Robotics" → AR) and ask the person to confirm it, saying it prefixes every story id and is hard to change later. For a group, suggest a group key the same way: it prefixes every story id in the group's maps (PAY-HT-1). Never take one word as both the name and the key without asking. For a company or department plan, ask the period (suggest the current quarter), and for a company, whether departments report to it or groups plan directly under it.
5. Run the setup and say what it did in a sentence, not a list of files:
   - one product: run the start playbook from its step 1, with `--name` and `--key`.
   - a company plan: run the company playbook from its step 2.
   - a department plan: `nikos company init --level department --name "<name>" --period "<period>"`, then `nikos join <company plan repo>` once the company plan exists.
   - a group: `nikos group init --name "<name>" --key <GROUP>`. Then make its first bet and story map with `nikos planning bet new <bet-id>` and `nikos map new --bet <bet-id> --key <MAP>` (add `--owner <KEY>` when the team that builds it has a key of its own).
   - both: `nikos start --name "<name>" --key <KEY>`, then `nikos company init --name "<name>" --period "<period>"` in the same folder, then the planning wizard for this period's objectives and key results.
   A repo that already has an `intent/` story map and should join a group moves it with `nikos migrate maps`, after a dry run the person reads.
6. Show it: offer to start `nikos serve`, which opens the dashboard for the plan, with the story map a click away. Tell them what they'll see there.
7. Offer the next step as a choice: the first key result (planning wizard), the first story (build-a-story), or connecting their tracker (tracker playbook).
8. Report every step with its evidence or its skip reason.
