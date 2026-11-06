# Jira

**MCP:** Atlassian's MCP server (it covers Jira and Confluence). The person
connects it in their app's connector or MCP settings and signs in with their
Atlassian account; you never handle a token.

- **Site and project:** `tracker.site` is the site's host (`acme.atlassian.net`),
  `tracker.project` the project key (`PAY`). Ticket keys look like `PAY-123`.
- **Statuses:** each project has its own workflow, so list the statuses for
  this project, not the site. Common ones: To Do, In Progress, In Review,
  Done, and often an "Accepted" or "Approved" a product owner moves tickets
  to.
- **Who approved:** an issue's changelog says who moved it to each status
  and when. Use that for `--by`, never the assignee.
- **Backlog import:** search the project's open issues with JQL
  (`project = PAY AND statusCategory != Done`). Use the epic as the group.
- **Moving a ticket:** Jira moves issues by transition, not by setting a
  status. List the issue's transitions and pick the one that leads to the
  status `nikos tracker sync` gives.
