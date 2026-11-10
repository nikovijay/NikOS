# dashboard

Show the plan in the local dashboard, or share a read-only snapshot of it.

1. To view or edit the plan, run `nikos plan serve` in the planning repo (with `--in <area>` to start on one area, for example `departments/finance`). It runs until stopped, so start it in the background and read the link from its first output line. It serves 127.0.0.1 only. Give the person the link it prints.
2. Each save in the dashboard goes in that area's folder, on a `nikos/plan-<area>-<date>` branch named for it. Nothing is pushed until the person clicks Push.
3. The page lists key results and bets whose `ladders_up` text has no link under "Not linked yet". They count in no figure and draw no line. Link them with the ladder playbook, not by editing the page.
4. To share a read-only snapshot, run `nikos plan serve --export <file>.html` (with `--in <area>` for one area, or for every area without it). It is one offline file that can't edit anything. Tell the person what it includes before they send it.
5. Report every step with its evidence or its skip reason.
