import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { doctor, type Check } from "../src/commands/doctor";
import { memberAdd } from "../src/commands/team";
import { teamRepo, write } from "./team-fixture";

const find = (checks: Check[], name: string) => checks.find((c) => c.name === name);

describe("nikos doctor in a team repo", () => {
  it("says what the team is, and names each of its own maps", () => {
    const t = teamRepo();
    memberAdd(t, "Priya Shah", { role: "Lead", handle: "priya-s" });
    const checks = doctor(t, { offline: true });
    expect(find(checks, "team")).toMatchObject({ status: "ok", found: '"Checkout web", 1 member, 0 groups' });
  });

  it("suggests a CODEOWNERS rule for the lead when there's none", () => {
    const t = teamRepo();
    memberAdd(t, "Priya Shah", { role: "Lead", handle: "priya-s" });
    expect(find(doctor(t, { offline: true }), "approvals")!.next).toBe('Suggest: add "/approvals/ @priya-s" to CODEOWNERS, so a delivery approval needs the lead\'s review');
  });

  it("warns when the runner config doesn't have the team's step definitions folder", () => {
    const t = teamRepo();
    write(join(t, "cucumber.mjs"), 'export default { paths: ["maps/**/features/**/*.feature"] };\n');
    expect(find(doctor(t, { offline: true }), "scenario runner")).toMatchObject({ status: "warn", found: "cucumber.mjs has no test/steps/ folder of step definitions" });
  });

  it("says once that a repo with its own story map isn't a team, with no ok team line", () => {
    const t = teamRepo();
    write(join(t, "intent/storymap.yaml"), "key: HT\n");
    const team = doctor(t, { offline: true }).filter((c) => c.name === "team");
    expect(team.map((c) => c.status)).toEqual(["fail"]);
    expect(team[0].found).toBe("this repo has intent/ or maps/ and nikos.team.yaml: keep one");
  });
});
