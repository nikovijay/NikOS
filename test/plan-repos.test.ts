// nikOS Plan, PR 3 of docs/rfcs/plan-and-spec.md, stage B: planning/repos.yaml, the list of code repos a
// planning repo reads delivery from. It is checked by plan validate, read tolerantly, and refused when
// its version is newer than this nikOS reads.
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initPlanRepo } from "../src/plan/repo";
import { planIssues, runPlanRepo } from "../src/plan/cli";
import { addRepo, loadRepos, reposIssues } from "../src/plan/repos";
import { NewerContractError } from "../src/lib/schema";

function planRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "nikos-repos-"));
  initPlanRepo(repo, { name: "Acme", year: "2027" });
  return repo;
}

/** Write planning/repos.yaml as the given text. */
const put = (repo: string, text: string) => writeFileSync(join(repo, "planning/repos.yaml"), text);
const messages = (repo: string) => reposIssues(repo).map((i) => i.message);

describe("planning/repos.yaml", () => {
  it("a planning repo with no file lists no repos, and a file with version 1 is valid", () => {
    const repo = planRepo();
    expect(reposIssues(repo)).toEqual([]);
    expect(loadRepos(repo)).toEqual({ version: 1, repos: [] });
    put(repo, "version: 1\nrepos:\n  - repo: acme/checkout-web\n  - repo: acme/checkout-api\n    host: gitlab.com\n");
    expect(reposIssues(repo)).toEqual([]);
    expect(loadRepos(repo).repos.map((r) => r.repo)).toEqual(["acme/checkout-web", "acme/checkout-api"]);
  });

  it("plan validate reports a bad repo path, names the file, and fails", async () => {
    const repo = planRepo();
    put(repo, "version: 1\nrepos:\n  - repo: checkout-web\n");
    expect(planIssues(repo)).toContainEqual({ file: "planning/repos.yaml", message: expect.stringContaining("repos.0.repo") });
    const out: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
    const err = vi.spyOn(console, "error").mockImplementation((...a) => void out.push(a.join(" ")));
    try {
      expect(await runPlanRepo(["validate", "--dir", repo])).toBe(1);
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
    expect(out.join("\n")).toContain("✗ planning/repos.yaml: repos.0.repo");
  });

  it("unknown fields are accepted, at the root and on each repo", () => {
    const repo = planRepo();
    put(repo, "version: 1\nnote: kept by a newer nikOS\nrepos:\n  - repo: acme/checkout-web\n    owner_team: WEB\n");
    expect(reposIssues(repo)).toEqual([]);
    expect(loadRepos(repo).repos).toEqual([{ repo: "acme/checkout-web", owner_team: "WEB" }]);
  });

  it("a missing version is reported", () => {
    const repo = planRepo();
    put(repo, "repos:\n  - repo: acme/checkout-web\n");
    expect(messages(repo)).toEqual(["missing required field 'version'"]);
  });

  it("a version newer than 1 is refused with the upgrade message, and loading it throws", () => {
    const repo = planRepo();
    put(repo, "version: 2\nrepos: []\n");
    const want = "this repos.yaml was written by a newer nikOS: upgrade nikos in the planning repo";
    expect(messages(repo)).toEqual([want]);
    expect(() => loadRepos(repo)).toThrow(NewerContractError);
    expect(() => loadRepos(repo)).toThrow(want);
  });

  it("a file that doesn't read as YAML is reported, not read as an empty list", () => {
    const repo = planRepo();
    put(repo, "repos: [\n");
    expect(messages(repo)).toEqual(["doesn't read as YAML"]);
    expect(() => loadRepos(repo)).toThrow("planning/repos.yaml doesn't read as YAML");
  });

  it("a repo is listed once, whatever the case of its path", () => {
    const doc = { version: 1 as const, repos: [{ repo: "acme/checkout-web" }] };
    expect(addRepo(doc, { repo: "Acme/Checkout-Web" })).toEqual({ doc, added: false });
    const more = addRepo(doc, { repo: "acme/checkout-api", host: "gitlab.com" });
    expect(more.added).toBe(true);
    expect(more.doc.repos.map((r) => r.repo)).toEqual(["acme/checkout-web", "acme/checkout-api"]);
  });
});
