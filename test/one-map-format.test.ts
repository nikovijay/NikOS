// One map format: every story map lives in maps/<key>/. A repo still on intent/ is refused with the
// migrate hint, a story id finds its map, and the id prefix comes from the owner, the group key or nothing.
import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../src/commands/init";
import { runMapNew } from "../src/commands/map";
import { validate } from "../src/commands/validate";
import { doctor } from "../src/commands/doctor";
import { resolveStoryMap, storyPrefix, labelOf, type StoryMapRef } from "../src/lib/maps";
import { copyExample, rootOf } from "./helpers";
import { groupRepo, write } from "./repo-fixture";

describe("intent/ is refused, with the migrate hint", () => {
  it("validate and doctor both say to move intent/ by hand", () => {
    const root = rootOf(copyExample());
    mkdirSync(join(root, "intent"));
    expect(() => validate(root)).toThrow("this repo has intent/: move intent/ to maps/<key>/ by hand, as the release notes describe");
    expect(doctor(root, { offline: true }).find((c) => c.name === "story map")!.next).toContain("by hand, as the release notes describe");
  });

  it("init refuses to set up a repo that still has intent/", () => {
    const root = mkdtempSync(join(tmpdir(), "nikos-intent-init-"));
    mkdirSync(join(root, "intent"));
    expect(() => init(root, { name: "Hello Todo" })).toThrow("this repo has intent/: move intent/ to maps/<key>/ by hand, as the release notes describe");
  });
});

describe("the resolver finds a story's map", () => {
  it("by the story id, and names the id when no map holds it", () => {
    const root = groupRepo("PAY");
    write(join(root, "maps/pay/storymap.yaml"), "key: PAY\nactivities: []\nreleases:\n  - number: 1\n    title: One\n    stories: [PAY-PAY-1]\n");
    write(join(root, "maps/pay/features/a/pay.feature"), "@PAY-PAY-1 @release-1\nFeature: Pay\n");
    expect(resolveStoryMap(root, { story: "PAY-PAY-1" }).id).toBe("pay");
    expect(resolveStoryMap(root, { story: "PAY-CHK-1" }).id).toBe("chk");
    expect(() => resolveStoryMap(root, { story: "PAY-XX-9" })).toThrow("no story map has PAY-XX-9");
  });

  it("refuses an id that is in two maps, and names both", () => {
    const root = groupRepo("PAY");
    write(join(root, "maps/pay/storymap.yaml"), "key: PAY\nactivities: []\nreleases:\n  - number: 1\n    title: One\n    stories: [PAY-CHK-1]\n");
    expect(() => resolveStoryMap(root, { story: "PAY-CHK-1" })).toThrow("PAY-CHK-1 is in several story maps (chk, pay)");
  });
});

describe("story id prefixes", () => {
  const solo = (key: string, owner?: string): StoryMapRef => {
    const root = mkdtempSync(join(tmpdir(), "nikos-prefix-"));
    mkdirSync(join(root, "maps", key.toLowerCase()), { recursive: true });
    write(join(root, "maps", key.toLowerCase(), "storymap.yaml"), `key: ${key}\n${owner ? `owner: ${owner}\n` : ""}activities: []\nreleases: []\n`);
    return { root, dir: join(root, "maps", key.toLowerCase()), id: key.toLowerCase() };
  };

  it("is the owner, else nothing, and the label follows it", () => {
    expect(storyPrefix(solo("CHK"), "CHK")).toBe("CHK");
    expect(labelOf(solo("CHK"))).toBe("CHK");
    expect(storyPrefix(solo("CHK", "WEB"), "CHK")).toBe("WEB-CHK");
    expect(labelOf(solo("CHK", "WEB"))).toBe("WEB-CHK");
    const g = groupRepo("PAY");
    expect(labelOf({ root: g, dir: join(g, "maps/chk"), id: "chk" })).toBe("PAY-CHK");
  });

  it("a map with no owner and no group key validates, with bare KEY-n ids", () => {
    const root = mkdtempSync(join(tmpdir(), "nikos-bare-"));
    init(root, { name: "Fixture", key: "FX" });
    expect(validate(root).errors).toEqual([]);
    expect(readFileSync(join(root, "maps/fx/state.yaml"), "utf8")).toContain("FX-1:");
  });

  it("refuses a mix of prefixes in one map, and names each story that doesn't use the map's own", () => {
    const g = groupRepo("PAY");
    write(join(g, "maps/chk/storymap.yaml"), readFileSync(join(g, "maps/chk/storymap.yaml"), "utf8").replace("owner: PAY\n", "owner: WEB\n").replace("PAY-CHK-3", "WEB-CHK-3").replace("stories: [PAY-CHK-1, PAY-CHK-2]", "stories: [WEB-CHK-1, PAY-CHK-2]"));
    const messages = validate(g, "chk").errors.map((e) => e.message);
    expect(messages).toContain("story PAY-CHK-2 must start with WEB-CHK-");
    expect(messages).not.toContain("story WEB-CHK-1 must start with WEB-CHK-");
  });
});

describe("nikos map new in a repo with no planning/", () => {
  it("needs only --key: the story ids are CHK-n, and no bet is checked", () => {
    const root = mkdtempSync(join(tmpdir(), "nikos-solo-map-"));
    const logs: string[] = [];
    const orig = console.log;
    console.log = (m: string) => logs.push(m);
    try {
      expect(runMapNew(["--key", "CHK", "--dir", root])).toBe(0);
    } finally {
      console.log = orig;
    }
    expect(logs).toEqual(["Created maps/chk, story ids CHK-n"]);
    expect(existsSync(join(root, "maps/chk/storymap.yaml"))).toBe(true);
    expect(existsSync(join(root, "planning"))).toBe(false);
  });
});
