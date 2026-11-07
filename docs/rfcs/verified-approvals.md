# RFC: approvals that prove who approved

**Status:** draft, for review. Design only: nothing here is built yet.

## Summary

`nikos approve` records who approved a story, how (app, chat or terminal) and
the feature it approved (`spec_hash`). An approval lapses when the feature
changes, and `nikos release check` says so. What it records as "who" is the
local `git config user.name`, so it is attribution, not identity: anyone can
set any name. This RFC proposes how an approval is tied to a real account on
GitHub or GitLab, checked where it can't be faked, and refused when the check
can't run.

## Principles

1. **Identity comes from the git provider, not from nikOS.** nikOS doesn't run
   accounts or a server. The provider already knows who reviewed and merged a
   change, and who is allowed to.
2. **Fail closed.** If the approval can't be verified (no token, the API is
   down, the reviewer has left the team), the release check fails. It never
   passes on a guess.
3. **A level below may tighten, never weaken.** A team can ask for more than
   its company does, not less.
4. **Forge-neutral.** The same design on GitHub and GitLab, with the provider
   specific part kept to one small adapter each.

## Roles

| Role | Approves | How the provider enforces it |
| --- | --- | --- |
| Owner | the intent: a story's feature as written | CODEOWNERS on `intent/features/` and the approvals file |
| Verifier | the delivery: this feature, at this tested commit, with this evidence | CODEOWNERS on the approvals file, required review |
| Policy admin | the settings the levels below inherit | CODEOWNERS on `nikos.settings.yaml` |

These are the provider's own teams or groups, named in CODEOWNERS. nikOS reads
them; it doesn't keep a second list.

## How an approval is verified

1. `nikos approve` still writes the approval, now with the commit the scenarios
   passed on and a link to the CI run as evidence, beside `spec_hash`.
2. The approval reaches the default branch only through a pull or merge request
   that the provider requires an approval on (branch protection, CODEOWNERS).
3. A required CI check, `nikos release check --verify`, runs on every pull or
   merge request and on the default branch. For each approval it asks the
   provider's API, with the CI job's own token:
   - which pull or merge request added the approval, and that it was merged;
   - who approved that request, and that they are a current member of the team
     CODEOWNERS names for the approvals file;
   - that the approval's `spec_hash` matches the feature now, and its commit is
     an ancestor of the commit being checked.
4. Any of these failing, or the API not answering, fails the check and names
   the story and the reason.

`--via chat` and the app route stay. They record how the person said yes, and
`release check` labels them "not verified" until step 3 has run.

## Tighten, never weaken

Today a level can change any setting the levels above haven't locked. QA found
that a company could lock `approval.policy` while a team still set
`approval.routes` to the terminal alone. The next release suggests locking both and
`nikos doctor` warns when only the policy is locked. This RFC proposes going
further, even without a lock:

- `approval.policy` may only move up: `off` < `optional` <
  `required-for-release`.
- `approval.routes` may only be narrowed to routes the level above allows. A
  narrower list is stricter, so it is allowed.
- `locked` keeps its meaning: no change at all.

This is a behaviour change, so it would ship behind a release note and a
`nikos doctor` warning for any repo it would affect.

## What it needs to be tested

A passing test needs real provider accounts: an owner, a verifier, a person
who isn't a member, protected branches, and a required check. Until a QA run
has those, approvals are reported as unverified, never as a pass.

## Open questions

1. GitHub and GitLab expose reviews and team membership differently, and
   self-managed GitLab may restrict the CI token. Which API calls each adapter
   needs, and the least scope of token that makes them.
2. Whether verification also runs locally (with the person's own token) or only
   in CI.
3. Merge queues and squash merges: how to find the request that added an
   approval when its commit is rewritten.
4. What happens to past approvals when a verifier leaves the team: keep them as
   valid at the time, or require a new one before the next release.

## Not in scope

- Any nikOS-run account system or server.
- Single sign-on, beyond what the provider already does.
