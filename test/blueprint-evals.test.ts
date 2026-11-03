import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { validate } from "../src/commands/validate";
import { clear, featureFor } from "../src/commands/clear";

const outputs = join(__dirname, "../evals/blueprint/outputs");
const runs = existsSync(outputs) ? readdirSync(outputs).sort() : [];

describe("blueprint evals", () => {
  it("has an output for each of the three sample ideas", () => {
    expect(runs).toEqual(["01-plant-water", "02-standup", "03-invoice-chaser"]);
  });

  for (const run of runs) {
    const intent = join(outputs, run, "intent");

    it(`${run}: constitution, story map and features pass validate and CLEAR`, () => {
      expect(validate(intent).errors).toEqual([]);
      const constitution = readFileSync(join(intent, "constitution.md"), "utf8");
      expect(constitution).toMatch(/^## Jobs to be done\n\s*\S/m);
      expect(constitution).toMatch(/^## Founding hypothesis\n\s*We believe/m);

      const map = parse(readFileSync(join(intent, "storymap.yaml"), "utf8"));
      const stories: string[] = map.releases.flatMap((r: any) => r.stories);
      expect(stories.length).toBeGreaterThanOrEqual(3);
      for (const id of stories) {
        const failed = clear(readFileSync(featureFor(id, intent)!, "utf8")).filter((r) => r.status === "fail");
        expect(failed, id).toEqual([]);
      }
    });
  }
});
