// Done, as the planning side counts it: a story whose proof isn't for the current feature isn't done.
import { isDone } from "../lib/project.js";

/** Done, as the plans above count it: a done story whose proof isn't for the current feature isn't. */
export const doneHere = (s: { status: string; proof?: string }) => isDone(s.status) && !s.proof;
