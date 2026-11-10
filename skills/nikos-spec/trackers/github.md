# GitHub Issues

**MCP:** GitHub's MCP server, or the `gh` command when the agent has a shell.
The person signs in through their app or `gh auth login`; you never handle a
token.

- **Project:** `tracker.project` is the repo (`owner/repo`), or a GitHub
  Project if the team tracks work on a board. Tickets are issue numbers: link
  them as `#57`.
- **Statuses:** an issue is only open or closed. Teams on a GitHub Project
  board use its Status field (Todo, In Progress, Done…): map those. Without a
  board, map labels the team uses (`in-progress`, `approved`) as statuses.
- **Who approved:** the issue's timeline says who closed it, or who changed
  its Status field or labels.
- **Backlog import:** list the open issues (or the board's items). Use the
  milestone or a label as the group.
- **Moving a ticket:** set the board's Status field, or the label, or close
  the issue for done.
