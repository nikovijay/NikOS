import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { askOnboarding, setUp, type Ask } from "../src/commands/onboard";
import { realRun, type Runner } from "../src/lib/git";
import { badRepoPath, createArgv, createHostedRepo, hostingFromFlags, hostRepo } from "../src/lib/hosting";
import { runPlanRepo } from "../src/plan/cli";

const root = join(__dirname, "..");

/** Answers in order; records each question and its suggestion. */
const scripted = (answers: string[]) => {
  const asked: { q: string; s?: string }[] = [];
  const ask: Ask = async (q, s) => {
    asked.push({ q, s });
    return answers.shift() ?? "";
  };
  return { ask, asked };
};

/**
 * git runs for real; gh and glab are pretend. With the tool "installed", repo create adds an origin the way
 * gh does, so nothing leaves this computer. Every call is recorded.
 */
function fakeForge(opts: { installed?: boolean; login?: string; fails?: boolean } = {}) {
  const calls: string[][] = [];
  const run: Runner = (cmd, args, cwd) => {
    calls.push([cmd, ...args]);
    if (cmd === "git") return realRun(cmd, args, cwd);
    if (!opts.installed) return { status: 1, stdout: "", stderr: `${cmd}: not found` };
    if (args[0] === "--version") return { status: 0, stdout: `${cmd} version 2.0.0`, stderr: "" };
    if (args[0] === "api") return opts.login ? { status: 0, stdout: cmd === "gh" ? `${opts.login}\n` : JSON.stringify({ username: opts.login }), stderr: "" } : { status: 1, stdout: "", stderr: "not signed in" };
    if (args[0] === "repo" && args[1] === "create") {
      if (opts.fails) return { status: 1, stdout: "", stderr: "HTTP 401: Bad credentials" };
      return realRun("git", ["remote", "add", "origin", `https://example.test/${args[2]}.git`], cwd);
    }
    return { status: 1, stdout: "", stderr: "unexpected" };
  };
  return { run, calls };
}

const pushes = (calls: string[][]) => calls.filter((c) => c.includes("push"));

describe("where a new repo lives", () => {
  it("asks GitHub, GitLab or this computer, suggests the signed-in account, and makes a private repo as origin without pushing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-host-"));
    const { run, calls } = fakeForge({ installed: true, login: "niko" });
    // Plan, name, year, pillars, git repo, GitHub, the suggested path, private, go ahead.
    const { ask, asked } = scripted(["1", "Acme", "2027", "", "", "1", "", "", ""]);
    const a = await askOnboarding(dir, ask, "/nowhere", run);
    const menu = asked.find((x) => x.q.startsWith("Where should the repo live?"))!;
    expect(menu.q).toContain("1  GitHub");
    expect(menu.q).toContain("2  GitLab");
    expect(menu.q).toContain("3  Only on this computer");
    expect(menu.s).toBe("3");
    expect(asked.find((x) => x.q.includes("Its path on GitHub"))!.s).toBe("niko/acme");
    expect(a.hosting).toEqual({ forge: "github", repo: "niko/acme", private: true });
    expect(asked.at(-1)!.q).toContain("On a private GitHub repo, niko/acme, as its origin. Nothing is pushed.");
    // Nothing on GitHub before the yes.
    expect(calls.filter((c) => c[1] === "repo")).toEqual([]);

    const lines = setUp(a, dir, run);
    expect(calls).toContainEqual(["gh", "repo", "create", "niko/acme", "--private", "--source", ".", "--remote", "origin"]);
    expect(realRun("git", ["remote", "get-url", "origin"], dir).stdout.trim()).toBe("https://example.test/niko/acme.git");
    expect(lines).toContain("✓ Made a private GitHub repo, niko/acme, and set it as this repo's origin. Nothing is pushed yet.");
    expect(lines.join("\n")).toContain('Push it when you\'re ready: git add . && git commit -m "Set up nikOS" && git push -u origin HEAD');
    expect(pushes(calls)).toEqual([]);
  });

  it("takes GitLab with a group path and a public repo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-host-"));
    const { run, calls } = fakeForge({ installed: true, login: "niko" });
    const { ask } = scripted(["1", "Acme", "2027", "", "", "2", "acme/platform/plan", "n", ""]);
    const a = await askOnboarding(dir, ask, "/nowhere", run);
    expect(a.hosting).toEqual({ forge: "gitlab", repo: "acme/platform/plan", private: false });
    setUp(a, dir, run);
    expect(calls).toContainEqual(["glab", "repo", "create", "acme/platform/plan", "--public", "--defaultBranch", "main", "--remoteName", "origin"]);
    expect(pushes(calls)).toEqual([]);
  });

  it("without gh, says so, suggests no owner, and gives the command to run instead", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-host-"));
    const { run, calls } = fakeForge({ installed: false });
    const { ask, asked } = scripted(["1", "Acme", "2027", "", "", "1", "acme/company-plan", "", ""]);
    const a = await askOnboarding(dir, ask, "/nowhere", run);
    const path = asked.find((x) => x.q.includes("Its path on GitHub"))!;
    expect(path.q).toContain("gh isn't installed here");
    expect(path.s).toBeUndefined();
    const lines = setUp(a, dir, run).join("\n");
    expect(lines).toContain("! gh isn't installed, so nikOS didn't make a private GitHub repo, acme/company-plan.");
    expect(lines).toContain("gh repo create acme/company-plan --private --source . --remote origin");
    expect(lines).not.toContain("Push it when you're ready");
    expect(calls.filter((c) => c[1] === "repo")).toEqual([]);
    // The plan is still set up, as a local git repo.
    expect(existsSync(join(dir, ".git"))).toBe(true);
    expect(existsSync(join(dir, "planning/company/plan.yaml"))).toBe(true);
  });

  it("when gh fails, says why and what to run", () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-host-"));
    const { run } = fakeForge({ installed: true, fails: true });
    const [made, hosted] = hostRepo(dir, { forge: "github", repo: "acme/plan", private: true }, run);
    expect(made.line).toBe("✓ Made it a git repo");
    expect(hosted.ok).toBe(false);
    expect(hosted.line).toContain("Couldn't make a private GitHub repo, acme/plan: HTTP 401: Bad credentials");
    expect(hosted.line).toContain("gh auth status");
  });

  it("doesn't ask for a repo that already has an origin, and won't replace one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-host-"));
    realRun("git", ["init", "-q", "-b", "main"], dir);
    realRun("git", ["remote", "add", "origin", "https://example.test/acme/plan.git"], dir);
    const { run, calls } = fakeForge({ installed: true, login: "niko" });
    const { ask, asked } = scripted(["1", "Acme", "2027", "", ""]);
    const a = await askOnboarding(dir, ask, "/nowhere", run);
    expect(asked.map((x) => x.q).join("\n")).not.toContain("Where should the repo live?");
    expect(a.hosting).toBeUndefined();
    expect(createHostedRepo(dir, { forge: "github", repo: "acme/other", private: true }, run).line).toContain("already has an origin remote");
    expect(calls.filter((c) => c[1] === "repo")).toEqual([]);
  });

  it("asks for a git repo that has no origin yet", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-host-"));
    realRun("git", ["init", "-q", "-b", "main"], dir);
    const { run } = fakeForge({ installed: true, login: "niko" });
    const { ask, asked } = scripted(["1", "Acme", "2027", "", "3", ""]);
    const a = await askOnboarding(dir, ask, "/nowhere", run);
    expect(asked.map((x) => x.q).join("\n")).toContain("Where should the repo live?");
    expect(a.hosting).toBeUndefined();
  });

  it("rejects a path that isn't owner/name, and asks again", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-host-"));
    const { run } = fakeForge({ installed: true });
    const { ask, asked } = scripted(["1", "Acme", "2027", "", "", "1", "acme/a/b", "acme/plan", "", ""]);
    const a = await askOnboarding(dir, ask, "/nowhere", run);
    expect(asked.some((x) => x.q.startsWith("'acme/a/b' has more than one /."))).toBe(true);
    expect(a.hosting?.repo).toBe("acme/plan");
    expect(badRepoPath("gitlab", "acme/a/b")).toBeUndefined();
    expect(badRepoPath("github", "plan")).toContain("isn't a repo path");
  });
});

describe("the hosting flags", () => {
  const flags = (args: string[]) => {
    const flag = (n: string) => {
      const i = args.indexOf(`--${n}`);
      return i >= 0 ? args[i + 1] : undefined;
    };
    return hostingFromFlags(flag, (n) => args.includes(`--${n}`));
  };

  it("read --github and --gitlab, private unless --public", () => {
    expect(flags([])).toBeUndefined();
    expect(flags(["--github", "acme/plan"])).toEqual({ forge: "github", repo: "acme/plan", private: true });
    expect(flags(["--gitlab", "acme/team/plan", "--public"])).toEqual({ forge: "gitlab", repo: "acme/team/plan", private: false });
    expect(createArgv({ forge: "github", repo: "acme/plan", private: false })).toEqual(["gh", "repo", "create", "acme/plan", "--public", "--source", ".", "--remote", "origin"]);
  });

  it("refuse both forges, a missing path and --public alone", () => {
    expect(() => flags(["--github", "a/b", "--gitlab", "c/d"])).toThrow("Pick one");
    expect(() => flags(["--github", "--public"])).toThrow("--github needs the repo's path");
    expect(() => flags(["--public"])).toThrow("--public goes with");
    expect(() => flags(["--github", "acme/a/b"])).toThrow("more than one /");
  });

  it("plan init refuses a bad path before writing anything", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-host-"));
    const code = await runPlanRepo(["init", "--name", "Acme", "--year", "2027", "--github", "acme/a/b", "--dir", dir]);
    expect(code).toBe(1);
    expect(existsSync(join(dir, "planning"))).toBe(false);
  });
});

describe("the agent playbooks", () => {
  it("tell agents to ask where the repo lives, make it through nikOS, and never push without a yes", () => {
    for (const f of ["skills/nikos-spec/playbooks/onboard.md", "skills/nikos-plan/playbooks/setup.md"]) {
      const text = readFileSync(join(root, f), "utf8");
      expect(text).toContain("GitHub, GitLab, or only on this computer");
      expect(text).toContain("Never pick for them");
      expect(text).toContain("--github <owner/name>");
      expect(text).toMatch(/[Nn]ever push/);
    }
  });
});
