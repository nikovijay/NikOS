# nikOS Plan: the company's planning repo

nikOS Plan keeps a whole company's plan in **one repo**. Each level has a
folder under `planning/`. The design is in
[docs/rfcs/plan-and-spec.md](rfcs/plan-and-spec.md). This page covers what
is built: the repo, its areas, key results, bets, check-ins, reviews, status,
validation, settings, each bet's delivery from the code repos listed in
`planning/repos.yaml`, and the dashboard (`nikos plan serve`).

```
nikos.settings.yaml               the company's settings and locks
planning/
  repos.yaml                      optional: the code repos whose delivery this plan reads
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
- **A key result can go down.** `--direction down` marks a figure that should
  fall, such as days to close (11 toward 7). Progress is worked out the same
  way both ways, so at 9 it is half way. Past the baseline the page says the
  figure "moved the wrong way" rather than showing a minus sign. A direction
  that points against the target's side is a validate warning, not an error.
  Change the direction with `nikos plan kr direction <id> up|down`.
- **A key result can be a milestone.** `--kind milestone` makes a key result
  of named steps instead of a figure: `--step "Map steps"`, repeated for each
  step, fixed when it's made. Nothing else is set (no baseline, target or
  check-ins). `nikos plan kr step close-process "Map steps" --date 2026-11-10`
  marks one step done, once: its date stays as first written, and a step name
  that doesn't exist is refused. The page shows "2 of 3 steps done", and the
  step form marks the next one. A milestone is stale only when a step was done
  and none has been since `stale_after_days` (default 14). With no step done,
  or every step done, it isn't stale.
- **Text can stand in for a link.** `--ladders-up "reconciliation revenue
  faster"` says what a key result or bet ladders up to, before anyone has
  named the item above it. It's refused on a company key result, which has
  nothing above it, and with a link in the same command. Text alone feeds no
  figure, progress or delivery: status and the page say "not linked yet", and
  validate warns. `nikos plan ladder` lists the unlinked ones. `nikos plan
  ladder <id>` ranks what it could link to by the words it shares with the
  text. A key result can link to key results above it, and a bet to key
  results in the company or a department, or to bets above it. `nikos plan ladder
  accept <id> <candidate>` writes the link, once, through the same checks as
  a hand-written one, and clears the text. `nikos plan ladder clear <id>`
  drops the text when no link is wanted. Nothing is accepted without the
  person's choice.
- **Ids are unique within the company.** No two areas, key results or bets
  share an id, ignoring case. So a link inside the repo is just the id:
  `--aligns-to one-inbox`, `--kr close-days`.
- **Links go up.** A key result aligns to key results above it, and a bet to
  bets above it. A bet aims at any company or department key result, whatever its level. A team's
  bets may align to any department's or group's bet.
- **Settings come down the folders.** The company's are in `nikos.settings.yaml` at the planning repo's root.
  Each department, group or team can change what nobody above it locked. A code
  repo linked to the plan takes the company's settings and its map owner's team
  settings from a committed snapshot, `nikos.plan.yaml`, and its own settings
  file changes only what the plan leaves open. See [docs/settings.md](settings.md).

## Commands

```bash
nikos plan init --name "Acme" --year 2027 --pillars "Growth, Trust"
nikos plan init --name "Acme" --year 2027 --github acme/company-plan   # also a private GitHub repo, as its origin
nikos plan add department finance --name "Finance" --owner Mira
nikos plan add group payments --name "Payments" --department finance
nikos plan add team WEB --name "Checkout web" --home payments
nikos plan kr new revenue --in company --title "Annual recurring revenue" --owner Niko --baseline 0 --target 60000 --unit USD
nikos plan kr new close-days --in finance --title "Median days to close" --owner Mira --baseline 11 --target 7 --unit days --period 2027-Q1 --direction down --aligns-to revenue
nikos plan bet new faster-checkout --in payments --owner Sam --hypothesis "…" --review 2027-02-15 --kr close-days
nikos plan checkin close-days 10 --note "First week of auto-match"
nikos plan checkin close-days 10.5 --date 2027-01-03   # a back-dated check-in goes in date order
nikos plan kr new close-process --in finance --title "Close process" --owner Mira --kind milestone --step "Map steps" --step "Pilot" --step "Roll out" --period 2027-Q1
nikos plan kr step close-process "Map steps" --date 2026-11-10
nikos plan bet review faster-checkout continue --why "On track"
nikos plan ladder                          # what is waiting for a link
nikos plan ladder <id>                     # what it could link to
nikos plan ladder accept <id> <candidate>  # link it, once the person has picked
nikos plan status --in finance
nikos plan status --json
nikos plan validate
nikos plan refresh
nikos plan settings --in WEB
```

`--in` takes `company`, `departments/finance`, `groups/payments` or
`teams/WEB`, or just the id. Without it, the area is the folder you're in.
Check-ins, target changes and reviews find the key result or bet by its id,
wherever it is.

`nikos plan new <story-id>` still starts a new version of a story's plan, as
before. Run it in a code repo.

## Delivery from code repos

A bet's delivery is worked out from the story maps that name it. A code repo
is read by listing it in `planning/repos.yaml`:

```yaml
version: 1
repos:
  - repo: acme/payments-web      # owner/repo, or group/project on GitLab
    host: github.com             # optional: the default is github.com
    ref: main                    # optional: the default is the repo's default branch
    url: https://github.com/acme/payments-web.git   # optional: any git url, such as a local path in tests
```

To list a code repo from its own checkout, run `nikos join <plan repo>` there.
It writes the repo's line into `planning/repos.yaml` on a `nikos/join-…`
branch with one commit, and prints where the branch is and how to open the
review. In the code repo it commits `nikos.plan.yaml` (the settings its maps
take from the plan) on a `nikos/link` branch, and `main` is never touched. It
refuses a repo with uncommitted changes, and a repo already linked to another
plan. It pushes only with `--push`, and `--plan-dir <checkout>` uses a checkout
you already have. `nikos settings pull` refreshes the snapshot. See
[docs/settings.md](settings.md).

`nikos plan refresh` reads each listed repo, read-only, and keeps a copy of
its `maps/<key>/storymap.yaml` and `delivery.yaml` under `.nikos/delivery/`,
which git ignores. It prints one line per repo with how old its copy is. A
repo that can't be read keeps its last good copy and says why the read
failed. A repo that is no longer listed loses its copy.

`nikos plan status` shows each bet under its line:

```
    delivery: Building, 2 of 5 done (1 approved), 1 in progress · acme/payments-web: read today (2026-11-10)
```

A bet with no story map of its own shows the bets below it that have maps,
through `aligns_to`, each on its own line. Figures are never added up across
bets: a map that feeds two bets counts once under each. A cancelled story is
left out. A story that no summary lists yet
counts as to do. `nikos plan status --json` gives the same figures as data,
with each repo's read time as `read_at` as well as its age.

`nikos plan status` and `nikos plan validate` warn, without failing, when:

- a map names a bet this plan doesn't have, such as a misspelt id;
- a map names a bet in another plan (`owner/repo#id`), which isn't counted here;
- a listed repo has never been read, or no repo has been read yet;
- a map's `delivery.yaml` is from a newer nikOS, so it isn't counted.

A bet link to this plan can be written with the id alone, or in full as
`<this plan's repo>#<id>`. The full form needs the planning repo to have an
origin, so nikOS can tell whose bet it is.

## The dashboard

`nikos plan serve` runs the plan's dashboard on 127.0.0.1, one area at a time,
and prints the link to open in your browser. It starts on the company. The link it prints has a private key in it, so
keep the link to yourself.

```bash
nikos plan serve                          # the company, on a free port
nikos plan serve --in departments/finance # start on one area
nikos plan serve --port 4777 --offline    # a fixed port, and no refresh of the code repos
nikos plan serve --export plan.html       # one offline page, for every area
nikos plan serve --export finance.html --in departments/finance   # one offline page, for one area
```

- **Altitude, then area.** The switcher at the top chooses the level: Company,
  Departments, Groups or Teams. The picker beside it chooses the area at that
  level. The breadcrumb shows the way up, for example Company › Finance ›
  Payments › WEB, and each part is a link.
- **One page per area.** The views are Key results (the company and departments
  only), OKRs and bets, Ladder, Bets and Timeline. Groups and teams have no key
  results of their own: their OKRs and bets show the key results their bets aim at.
  Under each key result, OKRs and bets lists the area's own bets that aim at it, then
  other areas' bets that do, each with its area. A company or department lists every
  area's; a group or team lists only the areas below it.
- **The ladder.** Four columns: the key results above the area, the area's key
  results grouped by objective, the area's bets, and the bets above them. Each
  bet shows whether it is its own bet or delivered through the bets below it.
  Long titles are cut short, and a column shows twelve cells, with "+N more"
  for the rest. The ladder can widen to everything above or below the area.
- **Drill down.** From a key result, the bets that aim at it, and the story maps
  that deliver them, with how old each copy is. From a bet, the chain it aligns
  to, the bets below it, and its maps.
- **Not linked yet.** A key result or bet whose `ladders_up` text has no link
  is listed under "Not linked yet" on its area's page, at every level and in the
  offline export. It has no line in the ladder, and no figure counts it. Suggest
  offers to link these, one at a time, with `nikos plan ladder`.
- **Dates.** The timeline lists each bet's start, review and deadline, and each
  key result's due date.
- **Light or dark.** The page follows your browser's setting. The switch at the top
  changes it, and this browser keeps the choice for that address (a dashboard on a
  fixed `--port` keeps it between runs).
- **The place is in the link.** Every link carries the area, for example
  `?at=departments/finance`, so a page can be bookmarked or shared.
- **Saves are small and never pushed.** A key result has a check-in form, with a
  date that is today unless you pick another, and the
  Bets page has a form to add a bet. Each save goes in the area's own folder, on
  a `nikos/plan-<area>-<date>` branch. A bar at the top lists the saved changes:
  Commit commits only those areas' files, and Push is the only thing that sends
  them. Other changes are made with the `nikos plan` commands above.

A dashboard that can't refresh the code repos on start still opens, and says why
at the top of every page. `--offline` skips the refresh.

### The offline page

`--export <file>` writes the dashboard as one HTML file that works with no
server, and the file's own script moves between its pages. Its links keep the
place in the address bar, in both `?at=` and `#at=`, so reloading it shows the
same page.

- **Without `--in`**, the file holds every area's pages.
- **With `--in`**, it holds that area's pages only. A link to another area says
  the page isn't in the file, and `--export` without `--in` includes every area.

The file names the code repos it reads, so share it only with people who may
see them.
