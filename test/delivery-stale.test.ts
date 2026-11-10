// validate flags a map's delivery.yaml that no longer says what the map's files say. nikos state set,
// approve, story new and map new write it themselves, so only a hand edit, or a change made outside
// nikOS, leaves it out of date. The plans above read it, so CI goes red until it is written again.
import { describe, it, expect, vi } from "vitest";
import { rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { setState } from "../src/commands/state";
import { approve } from "../src/commands/approve";
import { newStory } from "../src/commands/story";
import { validate } from "../src/commands/validate";
import { readDeliverySummary } from "../src/lib/delivery-summary";
import { groupRepo, write, commitAll } from "./repo-fixture";

vi.mock("../src/commands/verify", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/commands/verify")>();
  return { ...real, verify: vi.fn(() => ({ stack: "js", command: "cucumber-js", status: 0, output: "1 scenario (1 passed)" })) };
});

const deliveryErrors = (r: ReturnType<typeof validate>) => r.errors.filter((e) => e.file === "delivery.yaml");

describe("a map's delivery.yaml is checked against its files", () => {
  it("a map with no delivery.yaml fails, and says to run nikos map status and commit it", () => {
    const g = groupRepo("PAY");
    rmSync(join(g, "maps/chk/delivery.yaml"));
    const errs = deliveryErrors(validate(g, "chk"));
    expect(errs).toEqual([{ file: "delivery.yaml", message: "is missing", hint: "run nikos map status, then commit it" }]);
  });

  it("a state.yaml changed by hand after delivery.yaml was written fails, and names the story", () => {
    const g = groupRepo("PAY");
    write(join(g, "maps/chk/state.yaml"), "format_version: 1\nstories:\n  PAY-CHK-1: { status: done }\n  PAY-CHK-2: { status: todo }\n  PAY-CHK-3: { status: todo }\n");
    const errs = deliveryErrors(validate(g, "chk"));
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toBe("PAY-CHK-1: status is 'todo' in delivery.yaml, but 'done' now");
    expect(errs[0].hint).toBe("run nikos map status, then commit it");
  });

  it("a delivery.yaml that matches the files passes", () => {
    const g = groupRepo("PAY");
    expect(deliveryErrors(validate(g, "chk"))).toEqual([]);
  });

  it("a delivery.yaml that doesn't read against its schema fails with the schema's message", () => {
    const g = groupRepo("PAY");
    writeFileSync(join(g, "maps/chk/delivery.yaml"), "format_version: 2\nmap: chk\nowner: PAY\nread_at: x\nstories: []\n");
    expect(deliveryErrors(validate(g, "chk"))[0].message).toMatch(/format_version/);
  });

  it("state set rewrites it, so validate passes straight after a move", () => {
    const g = groupRepo("PAY");
    setState("PAY-CHK-2", "in_progress", { dir: g });
    expect(deliveryErrors(validate(g, "chk"))).toEqual([]);
    expect(readDeliverySummary(join(g, "maps/chk"))?.stories.find((s) => s.id === "PAY-CHK-2")).toMatchObject({ status: "in_progress" });
  });

  it("approve rewrites it, so the approval shows in the summary straight away", () => {
    const g = groupRepo("PAY");
    setState("PAY-CHK-1", "in_progress", { dir: g });
    setState("PAY-CHK-1", "done", { dir: g });
    approve("PAY-CHK-1", { dir: g, by: "Priya Shah", date: "2027-01-06" });
    expect(deliveryErrors(validate(g, "chk"))).toEqual([]);
    expect(readDeliverySummary(join(g, "maps/chk"))?.stories.find((s) => s.id === "PAY-CHK-1")).toMatchObject({ approval: "approved", approved_by: "Priya Shah" });
  });

  it("a story added with nikos story new is in the summary too, so validate passes", () => {
    const g = groupRepo("PAY");
    newStory({ title: "Add a task", activity: "pay", release: 1 }, g);
    commitAll(g, "story");
    expect(deliveryErrors(validate(g, "chk"))).toEqual([]);
  });

  it("a story that is in the map but missing from the summary says so", () => {
    const g = groupRepo("PAY");
    const path = join(g, "maps/chk/delivery.yaml");
    const summary = parse(readFileSync(path, "utf8"));
    summary.stories = summary.stories.filter((s: { id: string }) => s.id !== "PAY-CHK-3");
    writeFileSync(path, stringify(summary));
    expect(deliveryErrors(validate(g, "chk")).map((e) => e.message)).toEqual(["PAY-CHK-3 is not in delivery.yaml"]);
  });
});
