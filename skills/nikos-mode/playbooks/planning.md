# planning

Plan a period, frame or review a bet, check in on key results or open the
planning dashboard. The work is done by the `nikos-planning` skill, which
ships in the Planning pack, not in nikOS itself. This playbook checks the
pack is there and hands over to it.

1. Check the Planning pack is installed: the `nikos-planning` skill is in your skills list. If it isn't, tell the person to install it (Claude Code: `/plugin install nikos-planning@nikos`; Codex and Cursor: install `nikos-planning` from the nikOS marketplace), say planning can't run until they do, and stop.
2. Hand over to the `nikos-planning` skill: say which of its playbooks matches the request, and run every step of it in order.
3. Bets are linked from the story map, not the other way round: when a release or story delivers a bet, it's named in `maps/<key>/storymap.yaml` (`bets:` on the release, or `story_bets:`), and `nikos validate` checks the link.
4. Report every step with its evidence or its skip reason.
