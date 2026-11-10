import { describe, it, expect, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyExample, edit as editFile, exampleDir, rootOf } from "./helpers";
import { mapDirs, repoRootOf, resolveStoryMap, storyMapsOf, storyPrefix } from "../src/lib/maps";
import { runMapNew, runMap } from "../src/commands/map";
import { parse } from "yaml";
import { newActivity } from "../src/commands/step";
import { newStory } from "../src/commands/story";
import { setState } from "../src/commands/state";
import { validate, validateGroup } from "../src/commands/validate";
import { doctor } from "../src/commands/doctor";
import { decide } from "../src/commands/decide";
import { betsFor } from "../src/lib/bets";

const write = (path: string, text: string) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};

/** A repo with one map per id: maps/<id>/storymap.yaml, each owned by ACME (so its story ids are ACME-<KEY>-n). */
function groupRepo(maps: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "nikos-group-"));
  for (const id of maps) write(join(root, "maps", id, "storymap.yaml"), `key: ${id.toUpperCase()}\nowner: ACME\nbet: ${id}\nactivities: []\nreleases: []\n`);
  return root;
}

describe("story map resolver", () => {
  it("refuses a repo with intent/, and says to migrate it", () => {
    const mapDir = copyExample();
    const root = join(mapDir, "../..");
    mkdirSync(join(root, "intent"));
    expect(() => resolveStoryMap(root)).toThrow("this repo has intent/: move intent/ to maps/<key>/ by hand, as the release notes describe");
  });

  it("a repo with no maps/ says to init or map new", () => {
    const root = mkdtempSync(join(tmpdir(), "nikos-nomap-"));
    expect(() => resolveStoryMap(root)).toThrow("no story map here: run nikos init, or nikos map new --key K");
  });

  it("uses the one map of a repo, and needs --map for several", () => {
    const one = groupRepo(["chk"]);
    expect(resolveStoryMap(one).id).toBe("chk");
    expect(resolveStoryMap(one, { map: "chk" }).dir).toBe(join(one, "maps", "chk"));

    const two = groupRepo(["chk", "pay"]);
    expect(() => resolveStoryMap(two)).toThrow("several story maps (chk, pay): pass --map <id>");
    expect(resolveStoryMap(two, { map: "pay" }).id).toBe("pay");
    expect(() => resolveStoryMap(two, { map: "ret" })).toThrow('no story map "ret" in maps/ (have: chk, pay)');
  });

  it("takes --map case-insensitively, the key map new prints (HR finds maps/hr)", () => {
    const two = groupRepo(["am", "hr"]);
    expect(resolveStoryMap(two, { map: "HR" }).dir).toBe(join(two, "maps", "hr"));
    expect(resolveStoryMap(two, { map: "HR" }).id).toBe("hr");
    expect(() => resolveStoryMap(two, { map: "ret" })).toThrow('no story map "ret" in maps/ (have: am, hr)');
  });

  it("finds the map a story id is in, and names the id when no map has it", () => {
    const two = groupRepo(["chk", "pay"]);
    write(join(two, "maps/pay/features/a.feature"), "@ACME-PAY-1 @release-1\nFeature: Pay\n");
    write(join(two, "maps/pay/storymap.yaml"), "key: PAY\nactivities: []\nreleases:\n  - number: 1\n    title: One\n    stories: [ACME-PAY-1]\n");
    expect(resolveStoryMap(two, { story: "ACME-PAY-1" }).id).toBe("pay");
    expect(() => resolveStoryMap(two, { story: "ACME-XX-9" })).toThrow("no story map has ACME-XX-9");
    expect(() => resolveStoryMap(two, { story: "ACME-PAY-1", map: "chk" })).toThrow("ACME-PAY-1 is not in maps/chk");
  });

  it("takes a map folder passed directly", () => {
    const two = groupRepo(["chk", "pay"]);
    const ref = resolveStoryMap(join(two, "maps", "pay"));
    expect(ref.id).toBe("pay");
    expect(ref.root).toBe(two);
    expect(repoRootOf(ref.dir)).toBe(two);
  });

  it("lists the maps in a repo", () => {
    const root = groupRepo(["pay", "chk"]);
    expect(mapDirs(root).map((d) => d.split("/").pop())).toEqual(["chk", "pay"]);
    expect(storyMapsOf(root).map((r) => r.id)).toEqual(["chk", "pay"]);
  });
});

/** A repo for story maps, with bet cards in planning/bets/ (a map's bet is checked for form only). */
function newGroup(bets: string[] = ["faster-checkout"]): string {
  const root = mkdtempSync(join(tmpdir(), "nikos-newmap-"));
  for (const b of bets) write(join(root, "planning/bets", `${b}.md`), `---\nid: ${b}\n---\n`);
  return root;
}

/** Run `nikos map new` and return its exit code and error lines. */
function mapNew(args: string[]) {
  const errors: string[] = [];
  const err = vi.spyOn(console, "error").mockImplementation((m: string) => errors.push(m));
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const code = runMapNew(args);
  err.mockRestore();
  log.mockRestore();
  return { code, errors: errors.join("\n") };
}

describe("nikos map new", () => {
  it("makes maps/<id> for a bet, with the folders a new intent/ has", () => {
    const root = newGroup();
    expect(mapNew(["--bet", "faster-checkout", "--key", "CHK", "--dir", root]).code).toBe(0);
    const storymap = parse(readFileSync(join(root, "maps/chk/storymap.yaml"), "utf8"));
    expect(storymap.key).toBe("CHK");
    expect(storymap.bet).toBe("faster-checkout");
    expect(storymap.bets).toBeUndefined();
    expect(storymap.releases).toEqual([{ number: 1, title: "Release 1", stories: [] }]);
    expect(existsSync(join(root, "maps/chk/state.yaml"))).toBe(true);
    for (const sub of ["features", "plans", "approvals"]) expect(existsSync(join(root, "maps/chk", sub, ".gitkeep"))).toBe(true);
    expect(validateGroup(root).errors).toEqual([]);
  });

  it("refuses each bad input with its message", () => {
    const root = newGroup(["faster-checkout"]);
    const ok = ["--bet", "faster-checkout", "--key", "CHK", "--dir", root];
    expect(mapNew(["--bet", "faster-checkout", "--dir", root]).errors).toContain("nikos map new needs --key <KEY>");
    expect(mapNew(["--bet", "Bad Bet", "--key", "CHK", "--dir", root]).errors).toContain("'Bad Bet' is not a bet id");
    expect(mapNew(["--bet", "acme/payments#faster", "--key", "CHK", "--dir", root]).errors).toContain("a map names one bet by its id, not another repo's bet");
    expect(mapNew(["--bet", "no-card", "--key", "NC", "--dir", root]).code).toBe(0);
    expect(mapNew(["--bet", "faster-checkout", "--key", "chk", "--dir", root]).errors).toContain("map key must be uppercase letters and digits, up to 10 (e.g. CHK)");
    expect(mapNew(ok).code).toBe(0);
    expect(mapNew(["--bet", "faster-checkout", "--key", "CHK", "--dir", root]).errors).toContain("map key CHK is already used by maps/chk");
    expect(mapNew(["--bet", "faster-checkout", "--key", "CHK2", "--dir", root]).code).toBe(0);
    expect(mapNew(["--bet", "faster-checkout", "--key", "RET", "--dir", root]).code).toBe(0);
  });

  it("needs no group plan: a repo with no key still gets a map, with ids of its own", () => {
    const root = mkdtempSync(join(tmpdir(), "nikos-nokey-"));
    expect(mapNew(["--key", "CHK", "--dir", root]).code).toBe(0);
    expect(parse(readFileSync(join(root, "maps/chk/storymap.yaml"), "utf8"))).not.toHaveProperty("owner");
    expect(storyPrefix({ root, dir: join(root, "maps/chk"), id: "chk" }, "CHK")).toBe("CHK");
  });

  it("refuses a folder that already exists", () => {
    const root = newGroup();
    mkdirSync(join(root, "maps/chk"), { recursive: true });
    expect(mapNew(["--bet", "faster-checkout", "--key", "CHK", "--dir", root]).errors).toContain("maps/chk already exists");
  });
});

/** A group with one map for a bet, with an activity ready for stories. */
function oneMap(bet = "faster-checkout", key = "CHK"): string {
  const root = newGroup([bet]);
  mapNew(["--bet", bet, "--key", key, "--owner", "ACME", "--dir", root]);
  const id = key.toLowerCase();
  vi.spyOn(console, "log").mockImplementation(() => {});
  newActivity({ title: "Tasks", map: id }, root);
  vi.restoreAllMocks();
  return root;
}

const mapFile = (root: string, id: string, file = "storymap.yaml") => join(root, "maps", id, file);

describe("story ids in a group map", () => {
  it("numbers stories with GROUP-MAP-n, one more each time", () => {
    const root = oneMap();
    expect(newStory({ title: "Add a task", activity: "tasks" }, root).id).toBe("ACME-CHK-1");
    expect(newStory({ title: "Share a task", activity: "tasks" }, root).id).toBe("ACME-CHK-2");
  });

  it("does not reuse the number of a removed story", () => {
    const root = oneMap();
    newStory({ title: "Add a task", activity: "tasks" }, root);
    newStory({ title: "Share a task", activity: "tasks" }, root);
    // Take ACME-CHK-2 out of its release; its state entry is still there.
    write(mapFile(root, "chk"), readFileSync(mapFile(root, "chk"), "utf8").replace("[ACME-CHK-1, ACME-CHK-2]", "[ACME-CHK-1]").replace("stories: [ACME-CHK-1, ACME-CHK-2]", "stories: [ACME-CHK-1]"));
    expect(newStory({ title: "Third task", activity: "tasks" }, root).id).toBe("ACME-CHK-3");
  });

  it("asks for --map when a group has two maps, and picks the one named", () => {
    const root = oneMap();
    mapNew(["--bet", "faster-checkout", "--key", "PAY", "--owner", "ACME", "--dir", root]);
    vi.spyOn(console, "log").mockImplementation(() => {});
    newActivity({ title: "Pay", map: "pay" }, root);
    vi.restoreAllMocks();
    expect(() => newStory({ title: "Add a task", activity: "tasks" }, root)).toThrow("several story maps (chk, pay): pass --map <id>");
    expect(newStory({ title: "Add a task", activity: "tasks", map: "chk" }, root).id).toBe("ACME-CHK-1");
    expect(newStory({ title: "Pay now", activity: "pay", map: "pay" }, root).id).toBe("ACME-PAY-1");
  });

  it("refuses a repo still on intent/", () => {
    const root = rootOf(copyExample());
    mkdirSync(join(root, "intent"));
    expect(() => newStory({ title: "Anything", activity: "getting-started", map: "chk" }, root)).toThrow("this repo has intent/: move intent/ to maps/<key>/ by hand, as the release notes describe");
  });

  it("refuses a story whose id uses the wrong prefix", () => {
    const root = oneMap();
    newStory({ title: "Add a task", activity: "tasks" }, root);
    write(mapFile(root, "chk"), readFileSync(mapFile(root, "chk"), "utf8").replace("ACME-CHK-1", "HT-1"));
    expect(validate(root, "chk").errors.map((e) => e.message)).toContain("story HT-1 must start with ACME-CHK-");
  });

  it("accepts a group-map id tag on a feature", () => {
    const root = oneMap();
    newStory({ title: "Add a task", activity: "tasks" }, root);
    const feature = join(root, "maps/chk/features/tasks/add-a-task.feature");
    expect(readFileSync(feature, "utf8")).toContain("@ACME-CHK-1");
    expect(validate(root, "chk").errors.map((e) => e.message)).not.toContain("has no story id tag");
  });
});

describe("bets in a map", () => {
  it("a map's bet: is its only bet link", () => {
    const map = { bet: "faster-checkout", releases: [{ number: 1, stories: ["ACME-CHK-1"] }] };
    expect(betsFor(map, "ACME-CHK-1")).toEqual({ bets: ["faster-checkout"], from: "map" });
  });

  it("a map with no bet is valid, a bet is checked for form only, and bets on releases or stories are named", () => {
    const root = oneMap();
    write(mapFile(root, "chk"), readFileSync(mapFile(root, "chk"), "utf8").replace("bet: faster-checkout", "bet: no-card"));
    expect(validate(root, "chk").errors.map((e) => e.message).filter((m) => m.includes("no-card"))).toEqual([]);

    write(mapFile(root, "chk"), readFileSync(mapFile(root, "chk"), "utf8").replace(/^bet: .*\n/m, ""));
    expect(validate(root, "chk").errors.map((e) => e.message).filter((m) => m.includes("bet"))).toEqual([]);

    write(mapFile(root, "chk"), "format_version: 1\nproject: chk\nkey: CHK\nbet: faster-checkout\nactivities: []\nreleases:\n  - number: 1\n    title: Release 1\n    bets: [faster-checkout]\n    stories: []\n  - number: 2\n    title: Two\n    story_bets: {}\n    stories: []\n");
    const messages = validate(root, "chk").errors.map((e) => e.message);
    expect(messages).toContain("maps/chk names its bet in bet:, so releases and stories don't name bets: remove bets: from release 1");
  });
});

describe("group validation", () => {
  it("flags a folder that doesn't match its key, and two maps with one key", () => {
    const root = oneMap();
    mapNew(["--bet", "faster-checkout", "--key", "PAY", "--owner", "ACME", "--dir", root]);
    // Rename the folder so it no longer matches its key.
    renameSync(join(root, "maps", "pay"), join(root, "maps", "wrong"));
    expect(validateGroup(root).errors.map((e) => e.message)).toContain("maps/wrong has key 'PAY', so its folder should be maps/pay");

    const dup = oneMap();
    mapNew(["--bet", "faster-checkout", "--key", "RET", "--dir", dup]);
    write(join(dup, "maps/ret/storymap.yaml"), readFileSync(join(dup, "maps/ret/storymap.yaml"), "utf8").replace("key: RET", "key: CHK"));
    expect(validateGroup(dup).errors.map((e) => e.message)).toContain("maps/chk and maps/ret both use key 'CHK'");
  });

  it("doctor reads a group with maps, and counts stories and maps", () => {
    const root = oneMap();
    newStory({ title: "Add a task", activity: "tasks" }, root);
    const story = doctor(root, { offline: true }).find((c) => c.name === "story map");
    expect(story?.found).toBe("1 story in 1 map");
  });
});

describe("nikos map in a group", () => {
  it("bare nikos map still writes the page", () => {
    const root = oneMap();
    const out = join(root, "storymap.html");
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(runMap(["--dir", root, "--out", out])).toBe(0);
    vi.restoreAllMocks();
    expect(readFileSync(out, "utf8")).toContain("<html");
  });
});

describe("decisions in a group", () => {
  it("writes them to decisions.md at the root", () => {
    const root = oneMap();
    decide({ title: "Keep one page", why: "Simpler to read" }, root);
    expect(readFileSync(join(root, "decisions.md"), "utf8")).toContain("Keep one page");
    expect(existsSync(join(root, "maps", "ht"))).toBe(false);
  });
});

describe("review fixes for group maps", () => {
  it("a map's bet: and story_bets: are refused on the map, and bet: in an intent/ map is refused", () => {
    const root = oneMap();
    write(mapFile(root, "chk"), readFileSync(mapFile(root, "chk"), "utf8") + "story_bets:\n  ACME-CHK-1: [faster-checkout]\n");
    expect(validate(root, "chk").errors.map((e) => e.message)).toContain("maps/chk names its bet in bet:, so releases and stories don't name bets: remove story_bets from ACME-CHK-1");

  });

  it("reports a map whose storymap.yaml won't parse, and checks the rest", () => {
    const root = oneMap();
    mapNew(["--bet", "faster-checkout", "--key", "PAY", "--owner", "ACME", "--dir", root]);
    write(mapFile(root, "pay"), "key: [\n  broken: yes\n");
    let errors: { message: string }[] = [];
    expect(() => {
      errors = validateGroup(root).errors;
    }).not.toThrow();
    expect(errors.length).toBeGreaterThan(0);
    expect(doctor(root, { offline: true }).find((c) => c.name === "story map")?.status).toBe("fail");
  });

  it("moves a story to done through its own map when a group has several", () => {
    const root = oneMap();
    mapNew(["--bet", "faster-checkout", "--key", "PAY", "--owner", "ACME", "--dir", root]);
    vi.spyOn(console, "log").mockImplementation(() => {});
    newActivity({ title: "Pay", map: "pay" }, root);
    vi.restoreAllMocks();
    const id = newStory({ title: "Pay now", activity: "pay", map: "pay" }, root).id;
    // A runner config is there, so the run gets as far as the feature lookup.
    write(join(root, "package.json"), "{}");
    write(join(root, "cucumber.mjs"), "export default {};\n");
    setState(id, "in_progress", { dir: root, map: "pay" });
    let message = "";
    try {
      setState(id, "done", { dir: root, map: "pay" });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("stays in_progress: its scenarios couldn't run");
    expect(message).not.toContain("several story maps");
  });
});
