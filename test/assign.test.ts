import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { assign } from "../src/commands/assign";
import { groupRepo, write } from "./team-fixture";

const listed = (root: string) => parse(readFileSync(join(root, "maps/chk/assignments.yaml"), "utf8"));
const CHK = (root: string) => join(root, "maps/chk");

describe("nikos assign", () => {
  it("writes an entry for activities, releases, stories, the group's own repo, and the whole map", () => {
    const g = groupRepo();
    assign(g, "Checkout web", { repo: "acme/checkout-web", activities: ["pay"] });
    expect(listed(g)).toEqual([{ team: "Checkout web", repo: "acme/checkout-web", activities: ["pay"] }]);

    const g2 = groupRepo();
    assign(g2, "Checkout web", { repo: "acme/checkout-web", releases: [2] });
    expect(listed(g2)).toEqual([{ team: "Checkout web", repo: "acme/checkout-web", releases: [2] }]);

    const g3 = groupRepo();
    const r = assign(g3, "Checkout web", { repo: "acme/checkout-web", stories: ["PAY-CHK-3"] });
    expect(listed(g3)).toEqual([{ team: "Checkout web", repo: "acme/checkout-web", stories: ["PAY-CHK-3"] }]);
    expect(r.unassigned).toEqual(["PAY-CHK-1", "PAY-CHK-2"]);

    const g4 = groupRepo();
    const whole = assign(g4, "Group team", { repo: "." });
    expect(listed(g4)).toEqual([{ team: "Group team", repo: "." }]);
    expect(whole.stories).toBe(3);
    expect(whole.unassigned).toEqual([]);
  });

  it("refuses two selectors, and an unknown activity, release or story, listing what exists", () => {
    const g = groupRepo();
    expect(() => assign(g, "A", { repo: "acme/a", activities: ["pay"], releases: [1] })).toThrow("give one of --activities, --releases or --stories");
    expect(() => assign(g, "A", { repo: "acme/a", activities: ["refund"] })).toThrow('no activity "refund" in maps/chk/storymap.yaml (have: pay, confirm)');
    expect(() => assign(g, "A", { repo: "acme/a", releases: [3] })).toThrow("no release 3 in maps/chk/storymap.yaml (have: 1, 2)");
    expect(() => assign(g, "A", { repo: "acme/a", stories: ["PAY-CHK-9"] })).toThrow("no story PAY-CHK-9 in maps/chk/storymap.yaml (have: PAY-CHK-1, PAY-CHK-2, PAY-CHK-3)");
    expect(existsSync(join(CHK(g), "assignments.yaml"))).toBe(false);
  });

  it("moving stories from a whole-map entry leaves the others as explicit stories", () => {
    const g = groupRepo();
    assign(g, "Checkout web", { repo: "acme/checkout-web" });
    const r = assign(g, "Checkout api", { repo: "acme/checkout-api", stories: ["PAY-CHK-2"] });
    expect(r.moved).toEqual([{ from: "Checkout web", count: 1 }]);
    expect(listed(g)).toEqual([
      { team: "Checkout web", repo: "acme/checkout-web", stories: ["PAY-CHK-1", "PAY-CHK-3"] },
      { team: "Checkout api", repo: "acme/checkout-api", stories: ["PAY-CHK-2"] },
    ]);
  });

  it("refuses to move a done story unless --include-done, and then moves it", () => {
    const g = groupRepo();
    assign(g, "Checkout web", { repo: "acme/checkout-web", releases: [1] });
    write(join(CHK(g), "state.yaml"), "format_version: 1\nstories:\n  PAY-CHK-1: { status: done }\n  PAY-CHK-2: { status: in_progress }\n  PAY-CHK-3: { status: todo }\n");
    expect(() => assign(g, "Checkout api", { repo: "acme/checkout-api", stories: ["PAY-CHK-1"] })).toThrow(
      "PAY-CHK-1 is done and held by Checkout web: assign won't move a done story (use --include-done)",
    );
    expect(listed(g)).toEqual([{ team: "Checkout web", repo: "acme/checkout-web", releases: [1] }]);

    const r = assign(g, "Checkout api", { repo: "acme/checkout-api", stories: ["PAY-CHK-1"], includeDone: true });
    expect(r.moved).toEqual([{ from: "Checkout web", count: 1 }]);
    expect(listed(g)[0]).toEqual({ team: "Checkout web", repo: "acme/checkout-web", stories: ["PAY-CHK-2"] });
  });

  it("adds to the same repo's entry, and --replace redefines it", () => {
    const g = groupRepo();
    assign(g, "Checkout web", { repo: "acme/checkout-web", releases: [1] });
    const r = assign(g, "Checkout web", { repo: "acme/checkout-web", releases: [2] });
    expect(r.updated).toBe(true);
    expect(r.dropped).toEqual([]);
    expect(listed(g)).toEqual([{ team: "Checkout web", repo: "acme/checkout-web", releases: [1, 2] }]);
    const back = assign(g, "Checkout web", { repo: "acme/checkout-web", releases: [2], replace: true });
    expect(back.dropped).toEqual(["PAY-CHK-1", "PAY-CHK-2"]);
    expect(listed(g)).toEqual([{ team: "Checkout web", repo: "acme/checkout-web", releases: [2] }]);
  });

  it("keeps a team's releases when one more story is assigned to it", () => {
    const g = groupRepo();
    assign(g, "Checkout web", { repo: "acme/checkout-web", releases: [1] });
    assign(g, "Checkout api", { repo: "acme/checkout-api", releases: [2] });
    assign(g, "Checkout api", { repo: "acme/checkout-api", stories: ["PAY-CHK-1"] });
    expect(listed(g)).toEqual([
      { team: "Checkout web", repo: "acme/checkout-web", stories: ["PAY-CHK-2"] },
      { team: "Checkout api", repo: "acme/checkout-api", stories: ["PAY-CHK-1", "PAY-CHK-3"] },
    ]);
  });

  it("needs --map when the group has two maps, and takes the one it's given", () => {
    const g = groupRepo();
    write(join(g, "maps/pay/storymap.yaml"), "format_version: 1\nproject: pay\nkey: PAY\nbet: faster-checkout\nactivities: []\nreleases: []\n");
    expect(() => assign(g, "A", { repo: "acme/a", releases: [1] })).toThrow("several story maps in maps/ (chk, pay): pass --map <id>");
    assign(g, "A", { repo: "acme/a", releases: [1], map: "chk" });
    expect(listed(g)).toEqual([{ team: "A", repo: "acme/a", releases: [1] }]);
  });
});
