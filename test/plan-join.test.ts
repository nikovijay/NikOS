// nikOS Plan, PR 3 of docs/rfcs/plan-and-spec.md, stage B: nikos join to a planning repo. A code repo
// lists itself in planning/repos.yaml on a nikos/join branch for review. The plan is cloned to a temp
// folder (or --plan-dir is used), and nothing is written to the code repo. A plan of the old kind is
// refused. Local bare repos stand in for the forge.
import { describe, it, expect, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeRepoJoin, joinPlanRepo, runJoin } from "../src/commands/join";
import { fetchCopy } from "../src/lib/fetch-copy";
import { nextBranchName, realRun } from "../src/lib/git";
import { hostNameOf } from "../src/lib/forge";
import { initPlanRepo } from "../src/plan/repo";
import { loadRepos } from "../src/plan/repos";
import { bareOrigin, companyRepo } from "./planning-fixture";
import { codeRepo, commitAll, git, write } from "./repo-fixture";

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

describe("nikos join to a planning repo", () => {
  it("lists the code repo on a nikos/join branch, and leaves main and the code repo alone", () => {
    const origin = planOnOrigin();
    const code = codeRepo();
    const r = joinPlanRepo(code, { plan: "acme/company-plan", url: origin })!;
    expect(r.alreadyListed).toBe(false);
    expect(r.branch).toMatch(/^nikos\/join-acme-checkout-web-\d{4}-\d{2}-\d{2}$/);
    expect(r.pushed).toBe(false);
    expect(git(r.where!, "branch", "--show-current")).toBe(r.branch);
    expect(loadRepos(r.where!).repos).toEqual([{ repo: "acme/checkout-web" }]);
    expect(git(r.where!, "log", "-1", "--format=%s")).toBe("nikos: list acme/checkout-web in planning/repos.yaml");
    expect(git(r.where!, "show", "--name-only", "--format=", "HEAD")).toBe("planning/repos.yaml");
    // Nothing reached the origin: no nikos branch there, and main has no list.
    expect(git(origin, "branch", "--list", "nikos/*")).toBe("");
    expect(() => git(origin, "cat-file", "-e", "main:planning/repos.yaml")).toThrow();
    // The code repo has not been written to.
    expect(existsSync(join(code, "planning"))).toBe(false);
    expect(git(code, "status", "--porcelain")).toBe("");
  });

  it("--push sends the branch to the plan's origin, and still leaves main alone", () => {
    const origin = planOnOrigin();
    const r = joinPlanRepo(codeRepo(), { plan: "acme/company-plan", url: origin, push: true })!;
    expect(r.pushed).toBe(true);
    expect(git(origin, "branch", "--list", r.branch!)).toContain(r.branch!);
    expect(git(origin, "show", `${r.branch}:planning/repos.yaml`)).toContain("acme/checkout-web");
    expect(() => git(origin, "cat-file", "-e", "main:planning/repos.yaml")).toThrow();
  });

  it("a second join of a repo already listed adds nothing and makes no branch", () => {
    const origin = planOnOrigin();
    const checkout = checkoutOf(origin);
    const code = codeRepo();
    const first = joinPlanRepo(code, { plan: "acme/company-plan", planDir: checkout })!;
    expect(first.where).toBe(checkout);
    expect(git(checkout, "branch", "--show-current")).toBe(first.branch);
    const again = joinPlanRepo(code, { plan: "acme/company-plan", planDir: checkout })!;
    expect(again).toEqual({ plan: "acme/company-plan", repo: "acme/checkout-web", alreadyListed: true, pushed: false });
    expect(git(checkout, "branch", "--list", "nikos/*").split("\n").filter(Boolean)).toHaveLength(1);
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
  it("a second --push of a repo already proposed is refused: it's named as proposed on its branch, and nothing is written", () => {
    const origin = planOnOrigin();
    const code = codeRepo();
    const first = joinPlanRepo(code, { plan: "acme/company-plan", url: origin, push: true })!;
    const before = tempJoins();
    const again = joinPlanRepo(code, { plan: "acme/company-plan", url: origin, push: true })!;
    expect(again).toEqual({ plan: "acme/company-plan", repo: "acme/checkout-web", alreadyListed: false, proposed: first.branch, pushed: false });
    expect(describeRepoJoin(again)).toBe(`acme/checkout-web is already proposed to acme/company-plan on branch ${first.branch}, on its origin. Nothing was written.`);
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
    const out: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
    try {
      expect(runJoin(["--dir", code, "--url", origin, "--push", "acme/company-plan"])).toBe(0);
    } finally {
      log.mockRestore();
    }
    expect(out.join("\n")).toMatch(/Pushed nikos\/join-acme-checkout-web-\d{4}-\d{2}-\d{2} to acme\/company-plan\./);
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
