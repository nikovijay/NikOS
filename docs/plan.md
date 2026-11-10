# nikOS Plan: the company's planning repo

nikOS Plan keeps a whole company's plan in **one repo**. Each level has a
folder under `planning/`. The design is in
[docs/rfcs/plan-and-spec.md](rfcs/plan-and-spec.md). This page covers what
is built so far: the repo, its areas, key results, bets, check-ins, reviews,
status, validation and settings. The dashboard and delivery from code repos
come in later releases.

```
nikos.settings.yaml               the company's settings and locks
planning/
  company/
    plan.yaml                     name, period (the year), pillars, owner, objectives
    krs/<id>.yaml                 annual key results
    bets/<id>.md
    decisions.md
  departments/<id>/
    plan.yaml                     name, owner, members, objectives
    krs/<id>.yaml                 period: a quarter of the company's year (2027-Q1)
    bets/<id>.md
    settings.yaml                 optional: changes what the company didn't lock
  groups/<id>/
    plan.yaml                     name, department (optional), owner, members
    bets/<id>.md                  no key results
  teams/<KEY>/
    team.yaml                     name, home (a department or group), owner, members
    bets/<id>.md                  no key results, and no plan.yaml
```

## The rules

- **The folder is the level.** There's no `level:` field and no `nikos join`
  between levels. A group names its department, or none when it plans
  straight against the company. A team names its home, a department or a
  group.
- **Key results stop at department level.** Only the company and departments
  have key results. Every level has bets.
- **The company plans by year, departments by quarter.** The company's
  `period` is a year, such as `2027`, and its key results are annual: their
  `period` is the year and they're due on its last day unless you give
  `--by`. A department's key result needs a quarter inside that year
  (`--period 2027-Q1`) and is due at the quarter's end. Groups and teams have
  no period. Their bets have review dates.
- **Ids are unique within the company.** No two areas, key results or bets
  share an id, ignoring case. So a link inside the repo is just the id:
  `--aligns-to one-inbox`, `--kr close-days`.
- **Links go up.** A key result aligns to key results above it, and a bet to
  bets above it. A bet aims at key results at its own level or above. A team's
  bets may align to any department's or group's bet.
- **Settings come down the folders.** The company's are in
  `nikos.settings.yaml` at the root. Each department, group or team can have
  a `settings.yaml` that changes what nobody above it locked.

## Commands

```bash
nikos plan init --name "Acme" --year 2027 --pillars "Growth, Trust"
nikos plan add department finance --name "Finance" --owner Mira
nikos plan add group payments --name "Payments" --department finance
nikos plan add team WEB --name "Checkout web" --home payments
nikos plan kr new revenue --in company --title "Annual recurring revenue" --owner Niko --baseline 0 --target 60000 --unit USD
nikos plan kr new close-days --in finance --title "Median days to close" --owner Mira --baseline 11 --target 7 --unit days --period 2027-Q1 --aligns-to revenue
nikos plan bet new faster-checkout --in payments --owner Sam --hypothesis "…" --review 2027-02-15 --kr close-days
nikos plan checkin close-days 10 --note "First week of auto-match"
nikos plan bet review faster-checkout continue --why "On track"
nikos plan status --in finance
nikos plan validate
nikos plan settings --in WEB
```

`--in` takes `company`, `departments/finance`, `groups/payments` or
`teams/WEB`, or just the id. Without it, the area is the folder you're in.
Check-ins, target changes and reviews find the key result or bet by its id,
wherever it is.

`nikos plan new <story-id>` still starts a new version of a story's plan, as
before. In a planning repo, `nikos planning …` points you to `nikos plan …`.
