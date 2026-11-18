# Story maps in Jira

The story map stays the source of truth: its stories, their scenarios, and
whether they pass. Many teams also track their work in Jira. nikOS can say
how the map becomes Jira issues and epics, and your coding agent creates them
with the Atlassian MCP. nikOS never holds a Jira token or calls Jira itself.

## 1. Say which project

```
nikos settings set tracker.system jira
nikos settings set tracker.project PAY
```

`tracker.site` (`acme.atlassian.net`) is optional. Connect the Atlassian MCP in
your agent's app, and sign in there with your Atlassian account.

## 2. Shape the issues

With no setup, each story is one issue and each activity one epic. `nikos
tickets` lists them. To change that, open the story map with `nikos serve`
and switch the top bar from **Story map** to **Ticketing**:

- **The rules**, in the bar over the map. Each issue is one story, or a step's
  stories in each release. Epics are the activities, the releases, or none.
- **Combine stories into one issue.** Click cards to pick them, then
  **Combine into one issue**. Each card shows its issue's number, and stories
  in one issue share a colour.
- **The Issues tab** lists the issues under their epics. Rename an issue, move
  it to another epic, split it back into one issue per story, or add an epic
  of your own.
- **The Fields tab** sets the issue and epic types, a label for everything, a
  component, and whether story ids go in labels or a custom field.

Each change saves to `maps/<key>/tickets.yaml` on the page's `nikos/map-…`
branch, like the page's other edits. You can also write that file by hand: see
[format.md](format.md#ticketsyaml-optional).

## 3. Create them in Jira

Ask your agent to put the story map in Jira. It follows the `tickets` playbook:

1. `nikos tickets export` writes the file it works from. Each epic and issue
   in it is marked `create` (no key yet) or `update`. The Export tab in
   Ticketing mode shows the same file, with a prompt you can copy.
2. The agent shows you what it will create and update, and asks first.
3. It creates the epics, then the issues under them, with the Atlassian MCP.
4. `nikos tickets keys` records each issue's and epic's key. An issue's key
   goes on each of its stories as their `ticket` in `state.yaml`. An epic's
   key goes in `tickets.yaml`.

Commit those files. A card in Ticketing mode shows **New** until its issue has
a key.

## 4. When the map changes

Run the same again. Issues with a key are updated, and only new ones are
created: a story added since gets its own issue, or joins one under the
rules. Jira's statuses don't come back into the map. A story is done when its
scenarios pass. To move tickets to match the map, use `nikos tracker sync`:
see the `tracker` playbook.

## What it leaves out

- **Deleting or closing issues.** If you remove a story from the map, close
  its issue in Jira yourself.
- **Other trackers.** The export is shaped for Jira. Linear or GitHub Issues
  could read the same `tickets.yaml` later.
