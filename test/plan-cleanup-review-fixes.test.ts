// Review fixes for PR 5 (onboarding and cleanup): a planning repo and a code repo don't take each other's commands.
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newMap } from "../src/commands/map";
import { decide } from "../src/commands/decide";
import { mapStatus } from "../src/commands/map-status";
import { runServeCommand } from "../src/commands/serve";
import { suggest } from "../src/commands/suggest";
import { initPlanRepo } from "../src/plan/repo";
import { specHash } from "../src/lib/project";
import { writeMapSummary } from "../src/lib/map-summary";
import { copyExample, edit, rootOf } from "./helpers";

const scratch = () => mkdtempSync(join(tmpdir(), "nikos-review-"));

describe("a planning repo and a code repo refuse each other's commands", () => {
  it("map new refuses to put a story map in the company's planning repo", () => {
    const dir = scratch();
    initPlanRepo(dir, { name: "Acme", year: "2027" });
    expect(() => newMap({ key: "X" }, dir)).toThrow("This is the company's planning repo");
    expect(existsSync(join(dir, "maps"))).toBe(false);
  });

  it("plan init refuses a code repo, and writes nothing", () => {
    const root = rootOf(copyExample());
    expect(() => initPlanRepo(root, { name: "Acme", year: "2027" })).toThrow("This repo has a story map (maps/ or intent/)");
    expect(existsSync(join(root, "planning"))).toBe(false);
  });

  it("serve shows a code repo's story map even when it has a planning folder too", () => {
    const root = rootOf(copyExample());
    mkdirSync(join(root, "planning", "company"), { recursive: true });
    writeFileSync(join(root, "planning", "company", "plan.yaml"), "name: Acme\n");
    const out = join(scratch(), "map.html");
    expect(runServeCommand(["--dir", root, "--export", out])).toBe(0);
    expect(readFileSync(out, "utf8")).toContain("<html");
  });
});

describe("the next steps and messages name commands that work", () => {
  it("an empty repo is set up with the start flags, not a bare nikos start", () => {
    const setup = suggest(scratch()).options.find((o) => o.label === "Set up nikOS here")!;
    expect(setup.do).toContain('nikos start --map --name "<name>" --key <KEY>');
  });

  it("a code repo's story map step says nikos serve, not the planning dashboard", () => {
    // Done and approved stories put the release check and this step on the list.
    const map = copyExample();
    edit(join(map, "state.yaml"), (s) => s.replace("status: in_progress", "status: done"));
    mkdirSync(join(map, "approvals"), { recursive: true });
    for (const [id, file] of [["HT-1", "add-a-task.feature"], ["HT-2", "see-todays-top-three.feature"]] as const) {
      const hash = specHash(readFileSync(join(map, "features/tasks", file), "utf8"));
      writeFileSync(join(map, "approvals", `${id}.yaml`), `by: Niko\non: 2026-11-06\nspec_hash: "${hash}"\ndone_at: 2026-11-03\n`);
    }
    writeMapSummary(rootOf(map), map);
    const look = suggest(rootOf(map)).options.find((o) => o.label === "Look at the story map")!;
    expect(look.do).toContain("nikos serve");
    expect(look.do).not.toContain("planning dashboard");
  });

  it("map status with no maps names a code repo, not a group repo", () => {
    expect(() => mapStatus(scratch())).toThrow("runs in a code repo with a story map");
  });

  it("decide in an old-layout repo says what is wrong, not to run nikos init", () => {
    const dir = scratch();
    mkdirSync(join(dir, "planning"));
    writeFileSync(join(dir, "planning", "plan.yaml"), "name: Acme\nlevel: company\n");
    expect(() => decide({ title: "Ship it", why: "Because" }, dir)).toThrow("planning/plan.yaml, a plan of the old kind");
  });
});
