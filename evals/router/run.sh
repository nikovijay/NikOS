#!/usr/bin/env bash
# Run the router evals headless in Claude Code against a copy of hello-todo.
# Usage: evals/router/run.sh [eval-number]   (default: all)
# Cursor and Codex: copy skills/nikos-mode into the tool's skills folder,
# open a copy of examples/hello-todo, and paste each prompt by hand.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="${EVAL_OUT:-$(mktemp -d)}"
for f in "$root"/evals/router/0${1:-*}-*.md; do
  n="$(basename "$f" .md)"
  dir="$(mktemp -d)"
  cp -R "$root/examples/hello-todo/." "$dir"
  mkdir -p "$dir/.claude/skills"
  cp -R "$root/skills/nikos-mode" "$dir/.claude/skills/"
  sed -i.bak 's/forgetting/forgeting/' "$dir/intent/features/tasks/add-a-task.feature" && rm "$dir/intent/features/tasks/add-a-task.feature.bak"
  prompt="$(sed -n 's/^\*\*Prompt:\*\* //p' "$f")"
  (cd "$dir" && git init -q && claude -p "$prompt" --permission-mode acceptEdits --max-turns 25 < /dev/null > "$out/$n.txt" 2>&1) || true
  echo "$n → $out/$n.txt"
done
