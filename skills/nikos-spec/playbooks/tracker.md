# tracker

Connect the story map to the team's tracker, bring a backlog in, or keep the
two in step. nikOS never calls a tracker itself: you read and write tickets
through the tracker's own MCP, and hand what you read to `nikos tracker`.

1. Run `nikos settings`. If `tracker.system` is `none`, ask which tracker the team uses (Jira, Linear, GitHub Issues, GitLab Issues, Azure DevOps, Shortcut, or none). Read its guide in `trackers/<system>.md` next to the playbooks.
2. Check the tracker's MCP is connected, as the guide describes. If it isn't, tell the person how to add it, and stop.
3. With the MCP, list the statuses tickets can have in their project (or team). Propose what each means to nikOS (todo, in_progress, needs_rework, done, approved, cancelled), ask the person to confirm or change each one, and ask whether moving a ticket to an approved status should approve the story.
4. Save the answers with `nikos settings set` (`tracker.system`, `tracker.site`, `tracker.project`, `tracker.statuses`, `tracker.approvals`). They go in this repo's own settings file. If the plan locks a key, nikOS refuses the change and says who locked it: tell the person, and don't try another way round it.
5. To bring a backlog in: fetch the tickets with the MCP, write them to a JSON file as `[{ "key", "title", "group" }]` (group: the epic, project or label), and run `nikos tracker import <file>`. Stories start as todo; offer to write the first ones' scenarios.
6. To link stories that already exist: match each to its ticket with the person, and run `nikos tracker link <story-id> <ticket>`.
7. To keep them in step: for each linked ticket, read its status (and, for an approved status, who moved it there from the ticket's history), and run `nikos tracker record <story-id> --status "<status>" --by "<who>"`. Then run `nikos tracker sync --json` and move each ticket it lists to the status it gives, with the MCP. Never move a story to done because a ticket says so: done comes from its scenarios.
8. Report every step with its evidence or its skip reason.
