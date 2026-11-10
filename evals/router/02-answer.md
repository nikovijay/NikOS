# Router eval 02: a question about the spec

> Note: this run predates the maps/ layout (PR 2b). Paths that say `intent/` are the 0.2 layout, which `nikos migrate maps` (removed in 0.5) moved to `maps/<key>/`. The run was not repeated.

**Prompt:** Why do we store tasks in localStorage instead of a server?

**Expected playbook:** answer

**Pass if:** the agent names `answer`, its task list holds all 5 steps of
`playbooks/answer.md`, and the answer cites `intent/decisions.md` by line.
