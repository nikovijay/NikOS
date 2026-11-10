# checkin

Check in on key results in a few seconds, as part of normal work.

1. Run `nikos plan status` and list the key results: title, latest value and date, target, and any marked stale. Use `--in <area>` to see one area. List milestones with their steps to do, not as values.
2. For each key result they want to update, ask for the current value, an optional evidence link and a short note about changes or blockers. A key result marked "should go down" improves as its value falls. A value past the baseline is "moved the wrong way": say so, and don't read it as progress.
3. Show the check-ins you will add, once, as a list: key result, value, date, link and note. A bet's delivery status never changes a key result's value; only a measured value does.
4. Write only after the person confirms: `nikos plan checkin <kr-id> <value> [--note "<…>"] [--evidence <url>] [--date <yyyy-mm-dd>]` for each.
5. A milestone is not checked in with a value, and `checkin` refuses one. When the person says a step is done, confirm the step's name, then run `nikos plan kr step <kr-id> "<step name>" [--date <yyyy-mm-dd>]`, once per step. A step can be marked only once, and its date stays as first written. A name that isn't on the list is refused, so don't guess one.
6. Run `nikos plan status` again and show the new values.
7. Report every step with its evidence or its skip reason.
