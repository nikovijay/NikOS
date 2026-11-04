# Build-loop eval: steps in order, task list kept current

`check.mjs` reads a recorded build-a-story run and fails it when:

- a playbook step runs after a later one (going back to build or verify again
  is the playbook's own loop, so that's allowed), or
- a new step starts without the task list being shown again since the last
  step changed state. A task-list tool call counts, and so does a Markdown
  checklist in the reply for tools that have no task list.

Step 3 counts as two parts, so creating the plan file and then setting
`in_progress` before writing the approach is caught.

Record a run, then check it:

```bash
claude -p "Build the next story" --output-format stream-json --verbose > run.jsonl
node evals/build-loop/check.mjs run.jsonl
```

A Claude Code session transcript (`~/.claude/projects/<repo>/<session>.jsonl`)
works too.

## Results

| Date | Run | Result | Findings |
| --- | --- | --- | --- |
| 2026-11-04 | The NO-10 proof run (`proof-run.md`), checked from its transcript on the build machine | fail | SPL-2: `state set in_progress` ran before the approach was written into the plan, which the agent admitted at the time. In all three stories the checklist was shown once at the start and not again as steps changed. The agent's own task-list tool was refused in that subagent run, and its Markdown fallback wasn't repeated. |

The transcript isn't in the repo; only the result is. A fresh headless run
couldn't be recorded on 2026-11-04 because `claude -p` couldn't log in. Re-run
after `claude login` and add a row.
