# start

This is the product path: one repo, one story map in `maps/<key>/`. For work shared by a group, see the group path in onboard.md. `nikos migrate maps` moves an existing `intent/` story map into `maps/<key>/`.

Set nikOS up in a repo and get to a first story that's proved done, in one
conversation. Ask as little as possible: nikOS takes the name, key, stack and
host from the repo.

1. Run `nikos start`. It creates the story map in `maps/<key>/`, with `constitution.md` and `decisions.md` at the root, plus a scenario runner for the stack and CI for the host, each only if it's missing. Tell the person what it did in a sentence, not a list of files.
2. Ask only what `nikos start` couldn't tell (its `?` lines), one question at a time, and finish the setup with the answer (`nikos verify setup`, `nikos ci setup --github` or `--gitlab`).
3. If the repo already has code, run the map-existing playbook from here. If it's empty, ask what the product is for and who it's for, then run idea-to-blueprint from its step on the story map.
4. Install the runner `nikos start` named, if it isn't installed, once the person agrees.
5. Pick the first story with `nikos next` and build it with the build-a-story playbook, so the first session ends with one story's scenarios passing and the map showing it done.
6. Report every step with its evidence or its skip reason.
