// The text edits to a feature file, on the real template feature (its id filled in). Each edit keeps
// the rest of the file, and the file still passes the lint the commands run.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lintFeature } from "../src/lint/gherkin";
import { addCriterion, criteriaOf, editCriterion, editStoryText, narrativeOf, nextCriterion, priorityOf, removeCriterion, setNarrative, setPersonas, setPlacement, setPriority, setType, setTitle, titleOf } from "../src/lib/feature-edit";
import { specHash } from "../src/lib/project";

const TEMPLATE = join(__dirname, "../templates/map/features/getting-started/first-story.feature");
const template = () => readFileSync(TEMPLATE, "utf8").replace(/\{\{first_id\}\}/g, "PAY-CHK-1");

/** The lint errors a file has (warnings are not checked here). */
const errors = (text: string) => lintFeature(text).filter((i) => i.level === "error");

describe("reading a feature", () => {
  it("gives the narrative parts without their leading words, and the criteria with their steps", () => {
    const text = template();
    expect(narrativeOf(text)).toEqual({ asA: "a first user", iWant: "to do the one thing this product is for", soThat: "I get the value it promises" });
    expect(priorityOf(text)).toBe("must");
    const [c] = criteriaOf(text);
    expect(c).toMatchObject({ ac: "AC1", title: "The core action works", priority: "must", given: ["I am a new user"], when: ["I do the one thing this product is for"], then: ["I see the result I came for"] });
  });
});

describe("story fields", () => {
  it("changes the title and keeps the tags and the rest of the file", () => {
    const text = template();
    const next = editStoryText(text, { title: "Pay by card" });
    expect(next.split("\n")[0]).toBe(text.split("\n")[0]);
    expect(next).toContain("Feature: Pay by card");
    expect(next.split("\n").slice(3)).toEqual(text.split("\n").slice(3));
    expect(specHash(next)).not.toBe(specHash(text));
    expect(errors(next)).toEqual([]);
  });

  it("writes the narrative lines, adding the article the file needs and dropping a repeated lead-in", () => {
    const text = template();
    expect(setNarrative(text, { asA: "first user" })).toContain("  As a first user");
    expect(setNarrative(text, { asA: "an admin" })).toContain("  As an admin");
    expect(setNarrative(text, { iWant: "I want to pay" })).toContain("  I want to pay");
    expect(setNarrative(text, { soThat: "So that I'm paid" })).toContain("  So that I'm paid");
    const next = editStoryText(text, { asA: "an admin", iWant: "to pay", soThat: "I get paid" });
    expect(errors(next)).toEqual([]);
    expect(narrativeOf(next)).toEqual({ asA: "an admin", iWant: "to pay", soThat: "I get paid" });
  });

  it("adds a narrative line the file lacks, just after Feature:", () => {
    const text = template().replace("  So that I get the value it promises\n", "");
    const next = setNarrative(text, { soThat: "I get paid" });
    expect(next).toContain("  So that I get paid");
    expect(next.indexOf("So that")).toBeGreaterThan(next.indexOf("Feature:"));
  });

  it("refuses a blank narrative part or a line break in it", () => {
    expect(() => setNarrative(template(), { asA: "  " })).toThrow('The "As a" line needs some words');
    expect(() => setNarrative(template(), { iWant: "a\nb" })).toThrow("I want is one line");
  });

  it("sets the type: technical and bug-risk add a tag after the story id, user story removes it", () => {
    const text = template();
    const tech = setType(text, "technical");
    expect(tech.split("\n")[0]).toBe("@PAY-CHK-1 @type-technical @release-1 @must @activity-getting-started");
    expect(errors(tech)).toEqual([]);
    expect(setType(tech, "bug_risk").split("\n")[0]).toContain("@type-bug-risk");
    expect(setType(tech, "user_story")).toBe(text);
    expect(() => setType(text, "epic" as any)).toThrow("'epic' is not a story type");
  });

  it("sets the personas to exactly the ids given, in order, and clears them with none", () => {
    const text = template();
    const two = setPersonas(text, ["ana", "ben"]);
    expect(two.split("\n")[0]).toBe("@PAY-CHK-1 @persona-ana @persona-ben @release-1 @must @activity-getting-started");
    expect(errors(two)).toEqual([]);
    expect(setPersonas(two, ["ben"]).split("\n")[0]).toBe("@PAY-CHK-1 @persona-ben @release-1 @must @activity-getting-started");
    expect(setPersonas(two, [])).toBe(text);
    expect(() => setPersonas(text, ["Ana Lee"])).toThrow("'Ana Lee' is not a persona id");
  });

  it("sets the priority tag on the feature only, not on its criteria", () => {
    const text = template();
    const should = setPriority(text, "should");
    expect(priorityOf(should)).toBe("should");
    expect(should).toContain("  @AC1 @must");
    expect(errors(should)).toEqual([]);
    expect(() => setPriority(text, "urgent")).toThrow("'urgent' is not a priority (must, should or could)");
  });

  it("refuses wont: the lint has no such priority, so a story can't be saved with it", () => {
    expect(() => setPriority(template(), "wont")).toThrow("'wont' is not a priority (must, should or could)");
    expect(() => editStoryText(template(), { priority: "wont" })).toThrow("'wont' is not a priority");
  });

  it("sets the activity and step, and a blank step clears it", () => {
    const text = template();
    const placed = setPlacement(text, { activity: "checkout", step: "pay" });
    expect(placed.split("\n")[0]).toBe("@PAY-CHK-1 @release-1 @must @activity-checkout @step-pay");
    expect(errors(placed)).toEqual([]);
    expect(setPlacement(placed, { activity: "checkout", step: "" }).split("\n")[0]).toBe("@PAY-CHK-1 @release-1 @must @activity-checkout");
    expect(() => setPlacement(text, { activity: "Check Out" })).toThrow("'Check Out' is not an activity id");
  });

  it("applies several fields in one edit and passes the lint", () => {
    const next = editStoryText(template(), { title: "Pay", type: "technical", personas: ["ana"], priority: "could", asA: "a cashier" });
    expect(next.split("\n")[0]).toBe("@PAY-CHK-1 @persona-ana @type-technical @release-1 @could @activity-getting-started");
    expect(errors(next)).toEqual([]);
  });

  it("refuses a blank title with the story's message", () => {
    expect(() => editStoryText(template(), { title: " " })).toThrow("A story needs a title");
  });
});

describe("criteria", () => {
  it("numbers a new criterion one past the highest, with its steps and the story's priority", () => {
    const text = template();
    expect(nextCriterion(text)).toBe("AC2");
    const next = addCriterion(text, { title: "Shows an error", given: ["the card is declined"], when: ["I pay", "I retry"], then: ["I see the error", "the order stays open"] });
    expect(next).toContain("  @AC2 @must\n  Scenario: AC2 — Shows an error\n    Given the card is declined\n    When I pay\n    And I retry\n    Then I see the error\n    And the order stays open\n");
    expect(errors(next)).toEqual([]);
    expect(criteriaOf(next).map((c) => c.ac)).toEqual(["AC1", "AC2"]);
    expect(criteriaOf(next)[1]).toMatchObject({ given: ["the card is declined"], when: ["I pay", "I retry"], then: ["I see the error", "the order stays open"] });
  });

  it("takes the given keyword off lines typed with one, and drops a blank given", () => {
    const next = addCriterion(template(), { title: "Typed", given: ["", "Given  I am here"], when: ["When I act"], then: ["Then it works"] });
    expect(next).toContain("    Given I am here\n    When I act\n    Then it works");
  });

  it("refuses a criterion with no When or no Then, or a blank title", () => {
    expect(() => addCriterion(template(), { title: "x", when: [], then: ["y"] })).toThrow("A criterion needs a When step");
    expect(() => addCriterion(template(), { title: "x", when: ["a"], then: [] })).toThrow("A criterion needs a Then step");
    expect(() => addCriterion(template(), { title: " ", when: ["a"], then: ["b"] })).toThrow("A criterion needs a title");
  });

  it("edits a criterion's title, priority and steps, and keeps its label and other tags", () => {
    const text = editCriterion(template(), "AC1", { title: "Pays", priority: "should", given: [], when: ["I pay"], then: ["I see a receipt"] });
    expect(text).toContain("  @AC1 @should\n  Scenario: AC1 — Pays\n    When I pay\n    Then I see a receipt");
    expect(errors(text)).toEqual([]);
    const tagged = template().replace("  @AC1 @must", "  @AC1 @flaky @must");
    expect(editCriterion(tagged, "AC1", { title: "x", when: ["a"], then: ["b"] })).toContain("  @AC1 @flaky @must");
  });

  it("refuses to edit a criterion the story does not have", () => {
    expect(() => editCriterion(template(), "AC9", { title: "x", when: ["a"], then: ["b"] })).toThrow("AC9 is not a criterion of this story");
  });

  it("removes a criterion without renumbering the others, and keeps at least one", () => {
    const two = addCriterion(template(), { title: "Second", when: ["I act"], then: ["it works"] });
    const three = addCriterion(two, { title: "Third", when: ["I act again"], then: ["it still works"] });
    const removed = removeCriterion(three, "AC2");
    expect(criteriaOf(removed).map((c) => c.ac)).toEqual(["AC1", "AC3"]);
    expect(removed).not.toContain("AC2");
    expect(removed.endsWith("\n")).toBe(true);
    expect(removed).not.toMatch(/\n\n\n/);
    expect(errors(removed)).toEqual([]);
    expect(() => removeCriterion(template(), "AC1")).toThrow("A story keeps at least one criterion");
  });
});

describe("a save changes only what it names", () => {
  it("keeps the narrative lines as the file writes them when the value is the same", () => {
    const indented = template().replace(/^  (As|I want|So that) /gm, "    $1 ");
    expect(editStoryText(indented, { asA: "a first user", iWant: "to do the one thing this product is for", soThat: "I get the value it promises" })).toBe(indented);
    const alice = template().replace("  As a first user", "  As Alice");
    expect(setNarrative(alice, { asA: "Alice" })).toBe(alice);
    expect(setNarrative(alice, { asA: "Bob" })).toContain("  As a Bob");
  });

  it("keeps the Feature line as it is when the title is the same", () => {
    const text = template().replace("Feature: First story", "Feature:  First story");
    expect(titleOf(text)).toBe("First story");
    expect(editStoryText(text, { title: "First story" })).toBe(text);
    expect(setTitle(template(), "Second")).toContain("Feature: Second");
  });

  it("keeps a tag line as it is when its tags don't change", () => {
    const text = template().replace("@PAY-CHK-1 @release-1 @must @activity-getting-started", "@PAY-CHK-1   @release-1  @must @activity-getting-started");
    expect(setPriority(text, "must")).toBe(text);
    expect(setType(text, "user_story")).toBe(text);
  });

  it("adds no priority tag to a criterion that has none, and a blank priority keeps the criterion's own", () => {
    const bare = template().replace("  @AC1 @must", "  @AC1");
    const edited = editCriterion(bare, "AC1", { title: "Pays", when: ["I pay"], then: ["I see a receipt"] });
    expect(edited).toContain("  @AC1\n  Scenario: AC1 — Pays\n");
    expect(criteriaOf(edited)[0].priority).toBeUndefined();
    expect(errors(edited)).toEqual([]);
    expect(editCriterion(template(), "AC1", { title: "Pays", priority: "", when: ["I pay"], then: ["I see a receipt"] })).toContain("  @AC1 @must\n");
  });
});

describe("comments and other scenarios stay put", () => {
  it("keeps a comment between two criteria when one of them is edited or removed", () => {
    const two = addCriterion(template(), { title: "Second", when: ["I act"], then: ["it works"] }).replace("  @AC2", "  # keep this note for the reviewer\n  @AC2");
    const edited = editCriterion(two, "AC1", { title: "Pays", when: ["I pay"], then: ["I see a receipt"] });
    expect(edited).toContain("  # keep this note for the reviewer\n  @AC2");
    expect(errors(edited)).toEqual([]);
    const removed = removeCriterion(two, "AC1");
    expect(removed).toContain("  # keep this note for the reviewer\n  @AC2");
    expect(errors(removed)).toEqual([]);
  });

  it("keeps a comment after the last scenario and a rule heading between two criteria", () => {
    const text = template() + "\n  # TODO check the receipt wording\n";
    expect(editCriterion(text, "AC1", { title: "Pays", when: ["I pay"], then: ["I see a receipt"] })).toContain("  # TODO check the receipt wording");
    const ruled = addCriterion(template(), { title: "Second", when: ["I act"], then: ["it works"] }).replace("\n  @AC2", "\n  Rule: a rule heading\n\n  @AC2");
    const edited = editCriterion(ruled, "AC1", { title: "Pays", when: ["I pay"], then: ["I see a receipt"] });
    expect(edited).toContain("  Rule: a rule heading");
    expect(criteriaOf(edited).map((c) => c.ac)).toEqual(["AC1", "AC2"]);
  });

  it("keeps the Examples of an outline when another criterion is edited, and refuses to edit the outline", () => {
    const outline = addCriterion(template(), { title: "Outline", when: ["I act with <n>"], then: ["I see <n>"] }).replace(
      "  Scenario: AC2 — Outline\n    When I act with <n>\n    Then I see <n>",
      "  Scenario Outline: AC2 — Outline\n    When I act with <n>\n    Then I see <n>\n\n    Examples:\n      | n |\n      | 1 |",
    );
    expect(() => editCriterion(outline, "AC2", { title: "x", when: ["a"], then: ["b"] })).toThrow("AC2 is a Scenario Outline, so its steps can't be edited here");
    const removed = removeCriterion(outline, "AC2");
    expect(removed).not.toContain("Examples");
    expect(criteriaOf(removed).map((c) => c.ac)).toEqual(["AC1"]);
  });

  it("counts criteria, not scenarios, when it refuses to remove the last one", () => {
    const plain = template() + "\n  Scenario: plain note\n    Given a note\n    Then it is kept\n";
    expect(() => removeCriterion(plain, "AC1")).toThrow("A story keeps at least one criterion");
  });
});

describe("line breaks", () => {
  const crlf = (text: string) => text.replace(/\n/g, "\r\n");

  it("keeps a CRLF file CRLF through each edit", () => {
    const file = crlf(template());
    const edits = [
      editStoryText(file, { title: "Pay by card", asA: "a cashier", type: "technical", personas: [], priority: "should" }),
      addCriterion(file, { title: "Shows an error", when: ["I pay"], then: ["I see an error"] }),
      editCriterion(file, "AC1", { title: "Pays", when: ["I pay"], then: ["I see a receipt"] }),
      removeCriterion(addCriterion(file, { title: "Second", when: ["I act"], then: ["it works"] }), "AC1"),
    ];
    for (const next of edits) {
      expect(next.split("\n").filter((l) => !l.endsWith("\r") && l !== "")).toEqual([]);
      expect(errors(next)).toEqual([]);
    }
    expect(narrativeOf(file)).toEqual({ asA: "a first user", iWant: "to do the one thing this product is for", soThat: "I get the value it promises" });
    expect(editStoryText(file, { title: "Pay by card" }).split("\n")[1]).toBe("Feature: Pay by card\r");
  });
});
