# company

Set a company up with nikOS from the top: a company plan repo that departments
and teams join, the settings they inherit, and this period's objectives. A
department plan is set up the same way, with `--level department`. Neither has
a story map: teams spec bets into stories in their own repos. Ask one question
at a time, and do nothing outward-facing (creating a repo, sending anything)
without a yes.

1. Ask the company's name, the planning period, and its departments.
2. Run `nikos company init --name "<name>" --period "<period>" --departments "<a, b>"` in an empty folder, or the company plan repo if one exists. For a department, add `--level department` and list its teams as `--departments`.
3. Ask how approvals should work across the company: off, optional, or required before a release, and whether departments may change it. Save it with `nikos settings set approval.policy …`, and add it to `locked:` in `nikos.settings.yaml` if they say no.
4. Run the tracker playbook to connect the company's tracker and map its statuses, here, so every level inherits it.
5. Run the planning wizard at the company level for this period's objectives and key results. If they exist in a document already, read it through its MCP (Confluence, Google Docs, Notion) and draft from it.
6. Ask whether to create the repo on GitHub or GitLab, and where. Only on a yes, create it with `gh` or `glab` (or the host's MCP), commit and push, and run `nikos company init --repo <path>` again to fill in the join line.
7. Show the join line for each department and team, for the person to share however they like. Never send it yourself.
   Later, "how's the rollout going?" runs `nikos planning rollout`: who has joined, who is behind, and delivery across their repos.
8. Report every step with its evidence or its skip reason.
