# Using nikOS as a library

The `nikos` package is also a library: the same rules the CLI follows, for
tools that work with a repo's files without a shell or a checkout. A web app,
a bot or a server can fetch a repo's files from GitHub or GitLab, run nikOS on
them in memory, and commit the files that changed.

```js
import { MemoryStore, withStore, validate, newStory, suggest } from "nikos";

// The repo's files, as your host's API hands them over: path → text.
const repo = new MemoryStore({
  "intent/storymap.yaml": storymapText,
  "intent/state.yaml": stateText,
  // …every file under intent/ (and planning/, if the repo plans with nikOS)
});

const changes = withStore(repo, () => {
  // activity is an activity id from the repo's storymap.yaml (storyMapOf lists them).
  newStory({ title: "Split the bill evenly", activity: "checkout" }, repo.root);
  const problems = validate(repo.root).errors;
  if (problems.length) throw new Error(problems.map((p) => p.message).join("\n"));
  return repo.changes(); // [{ path: "intent/storymap.yaml", text: "…" }, …]
});
// Commit `changes` as one commit, or open a pull or merge request with them.
// repo.deletions() lists the files to delete in the same commit (nikos migrate removes some).
```

Inside `withStore`, every nikOS function reads and writes the store instead of
the disk. Outside it, they use the disk as the CLI does. `repo.root` is the
repo's root path inside the store (`/repo` by default); pass it, or
`<root>/intent`, wherever a function takes a folder.

## What needs a real checkout

Moving a story to done, `approve` and `verify` run the story's Cucumber
scenarios, so they need the code on disk. A tool without a checkout leaves
those to CI: `nikos ci setup` writes a pipeline that runs every story's
scenarios on each pull or merge request. The same goes for cloning upstream
plans (`nikos planning sync`) and the local dashboard.

## What's exported

| Area | Functions |
| --- | --- |
| Storage | `MemoryStore` (with `changes()` and `deletions()`), `withStore`, `diskStore`, `store` |
| Checks | `validate`, `formatResult`, `clear`, `checkRelease` |
| Story map | `init`, `newStory`, `newStep`, `addRelease`, `renameRelease`, `moveStory`, `removeRelease`, `reorderRelease`, `storyMapOf`, `renderMap`, `exportMap` |
| State | `loadStates`, `storyState`, `perStory`, `migrate` |
| Work | `setState`, `next`, `dependencies`, `suggest`, `show`, `newPlan`, `decide`, `findDecisions` |
| Approvals | `loadApprovals`, `approvalLapse` |
| Helpers | `STORY_ID`, `isDone`, `specHash`, `findIntentDir`, `featureFor` |

Types ship with the package.
