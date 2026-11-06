# map-existing

Draft the story map from a product that already exists, so a team sees its own
product mapped rather than an empty template. Nothing is written until the
person agrees to the draft.

1. Run `nikos start` if `intent/` doesn't exist yet.
2. Survey the code: entry points, routes or screens, commands, and the tests that exist. Group what the product does into three to seven activities: the areas a person uses it for, in the order they'd use them.
3. Under each activity, list the steps a person takes, and a story for each thing the product already lets them do, in the user's words (As a… I want… So that…), with the files that implement it.
4. Show the draft as activities, steps and stories. Let the person rename, merge, drop or add. Write nothing until they agree.
5. Write it: `nikos activity add` for each activity, `nikos step add` for each step, and `nikos story add` for each story, all in release 1. Remove the starter story `nikos init` made if nobody wants it.
6. For each story, write scenarios that describe what the product does today, and step definitions that drive the real code. Run `nikos verify <story-id>`; when they pass, move the story to done with `nikos state set` (in_progress, then done). A scenario that fails is a finding: show it, and leave the story in_progress.
7. Add a second release for what the person wants next, if they say.
8. Report every step with its evidence or its skip reason, and how many stories are now proved done.
