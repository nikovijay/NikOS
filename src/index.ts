// nikOS as a library: the rules behind the CLI, for tools that work on a repo's files without a
// shell. Load the files into a MemoryStore, run commands inside withStore, then commit
// store.changes(). Running scenarios (done, approve, verify) needs a real checkout, so tools
// without one leave that to CI.
export { MemoryStore, diskStore, store, withStore, type Store } from "./lib/store.js";
export { STORY_ID, DONE, isDone, specHash, findIntentDir } from "./lib/project.js";
export { loadApprovals, approvalLapse, type Approval } from "./lib/approvals.js";

export { validate, formatResult, type Issue, type ValidationResult } from "./commands/validate.js";
export { init, keyFor, slugify } from "./commands/init.js";
export { newStory, type StoryInput, type StoryResult } from "./commands/story.js";
export { newStep } from "./commands/step.js";
export { addRelease, renameRelease, moveStory, removeRelease, reorderRelease, checkRelease, type ReleaseCheck } from "./commands/release.js";
export { setState, StateError, type Status, type StateResult } from "./commands/state.js";
export { next, dependencies, type NextResult } from "./commands/next.js";
export { suggest, type Option, type Suggestion } from "./commands/suggest.js";
export { show } from "./commands/show.js";
export { clear, featureFor } from "./commands/clear.js";
export { newPlan, planVersions } from "./commands/plan.js";
export { decide } from "./commands/decide.js";
export { decisionEntries, findDecisions } from "./commands/decisions.js";
export { storyMapOf, renderMap, type StoryMap, type MapStory, type MapRelease } from "./commands/map.js";
export { exportMap, FORMATS, type Format } from "./commands/export.js";
