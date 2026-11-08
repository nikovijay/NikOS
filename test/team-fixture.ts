// Fixtures for team tests: a group repo with one map (PAY-CHK, three stories in two releases), and
// a team repo that takes work from it. Both are real git repos, so sync and ls-remote run for real.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Commands under test commit with the person's own git identity. CI machines have none.
process.env.GIT_AUTHOR_NAME ??= "Ada Lovelace";
process.env.GIT_AUTHOR_EMAIL ??= "ada@example.test";
process.env.GIT_COMMITTER_NAME ??= "Ada Lovelace";
process.env.GIT_COMMITTER_EMAIL ??= "ada@example.test";

export function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** Run git with a fixed identity, and return its trimmed stdout. Throws on failure. */
export function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", ["-c", "user.name=Ada Lovelace", "-c", "user.email=ada@example.test", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}

/** A committed feature for one story. The @activity and @release tags place it. */
export function feature(id: string, activity: string, release: number, title: string): string {
  return `@${id} @release-${release} @must @activity-${activity}\nFeature: ${title}\n\n  As a shopper\n  I want to pay for my basket\n  So that I get my order\n\n  @AC1 @must\n  Scenario: AC1 — Paying shows a receipt\n    Given a basket with one item\n    When I pay for it\n    Then I see a receipt\n`;
}

/**
 * A group repo: planning/plan.yaml (level group, key), a bet, and maps/chk with three stories:
 * <KEY>-CHK-1 and -2 in release 1 (activity pay), <KEY>-CHK-3 in release 2 (activity confirm).
 */
export function groupRepo(key = "PAY", dir = mkdtempSync(join(tmpdir(), "nikos-group-"))): string {
  const id = (n: number) => `${key}-CHK-${n}`;
  write(join(dir, "planning/plan.yaml"), `name: Checkout ${key}\nkey: ${key}\nperiod: Q1 2027\nlevel: group\npillars: []\n`);
  write(join(dir, "planning/bets/faster-checkout.md"), "---\nid: faster-checkout\n---\n");
  write(
    join(dir, "maps/chk/storymap.yaml"),
    [
      "format_version: 1",
      "project: chk",
      "key: CHK",
      "bet: faster-checkout",
      "activities:",
      "  - id: pay",
      "    title: Pay",
      "  - id: confirm",
      "    title: Confirm",
      "releases:",
      "  - number: 1",
      "    title: First",
      `    stories: [${id(1)}, ${id(2)}]`,
      "  - number: 2",
      "    title: Second",
      `    stories: [${id(3)}]`,
      "",
    ].join("\n"),
  );
  write(join(dir, "maps/chk/features/pay/pay-by-card.feature"), feature(id(1), "pay", 1, "Pay by card"));
  write(join(dir, "maps/chk/features/pay/pay-by-wallet.feature"), feature(id(2), "pay", 1, "Pay by wallet"));
  write(join(dir, "maps/chk/features/confirm/see-receipt.feature"), feature(id(3), "confirm", 2, "See the receipt"));
  write(join(dir, "maps/chk/state.yaml"), `format_version: 1\nstories:\n  ${id(1)}: { status: todo }\n  ${id(2)}: { status: todo }\n  ${id(3)}: { status: todo }\n`);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "group");
  return dir;
}

/** A team repo: a git repo with an origin, and nikos.team.yaml naming the team (not yet joined to anything). */
export function teamRepo(repo = "acme/checkout-web", name = "Checkout web"): string {
  const dir = mkdtempSync(join(tmpdir(), "nikos-team-"));
  write(join(dir, "package.json"), '{"name":"checkout-web","private":true}\n');
  write(join(dir, "nikos.team.yaml"), `format_version: 1\nname: ${name}\nrepo: ${repo}\ngroups: []\nmembers: []\n`);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "remote", "add", "origin", `https://github.com/${repo}.git`);
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "team");
  return dir;
}

/** Commit whatever changed in a repo. */
export function commitAll(dir: string, message = "change"): void {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "--allow-empty", "-m", message);
}
