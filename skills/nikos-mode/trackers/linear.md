# Linear

**MCP:** Linear's own MCP server. The person connects it in their app and
signs in to Linear; you never handle a key.

- **Team:** Linear groups issues by team, not project. `tracker.project` is
  the team key (`ENG`); ticket ids look like `ENG-42`. `tracker.site` is the
  workspace's url name.
- **Statuses:** each team has its own workflow states, grouped as backlog,
  unstarted, started, completed and canceled. Map the team's states, not the
  groups.
- **Who approved:** an issue's history says who changed its state. Use that
  for `--by`.
- **Backlog import:** list the team's issues that aren't completed or
  canceled. Use the project (or the parent issue) as the group.
- **Moving a ticket:** set the issue's state to the one `nikos tracker sync`
  gives.
