import { describe, it, expect, vi } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyExample, edit as editFile, exampleDir } from "./helpers";
import { mapDirs, repoRootOf, resolveStoryMap, storyMapsOf } from "../src/lib/maps";
import { isPlanOnly } from "../src/lib/project";
import { runGroup } from "../src/commands/start";
import { runMapNew, runMap } from "../src/commands/map";
import { parse } from "yaml";
import { newActivity } from "../src/commands/step";
import { newStory } from "../src/commands/story";
import { setState } from "../src/commands/state";
import { migrate } from "../src/commands/migrate";
import { validate, validateGroup } from "../src/commands/validate";
import { doctor } from "../src/commands/doctor";
import { delivery } from "../src/planning/delivery";
import { decide } from "../src/commands/decide";
import { betsFor } from "../src/lib/bets";

const write = (path: string, text: string) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};

/** A group repo with a key, and one map per id: maps/<id>/storymap.yaml. */
function groupRepo(maps: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "nikos-group-"));
  write(join(root, "planning/plan.yaml"), "name: Checkout\nkey: ACME\nperiod: Q1\nlevel: group\npillars: []\n");
  for (const id of maps) write(join(root, "maps", id, "storymap.yaml"), `key: ${id.toUpperCase()}\nbet: ${id}\nactivities: []\nreleases: []\n`);
  return root;
}

describe("story map resolver", () => {
  it("resolves an intent/ repo to its own map, as before", () => {
    const intent = copyExample();
    const ref = resolveStoryMap(join(intent, ".."));
    expect(ref.dir).toBe(intent);
    expect(ref.root).toBe(join(intent, ".."));
    expect(ref.id).toBeUndefined();
  });

  it("refuses --map on a repo with intent/", () => {
    const intent = copyExample();
    expect(() => resolveStoryMap(join(intent, ".."), "chk")).toThrow("--map needs a group repo with maps/ (this repo has intent/)");
  });

  it("uses the one map of a group, and needs --map for several", () => {
    const one = groupRepo(["chk"]);
    expect(resolveStoryMap(one).id).toBe("chk");
    expect(resolveStoryMap(one, "chk").dir).toBe(join(one, "maps", "chk"));

    const two = groupRepo(["chk", "pay"]);
    expect(() => resolveStoryMap(two)).toThrow("several story maps in maps/ (chk, pay): pass --map <id>");
    expect(resolveStoryMap(two, "pay").id).toBe("pay");
    expect(() => resolveStoryMap(two, "ret")).toThrow('no story map "ret" in maps/ (have: chk, pay)');
  });

  it("takes --map case-insensitively, the key map new prints (HR finds maps/hr)", () => {
    const two = groupRepo(["am", "hr"]);
    expect(resolveStoryMap(two, "HR").dir).toBe(join(two, "maps", "hr"));
    expect(resolveStoryMap(two, "HR").id).toBe("hr");
    expect(() => resolveStoryMap(two, "ret")).toThrow('no story map "ret" in maps/ (have: am, hr)');
  });

  it("takes a map folder passed directly", () => {
    const two = groupRepo(["chk", "pay"]);
    const ref = resolveStoryMap(join(two, "maps", "pay"));
    expect(ref.id).toBe("pay");
    expect(ref.root).toBe(two);
    expect(repoRootOf(ref.dir)).toBe(two);
  });

  it("refuses a repo with both intent/ and maps/", () => {
    const root = groupRepo(["chk"]);
    write(join(root, "intent", "storymap.yaml"), "key: HT\nactivities: []\nreleases: []\n");
    expect(() => resolveStoryMap(root)).toThrow("this repo has both intent/ and maps/: keep one");
  });

  it("lists maps, and tells a plan-only group from one with maps", () => {
    const root = groupRepo(["pay", "chk"]);
    expect(mapDirs(root).map((d) => d.split("/").pop())).toEqual(["chk", "pay"]);
    expect(storyMapsOf(root).map((r) => r.id)).toEqual(["chk", "pay"]);
    expect(isPlanOnly(root)).toBe(false);
  });
});

/** A group repo made by nikos group init, with bet cards in planning/bets/. */
function newGroup(bets: string[] = ["faster-checkout"]): string {
  const root = mkdtempSync(join(tmpdir(), "nikos-newmap-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  runGroup(["init", "--name", "Checkout", "--key", "ACME", "--dir", root]);
  vi.restoreAllMocks();
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
    expect(mapNew(["--key", "CHK", "--dir", root]).errors).toContain("nikos map new needs --bet <bet-id>");
    expect(mapNew(["--bet", "faster-checkout", "--dir", root]).errors).toContain("nikos map new needs --key <KEY>");
    expect(mapNew(["--bet", "Bad Bet", "--key", "CHK", "--dir", root]).errors).toContain("'Bad Bet' is not a bet id");
    expect(mapNew(["--bet", "acme/payments#faster", "--key", "CHK", "--dir", root]).errors).toContain("a map specs one of this group's bets, not another repo's");
    expect(mapNew(["--bet", "no-card", "--key", "CHK", "--dir", root]).errors).toContain("no planning/bets/no-card.md: create it with nikos planning bet new");
    expect(mapNew(["--bet", "faster-checkout", "--key", "chk", "--dir", root]).errors).toContain("map key must be uppercase letters and digits, up to 10 (e.g. CHK)");
    expect(mapNew(ok).code).toBe(0);
    expect(mapNew(["--bet", "faster-checkout", "--key", "CHK", "--dir", root]).errors).toContain("map key CHK is already used by maps/chk");
    expect(mapNew(["--bet", "faster-checkout", "--key", "CHK2", "--dir", root]).code).toBe(0);
    expect(mapNew(["--bet", "faster-checkout", "--key", "RET", "--dir", root]).code).toBe(0);
  });

  it("refuses a company plan and a group with no key", () => {
    const root = newGroup();
    const dir = mkdtempSync(join(tmpdir(), "nikos-company-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    runGroup(["init", "--name", "Checkout", "--key", "ACME", "--dir", dir]);
    vi.restoreAllMocks();
    write(join(dir, "planning/bets/faster-checkout.md"), "---\nid: faster-checkout\n---\n");
    // A company plan: same bet card, level company.
    writeFileSync(join(dir, "planning/plan.yaml"), "name: Acme\nlevel: company\nperiod: Q1\npillars: []\n");
    expect(mapNew(["--bet", "faster-checkout", "--key", "CHK", "--dir", dir]).errors).toContain("planning/plan.yaml is not a group plan");
    writeFileSync(join(root, "planning/plan.yaml"), "name: Checkout\nlevel: group\nperiod: Q1\npillars: []\n");
    expect(mapNew(["--bet", "faster-checkout", "--key", "CHK", "--dir", root]).errors).toContain("planning/plan.yaml has no key: add key: <KEY> to it, then retry");
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
  mapNew(["--bet", bet, "--key", key, "--dir", root]);
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
    mapNew(["--bet", "faster-checkout", "--key", "PAY", "--dir", root]);
    vi.spyOn(console, "log").mockImplementation(() => {});
    newActivity({ title: "Pay", map: "pay" }, root);
    vi.restoreAllMocks();
    expect(() => newStory({ title: "Add a task", activity: "tasks" }, root)).toThrow("several story maps in maps/ (chk, pay): pass --map <id>");
    expect(newStory({ title: "Add a task", activity: "tasks", map: "chk" }, root).id).toBe("ACME-CHK-1");
    expect(newStory({ title: "Pay now", activity: "pay", map: "pay" }, root).id).toBe("ACME-PAY-1");
  });

  it("refuses --map on a legacy repo", () => {
    const intent = copyExample();
    expect(() => newStory({ title: "Anything", activity: "getting-started", map: "chk" }, join(intent, ".."))).toThrow("--map needs a group repo with maps/ (this repo has intent/)");
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

  it("a map with no bet is valid, a bet with no card is named, and bets on releases or stories are named", () => {
    const root = oneMap();
    write(mapFile(root, "chk"), readFileSync(mapFile(root, "chk"), "utf8").replace("bet: faster-checkout", "bet: no-card"));
    expect(validate(root, "chk").errors.map((e) => e.message)).toContain("maps/chk names bet no-card, which has no planning/bets/no-card.md");

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
    mapNew(["--bet", "faster-checkout", "--key", "PAY", "--dir", root]);
    // Rename the folder so it no longer matches its key.
    renameSync(join(root, "maps", "pay"), join(root, "maps", "wrong"));
    expect(validateGroup(root).errors.map((e) => e.message)).toContain("maps/wrong has key 'PAY', so its folder should be maps/pay");

    const dup = oneMap();
    mapNew(["--bet", "faster-checkout", "--key", "RET", "--dir", dup]);
    write(join(dup, "maps/ret/storymap.yaml"), readFileSync(join(dup, "maps/ret/storymap.yaml"), "utf8").replace("key: RET", "key: CHK"));
    expect(validateGroup(dup).errors.map((e) => e.message)).toContain("maps/chk and maps/ret both use key 'CHK'");
  });

  it("flags a group with no key", () => {
    const root = oneMap();
    write(join(root, "planning/plan.yaml"), "name: Checkout\nlevel: group\nperiod: Q1\npillars: []\n");
    expect(validateGroup(root).errors.map((e) => e.message)).toContain("has no key");
  });

  it("doctor reads a group with maps, and counts stories and maps", () => {
    const root = oneMap();
    newStory({ title: "Add a task", activity: "tasks" }, root);
    const story = doctor(root, { offline: true }).find((c) => c.name === "story map");
    expect(story?.found).toBe("1 story in 1 map");
  });
});

describe("delivery across maps", () => {
  it("counts the stories of every map that specs the bet", () => {
    const root = oneMap();
    mapNew(["--bet", "faster-checkout", "--key", "PAY", "--dir", root]);
    vi.spyOn(console, "log").mockImplementation(() => {});
    newActivity({ title: "Pay", map: "pay" }, root);
    vi.restoreAllMocks();
    newStory({ title: "Add a task", activity: "tasks", map: "chk" }, root);
    newStory({ title: "Pay now", activity: "pay", map: "pay" }, root);
    const d = delivery(root, "faster-checkout");
    expect(d).toMatchObject({ status: "Building", done: 0, total: 2 });
    expect(d.maps).toEqual(["chk", "pay"]);
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
  it("writes them to planning/decisions.md", () => {
    const root = oneMap();
    decide({ title: "Keep one page", why: "Simpler to read" }, root);
    expect(readFileSync(join(root, "planning/decisions.md"), "utf8")).toContain("Keep one page");
    expect(existsSync(join(root, "intent"))).toBe(false);
  });
});

describe("review fixes for group maps", () => {
  it("a map's bet: and story_bets: are refused on the map, and bet: in an intent/ map is refused", () => {
    const root = oneMap();
    write(mapFile(root, "chk"), readFileSync(mapFile(root, "chk"), "utf8") + "story_bets:\n  ACME-CHK-1: [faster-checkout]\n");
    expect(validate(root, "chk").errors.map((e) => e.message)).toContain("maps/chk names its bet in bet:, so releases and stories don't name bets: remove story_bets from ACME-CHK-1");

    const intent = copyExample();
    editFile(join(intent, "storymap.yaml"), (text) => `bet: faster-checkout\n${text}`);
    expect(validate(intent).errors.map((e) => e.message)).toContain("intent/ names bets in releases: bet: is only for maps/<id>");
  });

  it("reads a repo folder named maps/ as an intent/ repo", () => {
    const base = mkdtempSync(join(tmpdir(), "nikos-named-"));
    const root = join(base, "maps");
    cpSync(exampleDir, root, { recursive: true });
    expect(resolveStoryMap(join(root, "intent")).id).toBeUndefined();
    expect(resolveStoryMap(join(root, "intent")).root).toBe(root);
    expect(validate(join(root, "intent")).errors).toEqual([]);
  });

  it("reports a group with no key once, with no false prefix errors", () => {
    const root = oneMap();
    write(join(root, "planning/plan.yaml"), "name: Checkout\nlevel: group\nperiod: Q1\npillars: []\n");
    const messages = validateGroup(root).errors.map((e) => e.message);
    expect(messages.filter((m) => m === "has no key")).toHaveLength(1);
    expect(messages.some((m) => m.includes("must start with"))).toBe(false);
  });

  it("reports a map whose storymap.yaml won't parse, and checks the rest", () => {
    const root = oneMap();
    mapNew(["--bet", "faster-checkout", "--key", "PAY", "--dir", root]);
    write(mapFile(root, "pay"), "key: [\n  broken: yes\n");
    let errors: { message: string }[] = [];
    expect(() => {
      errors = validateGroup(root).errors;
    }).not.toThrow();
    expect(errors.length).toBeGreaterThan(0);
    expect(doctor(root, { offline: true }).find((c) => c.name === "story map")?.status).toBe("fail");
  });

  it("leaves a cancelled story out of a bet's total", () => {
    const root = oneMap();
    newStory({ title: "Add a task", activity: "tasks" }, root);
    newStory({ title: "Share a task", activity: "tasks" }, root);
    setState("ACME-CHK-2", "cancelled", { dir: root, map: "chk", reason: "Not needed" });
    expect(delivery(root, "faster-checkout").total).toBe(1);
  });

  it("moves a story to done through its own map when a group has several", () => {
    const root = oneMap();
    mapNew(["--bet", "faster-checkout", "--key", "PAY", "--dir", root]);
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

  it("carries a CODEOWNERS rule for a group map's approvals", () => {
    const root = oneMap();
    write(join(root, "CODEOWNERS"), "maps/chk/approvals.yaml @acme/payments\n");
    const r = migrate(root, "per-story", "chk");
    expect(r.codeowners).toBe(join(root, "CODEOWNERS"));
    expect(readFileSync(join(root, "CODEOWNERS"), "utf8")).toContain("maps/chk/approvals/ @acme/payments");
  });
});
