# GitLab Issues

**MCP:** GitLab's MCP server, or the `glab` command when the agent has a
shell. Self-managed GitLab works the same way, at the company's own host. The
person signs in; you never handle a token.

- **Project:** `tracker.site` is the host (`gitlab.com` or
  `gitlab.acme.com`), `tracker.project` the project's full path
  (`acme/product/payments`). Tickets are issue numbers: link them as `#57`.
- **Statuses:** an issue is open or closed, and teams track the rest with
  scoped labels (`workflow::in progress`, `workflow::approved`) or board
  lists. Map the labels the team uses.
- **Who approved:** the issue's history (system notes) says who added a label
  or closed it.
- **Backlog import:** list the open issues. Use the epic or milestone as the
  group.
- **Moving a ticket:** swap the scoped label, or close the issue for done.
