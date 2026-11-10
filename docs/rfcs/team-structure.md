# RFC: defining a department's team structure

> **Superseded** by [plan-and-spec.md](plan-and-spec.md). Kept for the record; do not build from it.

**Status:** draft, for review. Design only: nothing here is built yet.

## Summary

A department head needs to say what sits under their department: its groups,
the teams in each, which repo each one plans in, and who leads it. Today
`planning/downstream.yaml` only holds a name and a repo per entry, and only one
level deep per file. This RFC proposes how to describe the structure, how it
maps to repos, what people data it may hold, and a skill playbook that drafts
it from the company's HR system.

Three principles run through all of it:

1. **Repos are the shared, published record.** The structure lives in plain
   text in the department's plan repo, like everything else in `planning/`.
2. **Folders are not access control.** Who can read what is decided by the git
   provider's repo permissions. Anything sensitive goes in a restricted repo,
   never in a folder of a widely read one.
3. **Minimal people data.** Names and roles only. No compensation and no
   personal fields.

## Background

- `plan.yaml` already has `level: company | department | group | team`.
- `planning/upstream.yaml` points up (`nikos join`); `planning/downstream.yaml`
  points down. `nikos planning rollout` reads `downstream.yaml`, clones each
  listed repo read-only, and follows the `downstream.yaml` in each of those, so
  a chain of repos already forms a tree.
- What's missing: a group with no repo of its own can't list its teams; no entry
  says what level it is or who leads it; and there is no way to fill the list
  from the HR system rather than by hand.

## Format options

### Option A: extend `downstream.yaml` (recommended)

Every new field is optional, so every existing file stays valid. An entry gains
`level`, `lead`, optional `members`, and `teams` for the entries below it that
are listed here rather than in a repo of their own.

```yaml
# planning/downstream.yaml in acme/engineering-plan (plan.yaml: level: department)
- name: Payments
  level: group
  lead: { name: Dana Okafor, role: Group lead }
  repo: acme/payments-plan          # the group plans in its own repo, and lists its teams there

- name: Growth
  level: group
  lead: { name: Sam Patel, role: Head of Growth }
  # no repo: the group has no plan of its own, so its teams are listed here
  teams:
    - name: Activation
      level: team
      lead: { name: Lee Chen, role: Engineering manager }
      repo: acme/activation-plan
    - name: Lifecycle
      level: team
      lead: { name: Ana Ruiz, role: Product lead }
      repo: acme/growth-plans
      path: lifecycle                # this team's planning/ folder sits under lifecycle/ in that repo
    - name: Onboarding               # no repo and no lead yet: fine
      level: team
```

Draft schema (`schemas/planning/downstream.schema.json`):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "array",
  "items": { "$ref": "#/$defs/entry" },
  "$defs": {
    "person": {
      "type": "object",
      "required": ["name"],
      "additionalProperties": false,
      "properties": {
        "name": { "type": "string", "minLength": 1 },
        "role": { "type": "string" }
      }
    },
    "entry": {
      "type": "object",
      "required": ["name"],
      "additionalProperties": false,
      "properties": {
        "name":    { "type": "string", "minLength": 1 },
        "level":   { "enum": ["department", "group", "team"] },
        "lead":    { "$ref": "#/$defs/person" },
        "members": { "type": "array", "items": { "$ref": "#/$defs/person" } },
        "repo":    { "type": "string" },
        "ref":     { "type": "string" },
        "host":    { "type": "string" },
        "url":     { "type": "string" },
        "path":    { "type": "string" },
        "teams":   { "type": "array", "items": { "$ref": "#/$defs/entry" } }
      }
    }
  }
}
```

Rules `nikos planning validate` would add:

- `additionalProperties: false` on `person` is the enforcement for minimal
  people data: a file with `salary`, `email` or anything else on a person fails
  validation.
- An entry with a `repo` lists its own children in that repo's
  `downstream.yaml`. It may not also have `teams` here; validate says which
  file the children belong in. One place per level, so two files can't disagree.
- `level`, if given, must sit below this plan's own `level` in `plan.yaml`.
- Names are unique among siblings.

Rollout would treat a `teams` entry like one listed in a repo further down:
same states (no repo yet, unreachable, not joined, joined), and `via` names the
group it sits under.

**For:** one file, which rollout already walks; backward compatible; the
structure and the links to repos can't drift apart.
**Against:** `downstream.yaml` grows from a link list into an org description,
and its name says less about that.

### Option B: a separate `planning/teams.yaml`

A tree of groups and teams with leads and repos, alongside `downstream.yaml`.
Either `downstream.yaml` stays as the rollout list and the two are kept in step
by validate, or `teams.yaml` replaces it and rollout reads the new file.

**For:** a clear name; people data sits in one file, easy to review on its own.
**Against:** two files that can disagree, or a migration of every existing repo;
rollout needs a second reader.

### Option C: each plan describes only itself

Each repo's `plan.yaml` gains `name` and `lead`, and the tree is put together
from the chain by rollout.

**For:** the people closest to a team keep its details.
**Against:** the department head can't lay out the structure before the teams
have repos, which is the situation this RFC is for.

### Recommendation

Option A for the structure. Borrow one idea from C: if a team's own `plan.yaml`
later names its lead, rollout shows any difference from the department's file
rather than picking one (see open questions).

## Repo boundaries

The structure says what exists; repo boundaries say where each plan is kept.
These are separate choices, and nikOS shouldn't fix one layout. Each entry picks
its own:

| Layout | How it's written | Fits when |
|---|---|---|
| A repo per team | `repo:` on each team | Teams need different read access, or run their own story maps and CI |
| A repo per group, teams in folders | `repo:` plus `path:` on each team, same repo | A group plans together and everyone in it can see all of it |
| One repo for the department | the department's own repo, `path:` per group or team | A small department where everyone sees everything |
| Mixed | any of the above, per entry | The usual case |

`path` is new: the folder in the repo that holds that plan's `planning/` (and
its `intent/`), defaulting to the repo root. Today nikOS expects one plan per
repo, so supporting `path` means `join`, `sync`, `rollout` and the CLI's working
directory all need to understand a plan inside a subfolder. That's real work and
could ship after the rest; until then, a repo per plan is the only supported
layout.

**The rule for choosing:** make a separate repo when people need different
**read** access. Within one repo, `CODEOWNERS` and branch protection can require
the right reviewer per folder, so different **approvers** don't need different
repos. Different readers always do.

## Access

- **Folders never stand in for access control.** Anyone who can read a repo can
  read every folder in it, its history, and every fork and clone. Putting a team
  in `restricted/` inside a widely read repo hides nothing.
- **Who can read what is the git provider's repo permissions**: GitHub teams,
  GitLab groups, or whatever the host offers. nikOS reads with the person's own
  git credentials and never widens access.
- **Sensitive structure goes in a restricted repo.** A team that isn't announced
  yet, or a reorg in progress, is not listed in the department's file at all.
  Instead, a restricted repo (for example `acme/engineering-confidential-plan`,
  readable only by the people who should know) lists it in its own
  `downstream.yaml`. The department's rollout never mentions it; the restricted
  repo's rollout does, for the people who can read it.
- **Rollout already behaves correctly here:** a repo it can't clone is reported
  as unreachable, and the playbook says that may only mean the person can't see
  it. That stays true for every new entry type.
- **Snapshots and dashboards** include other repos' content. The existing advice
  (share only with people allowed to see them) applies to the structure too.
- `nikos doctor` could warn when a plan repo that holds people's names is
  public on its host.

## Minimal people data

Allowed on a person: `name` and `role` (free text, like "Engineering manager").
Nothing else, enforced by the schema.

Not allowed, among others: compensation, grade or level, performance data,
employee or HR IDs, personal email or phone, home location, date of birth,
gender or other demographic fields, employment status, manager-only notes.

Why this little: the repo is a shared record that many people read and that
keeps every past version. Anything written there is effectively published to
everyone with read access, forever. Names and roles are what people already see
in a company directory and are enough to know who to talk to about a plan.

By default the structure names each entry's **lead** only. `members` is optional
for departments that want it (see open questions).

## HR import: a proposed skill playbook

A new playbook, `tools/planning/skills/nikos-planning/playbooks/structure.md`,
for "set up our team structure" or "import our teams from Workday". It uses
whatever MCP connector the person already has for the company's headcount system
(Workday, HiBob or BambooHR, for example). nikOS ships no HR integration of its
own and never handles HR credentials.

Proposed steps:

1. **Find the connector.** Check which tools are available. If there's no HR
   connector, say so and offer to build the structure by hand instead. Never ask
   for an API key, password or export file credentials.
2. **Agree the scope.** Read `plan.yaml` for this plan's level and name. Ask
   which org unit in the HR system it matches, and read that unit and the ones
   below it only, with read-only calls.
3. **Map HR units to levels.** HR systems have their own words (division,
   sub-department, cost centre, squad). Show what was found and ask how each
   kind maps to department, group or team, and which to leave out. Cost centres
   and legal entities are usually not teams.
4. **Keep only names and roles.** For each unit take the lead's name and job
   title, and members' names and titles only if the person asked for members.
   Drop every other field as soon as it's read: nothing from the HR response is
   written to disk, not even under `.nikos/`.
5. **Show a draft, write nothing.** Present the proposed `downstream.yaml` as a
   diff against the current one:
   - new entries, changed leads or roles, renamed units;
   - entries in the file that HR no longer has, marked for the person to decide
     on (never removed without a yes);
   - units with no lead, people leading two units, and anything that would fail
     validation.
6. **Ask for repos.** HR doesn't know repos. Keep every existing `repo`, `host`,
   `url` and `path`; for new entries ask, or leave them with no repo yet.
7. **Check the audience.** Before writing any names, say who can read this repo
   (from the host, where the person's access allows it). If it's public, or
   wider than the people in the structure would expect, stop and say so.
8. **Write only on a yes.** After explicit approval, write `downstream.yaml`,
   run `nikos planning validate`, and show the result. Commit and open a pull
   request only if the person asks; never push to the main branch.
9. **Re-running is the same flow.** HR is a source, not the owner. Edits made in
   the repo are kept unless the person accepts the HR value for that entry.
10. **Report every step** with its evidence or its skip reason, as the other
    playbooks do.

## Open questions

1. **Is the department level required?** Some companies go company → team, or
   company → group → team. Proposal: no level is required; `level` is a label
   on each entry and the tree is as deep as the company is. Does anything (the
   dashboard, `company init --departments`, settings inheritance) assume a
   fixed depth?
2. **Where do initiatives sit: under the group or the team?** nikOS has bets but
   no initiatives today. Choices: a group-level bet that several teams' bets
   point at; a new initiative object that lives in the group's plan; or
   initiatives only at team level, with groups just rolling them up. This
   decides whether a group with no repo of its own can hold any planning at all,
   or whether "group with initiatives" implies "group with a repo".
3. **Leads only, or members too?** Members make the structure more useful
   (who's on which team) but put far more names in the repo and go stale faster.
4. **Matching on re-import.** With no HR IDs stored, re-import matches by unit
   name and position in the tree, so a renamed unit looks like one removed and
   one added. Is that acceptable, or is a non-personal unit ID from HR allowed?
5. **Git handles.** A person's git host username would let nikOS suggest
   `CODEOWNERS` rules. It's a work identifier, but it's one more field. In or out?
6. **Disagreement between levels.** If the department's file says Lee leads
   Activation and Activation's own repo says otherwise, rollout shows both.
   Should one ever win?
7. **`path` and plans in subfolders.** Worth the work now, or ship the structure
   with one plan per repo first?
8. **History.** Renames, moves between groups and teams being closed are visible
   in git history. Is that enough, or does a closed team need an explicit
   `closed:` entry so rollout stops reporting it as not joined?
9. **Shared and matrix teams.** A platform team serving two groups: listed once
   with a pointer from the other, or not modelled at all?
