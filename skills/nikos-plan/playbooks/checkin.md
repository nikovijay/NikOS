# checkin

Check in on key results in a few seconds, as part of normal work.

1. Run `nikos plan status` and list the key results: title, latest value and date, target, and any marked stale. Use `--in <area>` to see one area.
2. For each key result they want to update, ask for the current value, an optional evidence link and a short note about changes or blockers.
3. Show the check-ins you will add, once, as a list: key result, value, date, link and note. A bet's delivery status never changes a key result's value; only a measured value does.
4. Write only after the person confirms: `nikos plan checkin <kr-id> <value> [--note "<…>"] [--evidence <url>] [--date <yyyy-mm-dd>]` for each.
5. Run `nikos plan status` again and show the new values.
6. Report every step with its evidence or its skip reason.
