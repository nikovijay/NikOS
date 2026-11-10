// nikOS Plan, PR 3 of docs/rfcs/plan-and-spec.md, stage D: nikos join links a code repo to a planning repo.
// The code repo lists itself in planning/repos.yaml on a nikos/join branch for review, and commits
// nikos.plan.yaml (its settings from the plan) on a nikos/link branch. The plan is cloned to a temp folder
// (or --plan-dir is used). main is never touched, a dirty repo is refused, and one repo links one plan.
// Local bare repos stand in for the forge. A code repo's push goes to a local bare repo too (pushurl).
import { describe, it, expect, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeRepoJoin, joinPlanRepo, runJoin } from "../src/commands/join";
import { fetchCopy } from "../src/lib/fetch-copy";
import { nextBranchName, realRun } from "../src/lib/git";
import { hostNameOf } from "../src/lib/forge";
import { addArea, initPlanRepo } from "../src/plan/repo";
import { loadRepos } from "../src/plan/repos";
import { readLink, snapshotHash } from "../src/plan/settings-link";
import { bareOrigin, companyRepo } from "./planning-fixture";
import { codeRepo, commitAll, git, groupRepo, write } from "./repo-fixture";

/** A plan of the old kind on origin: planning/plan.yaml, and no planning/company/. */
function oldPlan(): string {
  const co = mkdtempSync(join(tmpdir(), "nikos-oldplan-"));
  git(co, "init", "-q", "-b", "main");
  git(co, "remote", "add", "origin", "https://github.com/acme/company-plan.git");
  write(join(co, "planning/plan.yaml"), "name: Acme\nlevel: company\nperiod: Q1 2027\npillars: []\n");
  commitAll(co, "old plan");
  return co;
}

/** A new-layout planning repo (planning/company/) on a bare origin, with its main branch pushed. */
function planOnOrigin(): string {
  const plan = mkdtempSync(join(tmpdir(), "nikos-plan-src-"));
  git(plan, "init", "-q", "-b", "main");
  initPlanRepo(plan, { name: "Acme", year: "2027" });
  git(plan, "add", ".");
  git(plan, "commit", "-q", "-m", "plan");
  const origin = bareOrigin();
  git(plan, "remote", "add", "origin", origin);
  git(plan, "push", "-q", "origin", "main");
  return origin;
}

/** A user's checkout of the planning repo on origin, as a person would have it. */
function checkoutOf(origin: string): string {
  const parent = mkdtempSync(join(tmpdir(), "nikos-plan-co-"));
  git(parent, "clone", "-q", origin, "checkout");
  return join(parent, "checkout");
}

const tempJoins = () => readdirSync(tmpdir()).filter((n) => n.startsWith("nikos-join-"));

/** A code repo's pushes go to a local bare repo, so a --push test never reaches the forge. Its fetch url stays the forge's. */
function pushesTo(code: string): string {
  const bare = bareOrigin();
  git(code, "config", "remote.origin.pushurl", bare);
  return bare;
}

describe("nikos join to a planning repo", () => {
  it("links the code repo on a nikos/link branch, lists it on a nikos/join branch, and leaves main alone", () => {
    const origin = planOnOrigin();
    const code = codeRepo();
    const mainBefore = git(code, "rev-parse", "main");
    const r = joinPlanRepo(code, { plan: "acme/company-plan", url: origin })!;
    expect(r.alreadyListed).toBe(false);
    expect(r.branch).toMatch(/^nikos\/join-acme-checkout-web-\d{4}-\d{2}-\d{2}$/);
    expect(r.pushed).toBe(false);
    expect(git(r.where!, "branch", "--show-current")).toBe(r.branch);
    expect(loadRepos(r.where!).repos).toEqual([{ repo: "acme/checkout-web" }]);
    expect(git(r.where!, "log", "-1", "--format=%s")).toBe("nikos: list acme/checkout-web in planning/repos.yaml");
    expect(git(r.where!, "show", "--name-only", "--format=", "HEAD")).toBe("planning/repos.yaml");
    // Nothing reached the plan's origin: no nikos branch there, and main has no list.
    expect(git(origin, "branch", "--list", "nikos/*")).toBe("");
    expect(() => git(origin, "cat-file", "-e", "main:planning/repos.yaml")).toThrow();
    // This repo is on its nikos/link branch, with only the link committed. Its main has not moved.
    expect(r.link).toMatchObject({ branch: "nikos/link", written: true, pushed: false });
    expect(git(code, "branch", "--show-current")).toBe("nikos/link");
    expect(git(code, "log", "-1", "--format=%s")).toBe("nikos: link this repo to acme/company-plan (nikos.plan.yaml)");
    expect(git(code, "show", "--name-only", "--format=", "HEAD")).toBe("nikos.plan.yaml");
    expect(git(code, "rev-parse", "main")).toBe(mainBefore);
    expect(git(code, "status", "--porcelain")).toBe("");
    expect(existsSync(join(code, "planning"))).toBe(false);
    // The link: the plan's url and the commit read, with empty company and owners (no maps, no company file).
    const link = readLink(code)!;
    expect(link.plan).toEqual({ repo: "acme/company-plan", url: origin });
    expect(link.read.commit).toBe(git(origin, "rev-parse", "main"));
    expect(link.company).toEqual([]);
    expect(link.owners).toEqual({});
  });

  it("--push sends both branches: the plan's to its origin, and this repo's link to this repo's origin", () => {
    const origin = planOnOrigin();
    const code = codeRepo();
    const codeOrigin = pushesTo(code);
    const r = joinPlanRepo(code, { plan: "acme/company-plan", url: origin, push: true })!;
    expect(r.pushed).toBe(true);
    expect(git(origin, "branch", "--list", r.branch!)).toContain(r.branch!);
    expect(git(origin, "show", `${r.branch}:planning/repos.yaml`)).toContain("acme/checkout-web");
    expect(() => git(origin, "cat-file", "-e", "main:planning/repos.yaml")).toThrow();
    expect(r.link).toMatchObject({ branch: "nikos/link", written: true, pushed: true });
    expect(git(codeOrigin, "show", "nikos/link:nikos.plan.yaml")).toContain("acme/company-plan");
    expect(git(codeOrigin, "branch", "--list", "main")).toBe("");
  });

  it("a second join of a repo already listed adds nothing and makes no branch, and writes no new link", () => {
    const origin = planOnOrigin();
    const checkout = checkoutOf(origin);
    const code = codeRepo();
    const first = joinPlanRepo(code, { plan: "acme/company-plan", planDir: checkout })!;
    expect(first.where).toBe(checkout);
    expect(git(checkout, "branch", "--show-current")).toBe(first.branch);
    const commits = git(code, "rev-list", "--count", "HEAD");
    const again = joinPlanRepo(code, { plan: "acme/company-plan", planDir: checkout })!;
    expect(again).toMatchObject({ plan: "acme/company-plan", repo: "acme/checkout-web", alreadyListed: true, pushed: false, link: { branch: "nikos/link", written: false, pushed: false } });
    expect(again.branch).toBeUndefined();
    expect(again.link?.stale).toBeFalsy();
    expect(git(checkout, "branch", "--list", "nikos/*").split("\n").filter(Boolean)).toHaveLength(1);
    expect(git(code, "branch", "--list", "nikos/*").split("\n").filter(Boolean)).toHaveLength(1);
    expect(git(code, "rev-list", "--count", "HEAD")).toBe(commits);
    expect(git(code, "status", "--porcelain")).toBe("");
  });

  it("a re-join says when the plan's settings have changed since the link, and still writes nothing", () => {
    const origin = planOnOrigin();
    const checkout = checkoutOf(origin);
    const code = codeRepo();
    joinPlanRepo(code, { plan: "acme/company-plan", planDir: checkout });
    write(join(checkout, "nikos.settings.yaml"), "format_version: 1\napproval:\n  policy: required-for-release\nlocked: [approval.policy]\n");
    const again = joinPlanRepo(code, { plan: "acme/company-plan", planDir: checkout })!;
    expect(again.link).toMatchObject({ written: false, stale: true });
    expect(describeRepoJoin(again)).toContain("Run nikos settings pull to refresh nikos.plan.yaml, then commit it.");
    expect(git(code, "status", "--porcelain")).toBe("");
  });

  it("a repo linked to one plan is refused a join to another, before anything is read or written", () => {
    const origin = planOnOrigin();
    const code = codeRepo();
    joinPlanRepo(code, { plan: "acme/company-plan", url: origin });
    const branchesBefore = git(code, "branch", "--list");
    expect(() => joinPlanRepo(code, { plan: "acme/other-plan", url: origin })).toThrow("already linked to acme/company-plan");
    expect(git(code, "branch", "--list")).toBe(branchesBefore);
    expect(git(code, "status", "--porcelain")).toBe("");
    expect(git(origin, "branch", "--list", "nikos/*")).toBe("");
  });

  it("a repo with uncommitted changes is refused, and nothing is written in either repo", () => {
    const origin = planOnOrigin();
    const code = codeRepo();
    write(join(code, "notes.md"), "not committed\n");
    const before = tempJoins();
    expect(() => joinPlanRepo(code, { plan: "acme/company-plan", url: origin })).toThrow("has changes that aren't committed");
    expect(git(code, "branch", "--show-current")).toBe("main");
    expect(git(code, "branch", "--list", "nikos/*")).toBe("");
    expect(existsSync(join(code, "nikos.plan.yaml"))).toBe(false);
    expect(git(origin, "branch", "--list", "nikos/*")).toBe("");
    expect(tempJoins()).toEqual(before);
  });

  it("the first snapshot takes the company's settings, and each map owner's team chain, from the plan", () => {
    const plan = mkdtempSync(join(tmpdir(), "nikos-plan-src-"));
    git(plan, "init", "-q", "-b", "main");
    initPlanRepo(plan, { name: "Acme", year: "2027" });
    addArea(plan, "department", "finance", { name: "Finance", owner: "Mira" });
    addArea(plan, "team", "WEB", { name: "Checkout web", home: "finance" });
    write(join(plan, "nikos.settings.yaml"), "format_version: 1\napproval:\n  policy: required-for-release\nlocked: [approval.policy]\n");
    write(join(plan, "planning/teams/WEB/settings.yaml"), "format_version: 1\ntracker:\n  project: PAY-TEAM\n");
    git(plan, "add", "-A");
    git(plan, "commit", "-q", "-m", "plan");
    const origin = bareOrigin();
    git(plan, "remote", "add", "origin", origin);
    git(plan, "push", "-q", "origin", "main");
    const code = groupRepo("WEB", codeRepo());
    joinPlanRepo(code, { plan: "acme/company-plan", url: origin });
    const link = readLink(code)!;
    expect(link.company).toEqual([{ rel: "company", data: { format_version: 1, approval: { policy: "required-for-release" }, locked: ["approval.policy"] } }]);
    expect(link.owners).toEqual({ WEB: { levels: [{ rel: "teams/WEB", data: { format_version: 1, tracker: { project: "PAY-TEAM" } } }] } });
    expect(link.sha256).toBe(snapshotHash(link));
    expect(git(code, "status", "--porcelain")).toBe("");
  });

  it("a plan that can't be read is refused, with --push or without, and nothing is written", () => {
    const code = codeRepo();
    const bad = join(tmpdir(), "no-such-plan-nikos-join");
    const before = tempJoins();
    expect(() => joinPlanRepo(code, { plan: "acme/company-plan", url: bad })).toThrow(/^Couldn't read acme\/company-plan: .+ Nothing was written\.$/);
    expect(() => joinPlanRepo(code, { plan: "acme/company-plan", url: bad, push: true })).toThrow(/^Couldn't read acme\/company-plan: .+ Nothing was written\.$/);
    expect(tempJoins()).toEqual(before);
    expect(existsSync(join(code, "planning"))).toBe(false);
    expect(git(code, "status", "--porcelain")).toBe("");
  });
  it("a code repo with no origin can't be listed in a new-layout plan", () => {
    const code = mkdtempSync(join(tmpdir(), "nikos-noorigin-"));
    git(code, "init", "-q", "-b", "main");
    expect(() => joinPlanRepo(code, { plan: "acme/company-plan", url: planOnOrigin() })).toThrow("has no origin");
  });

  it("nikos join refuses a plan of the old kind, and writes nothing", () => {
    const err: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => void err.push(a.join(" ")));
    try {
      const code = codeRepo();
      expect(runJoin(["--dir", code, "--url", oldPlan(), "acme/company-plan"])).toBe(1);
      expect(err.join("\n")).toContain("a plan of the old kind");
      expect(existsSync(join(code, "planning"))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
  it("nikos join to a planning repo that can't be reached writes nothing, and exits 1", () => {
    const code = codeRepo();
    const out: string[] = [];
    const err = vi.spyOn(console, "error").mockImplementation((...a) => void out.push(a.join(" ")));
    try {
      expect(runJoin(["--dir", code, "--url", join(tmpdir(), "no-such-plan-nikos-join"), "acme/company-plan"])).toBe(1);
    } finally {
      err.mockRestore();
    }
    expect(out.join("\n")).toContain("Couldn't read acme/company-plan");
    expect(existsSync(join(code, "planning"))).toBe(false);
  });
  it("a second --push of a repo already proposed is refused: it's named as proposed on its branch, and nothing new is written", () => {
    const origin = planOnOrigin();
    const code = codeRepo();
    pushesTo(code);
    const first = joinPlanRepo(code, { plan: "acme/company-plan", url: origin, push: true })!;
    const before = tempJoins();
    const again = joinPlanRepo(code, { plan: "acme/company-plan", url: origin, push: true })!;
    expect(again).toMatchObject({ plan: "acme/company-plan", repo: "acme/checkout-web", alreadyListed: false, proposed: first.branch, pushed: false, link: { written: false } });
    expect(describeRepoJoin(again)).toBe(`acme/checkout-web is already proposed to acme/company-plan on branch ${first.branch}, on its origin.\nThis repo is already linked to acme/company-plan (nikos.plan.yaml on nikos/link).\nNothing was written.`);
    expect(tempJoins()).toEqual(before);
    expect(git(origin, "branch", "--list", "nikos/*").split("\n").filter(Boolean)).toHaveLength(1);
    expect(git(code, "status", "--porcelain")).toBe("");
  });

  it("a join that can't list the planning repo's branches writes nothing, and says why", () => {
    const checkout = checkoutOf(planOnOrigin());
    git(checkout, "remote", "set-url", "origin", "/no/such/origin-nikos-join");
    expect(() => joinPlanRepo(codeRepo(), { plan: "acme/company-plan", planDir: checkout })).toThrow("Couldn't list the branches on origin");
    expect(git(checkout, "branch", "--show-current")).toBe("main");
    expect(existsSync(join(checkout, "planning/repos.yaml"))).toBe(false);
  });

  it("a new join branch name avoids every name origin has, as well as the local ones", () => {
    const checkout = checkoutOf(planOnOrigin());
    expect(nextBranchName(checkout, "nikos/join-x-2026-11-10", realRun, ["nikos/join-x-2026-11-10"])).toBe("nikos/join-x-2026-11-10-2");
    expect(nextBranchName(checkout, "nikos/join-x-2026-11-10", realRun, [])).toBe("nikos/join-x-2026-11-10");
  });

  it("a code repo whose origin is a local path can't be listed, and says why", () => {
    const code = codeRepo();
    git(code, "remote", "set-url", "origin", bareOrigin());
    expect(() => joinPlanRepo(code, { plan: "acme/company-plan", url: planOnOrigin() })).toThrow("origin is a local path");
    expect(hostNameOf("file:///x/acme/web.git")).toBeUndefined();
    expect(hostNameOf("git@gitlab.com:acme/checkout-api.git")).toBe("gitlab.com");
  });

  it("writes the origin's host, and a url only when origin isn't the plain https one", () => {
    const code = codeRepo();
    git(code, "remote", "set-url", "origin", "git@gitlab.com:acme/checkout-api.git");
    const checkout = checkoutOf(planOnOrigin());
    joinPlanRepo(code, { plan: "acme/company-plan", planDir: checkout });
    expect(loadRepos(checkout).repos).toEqual([{ repo: "acme/checkout-api", host: "gitlab.com", url: "git@gitlab.com:acme/checkout-api.git" }]);
  });

  it("keeps a token out of the entry: an origin with credentials is listed by its host and path only", () => {
    const code = codeRepo();
    git(code, "remote", "set-url", "origin", "https://oauth2:s3cret-token@gitlab.com/acme/checkout-api.git");
    const checkout = checkoutOf(planOnOrigin());
    joinPlanRepo(code, { plan: "acme/company-plan", planDir: checkout });
    expect(loadRepos(checkout).repos).toEqual([{ repo: "acme/checkout-api", host: "gitlab.com" }]);
    expect(readFileSync(join(checkout, "planning/repos.yaml"), "utf8")).not.toContain("s3cret-token");
    expect(readFileSync(join(code, "nikos.plan.yaml"), "utf8")).not.toContain("s3cret-token");
  });

  it("--plan-dir must be a git checkout, and a dirty planning/ is refused", () => {
    const code = codeRepo();
    expect(() => joinPlanRepo(code, { plan: "acme/company-plan", planDir: mkdtempSync(join(tmpdir(), "nikos-notgit-")) })).toThrow("isn't a git repo");
    const checkout = checkoutOf(planOnOrigin());
    write(join(checkout, "planning/notes.md"), "not committed\n");
    expect(() => joinPlanRepo(code, { plan: "acme/company-plan", planDir: checkout })).toThrow("has changes in planning/");
  });

  it("a plan of the old kind is refused with the nikos plan init message: the temp clone goes, and nothing is listed", () => {
    const co = oldPlan();
    const code = codeRepo();
    const before = tempJoins();
    expect(() => joinPlanRepo(code, { plan: "acme/company-plan", url: co })).toThrow("a plan of the old kind");
    expect(() => joinPlanRepo(code, { plan: "acme/company-plan", url: co, push: true })).toThrow("a plan of the old kind");
    expect(tempJoins()).toEqual(before);
    expect(existsSync(join(code, "planning"))).toBe(false);
  });
  it("nikos join takes --push and the repo path after it, and reports where the branch is", () => {
    const origin = planOnOrigin();
    const code = codeRepo();
    pushesTo(code);
    const out: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
    try {
      expect(runJoin(["--dir", code, "--url", origin, "--push", "acme/company-plan"])).toBe(0);
    } finally {
      log.mockRestore();
    }
    expect(out.join("\n")).toMatch(/Pushed nikos\/join-acme-checkout-web-\d{4}-\d{2}-\d{2} to acme\/company-plan\./);
    expect(out.join("\n")).toContain("Pushed nikos/link to this repo's origin.");
    expect(git(origin, "branch", "--list", "nikos/*")).toContain("nikos/join-acme-checkout-web-");
  });
});

describe("fetching a copy of a repo", () => {
  it("reads the default branch when no ref is given, and keeps .git only when asked", () => {
    const src = mkdtempSync(join(tmpdir(), "nikos-trunk-"));
    git(src, "init", "-q", "-b", "trunk");
    write(join(src, "a.txt"), "hello\n");
    git(src, "add", ".");
    git(src, "commit", "-q", "-m", "first");
    const plain = join(mkdtempSync(join(tmpdir(), "nikos-copy-")), "plain");
    const got = fetchCopy(src, undefined, plain);
    expect(got).toMatchObject({ commit: expect.stringMatching(/^[0-9a-f]{40}$/) });
    expect(readFileSync(join(plain, "a.txt"), "utf8")).toBe("hello\n");
    expect(existsSync(join(plain, ".git"))).toBe(false);
    const kept = join(mkdtempSync(join(tmpdir(), "nikos-copy-")), "kept");
    expect(fetchCopy(src, undefined, kept, undefined, { keepGit: true })).toMatchObject({ commit: expect.any(String) });
    expect(existsSync(join(kept, ".git"))).toBe(true);
  });
});
