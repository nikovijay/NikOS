# tickets

Turn the story map into Jira issues and epics, or bring Jira up to date after
the map changed. nikOS says what the issues should be; you create and update
them with the Atlassian MCP, with the person watching, and hand the keys back
to `nikos tickets keys`. nikOS never calls Jira itself.

1. Run `nikos settings`. `tracker.system` must be `jira` and `tracker.project` set. If either isn't, run steps 1 to 4 of the `tracker` playbook first. The export is shaped for Jira: for another tracker, say so and stop.
2. Check the Atlassian MCP is connected, as `trackers/jira.md` describes. If it isn't, tell the person how to add it, and stop.
3. Run `nikos tickets` and show the person the issues and the epics they'll go under. Ask whether that's how the team wants them. To change it, they switch the story map from `nikos serve` to Ticketing mode, or you edit `maps/<key>/tickets.yaml` as `docs/format.md` describes. Then run `nikos validate` and `nikos tickets` again.
4. Run `nikos tickets export --out <file>`, with the file outside the repo (or use the `tickets_export` tool). With the MCP, check the project has the issue type and epic type the export names. If one is missing, tell the person, and change the type in Ticketing mode's Fields or in `tickets.yaml` before going on.
5. Show the person what you'll do in Jira: how many epics and issues to create, how many to update, and each one's summary. Ask before you change anything in Jira, and wait for a yes. Never delete, close or move a Jira issue's status in this playbook.
6. Epics first. For each epic marked `create`, create it in the project with the epic type, its summary and its labels. For each marked `update`, set its summary and labels on its key. Keep a list of each epic's ref and key as you go, the updated ones too.
7. Then issues. For each issue marked `create`, create it with its type, summary, description, labels, components and any `fields`, and its parent set to its epic's key (the epic named by its `epic` ref; none when `epic` is null). For each marked `update`, set the same on its key. Add each issue's ref and key to your list, the updated ones too: a story that joined an issue since is linked to its key only when it's recorded. If one fails, say which and why, and go on with the rest.
8. Record the keys: write your list to a file as `{ "<ref>": "<key>" }` and run `nikos tickets keys <file>` (or the `tickets_keys` tool), even when some failed. Then run `nikos tickets`: every issue should show a key, and a later export updates them instead of creating them again.
9. The keys changed `maps/<key>/state.yaml` and, for epics, `tickets.yaml`. Commit them with the repo's usual branch and review, as for any change.
10. Report every step with its evidence or its skip reason, with a link to each issue you created.
