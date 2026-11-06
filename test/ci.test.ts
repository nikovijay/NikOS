import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { detectHost, setupCi } from "../src/commands/ci";

const { version } = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8"));
const repo = (files: Record<string, string>, origin?: string) => {
  const root = mkdtempSync(join(tmpdir(), "nikos-ci-"));
  spawnSync("git", ["init", "-q"], { cwd: root });
  if (origin) spawnSync("git", ["remote", "add", "origin", origin], { cwd: root });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  return root;
};
const read = (root: string, rel: string) => readFileSync(join(root, rel), "utf8");

describe("ci setup", () => {
  it("tells GitHub from GitLab by the origin remote", () => {
    expect(detectHost(repo({}, "git@github.com:acme/app.git"))).toBe("github");
    expect(detectHost(repo({}, "https://gitlab.com/acme/product/app.git"))).toBe("gitlab");
    expect(detectHost(repo({}, "git@gitlab.acme.internal:acme/app.git"))).toBe("gitlab");
    expect(detectHost(repo({}))).toBeUndefined();
    expect(() => setupCi(repo({ "package.json": "{}" }))).toThrow("Say which: --github or --gitlab");
  });

  it("writes a GitHub workflow that runs validate and every scenario with this nikos version", () => {
    const root = repo({ "package.json": "{}", "package-lock.json": "{}" }, "git@github.com:acme/app.git");
    expect(setupCi(root)).toEqual({ host: "github", created: [".github/workflows/nikos.yml"], skipped: [] });
    const wf = parse(read(root, ".github/workflows/nikos.yml"));
    expect(Object.keys(wf.on)).toEqual(["pull_request", "push"]);
    expect(wf.jobs.nikos.steps.map((s: any) => s.run).filter(Boolean)).toEqual(["npm ci", `npx -y nikos@${version} validate`, `npx -y nikos@${version} verify`]);
    expect(setupCi(root).skipped).toEqual([".github/workflows/nikos.yml"]);
  });

  it("writes a GitLab job for merge requests and includes it, for a Python repo", () => {
    const root = repo({ "requirements.txt": "flask\n" }, "https://gitlab.com/acme/app.git");
    expect(setupCi(root)).toEqual({ host: "gitlab", created: [".gitlab/ci/nikos.yml", ".gitlab-ci.yml"], skipped: [] });
    expect(parse(read(root, ".gitlab-ci.yml"))).toEqual({ include: [{ local: ".gitlab/ci/nikos.yml" }] });
    const job = parse(read(root, ".gitlab/ci/nikos.yml")).nikos;
    expect(job.image).toBe("python:3.12");
    expect(job.rules).toEqual([{ if: '$CI_PIPELINE_SOURCE == "merge_request_event"' }, { if: "$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH" }]);
    expect(job.script.slice(1)).toEqual(["pip install -r requirements.txt", "pip install behave", `npx -y nikos@${version} validate`, `npx -y nikos@${version} verify`]);
  });

  it("leaves an existing .gitlab-ci.yml alone and says what to add", () => {
    const root = repo({ "package.json": "{}", ".gitlab-ci.yml": "stages: [test]\n" });
    const r = setupCi(root, { host: "gitlab" });
    expect(r.created).toEqual([".gitlab/ci/nikos.yml"]);
    expect(r.todo).toBe("Add this to .gitlab-ci.yml:\ninclude:\n  - local: .gitlab/ci/nikos.yml\n");
    expect(read(root, ".gitlab-ci.yml")).toBe("stages: [test]\n");
    expect(existsSync(join(root, ".github"))).toBe(false);
  });
});
