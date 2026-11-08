import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { validateGroup } from "../src/commands/validate";
import { assign } from "../src/commands/assign";
import { groupRepo, write } from "./team-fixture";

describe("validate on a group's assignments", () => {
  it("reports a story held by two teams, naming both", () => {
    const g = groupRepo();
    write(join(g, "maps/chk/assignments.yaml"), "- team: Checkout web\n  repo: acme/checkout-web\n  releases: [1]\n- team: Checkout api\n  repo: acme/checkout-api\n  stories: [PAY-CHK-1]\n");
    const v = validateGroup(g);
    expect(v.errors.map((e) => e.message)).toEqual(["PAY-CHK-1 is assigned to both Checkout web and Checkout api"]);
    expect(v.errors[0].file).toBe("maps/chk/assignments.yaml");
  });

  it("lists the stories nobody has yet, as warnings", () => {
    const g = groupRepo();
    assign(g, "Checkout web", { repo: "acme/checkout-web", releases: [1] });
    const v = validateGroup(g);
    expect(v.errors).toEqual([]);
    expect(v.warnings.map((w) => w.message)).toEqual(["PAY-CHK-3 has no team yet"]);
    expect(v.warnings[0].hint).toBe('nikos assign "<team>" --repo <path> --map chk');
  });

  it("says nothing new when the map has no assignments file", () => {
    const g = groupRepo();
    const v = validateGroup(g);
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
  });

  it("reports a selector that names nothing in the map", () => {
    const g = groupRepo();
    write(join(g, "maps/chk/assignments.yaml"), "- team: A\n  repo: acme/a\n  activities: [refund]\n- team: B\n  repo: acme/b\n  releases: [7]\n");
    expect(validateGroup(g).errors.map((e) => e.message)).toEqual([
      'activity "refund" is not in maps/chk/storymap.yaml',
      "release 7 is not in maps/chk/storymap.yaml",
    ]);
  });
});
