import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer, INSTRUCTIONS } from "../src/mcp/server";
import { init } from "../src/commands/init";
import { setupVerify } from "../src/commands/verify";
import { setState } from "../src/commands/state";
import { copyExample } from "./helpers";

/** A client connected to nikos mcp for a repo. answer: how the person answers an approval question, or no elicitation at all. */
async function connect(root: string, answer?: "Approve" | "Not yet") {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" }, { capabilities: answer ? { elicitation: {} } : {} });
  const asked: string[] = [];
  if (answer) {
    client.setRequestHandler(ElicitRequestSchema, async (req: any) => {
      asked.push(req.params.message);
      return { action: "accept", content: { decision: answer } };
    });
  }
  await createServer(root).connect(a);
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r: any = await client.callTool({ name, arguments: args });
    return { text: r.content[0].text as string, data: r.structuredContent, isError: !!r.isError };
  };
  return { client, call, asked };
}

describe("nikos mcp", () => {
  it("offers every command as a tool, the playbooks as prompts, and the rules as instructions", async () => {
    const { client } = await connect(dirname(copyExample()));
    const tools = (await client.listTools()).tools.map((t) => t.name);
    for (const t of ["status", "validate", "story_map", "show_story", "add_story", "set_status", "check_release", "approve", "export", "record_decision"]) expect(tools).toContain(t);
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
    expect(prompts).toEqual(expect.arrayContaining(["build-a-story", "change", "answer", "idea-to-blueprint"]));
    const build = await client.getPrompt({ name: "build-a-story" });
    expect((build.messages[0].content as any).text).toContain("using the nikos tools");
    expect(client.getInstructions()).toBe(INSTRUCTIONS);
    expect(INSTRUCTIONS).toContain("Never hand the person a command to run.");
  });

  it("reads and changes the repo through tools", async () => {
    const root = dirname(copyExample());
    const { call } = await connect(root);
    const status = await call("status");
    expect(status.text.split("\n")[0]).toBe("Release 1 · MVP: 1 of 2 done · HT-2 in progress · 1 waiting for approval");
    expect(status.data.options[0].label).toBe("Finish HT-2: See today's top three");
    expect((await call("add_story", { title: "Share a list", activity: "tasks", release: 2 })).text).toBe(
      `Added HT-4 to release 2: ${join(root, "intent/features/tasks/share-a-list.feature")}`,
    );
    expect((await call("set_status", { id: "HT-3", status: "cancelled", reason: "Later" })).text).toBe("HT-3: todo → cancelled");
    expect((await call("validate")).text).toContain("✓ intent/ is valid — 4 stories, 2 releases");
    expect((await call("check_release", { number: 1 })).text).toBe("Release 1 · MVP: not ready — 1 of 2 done\n  ✗ HT-2 is in progress");
    const bad = await call("set_status", { id: "HT-9", status: "done" });
    expect(bad).toMatchObject({ isError: true, text: "✗ HT-9 has no entry in state.yaml" });
  });

  it("approves only on the person's answer through their app, and records via app", async () => {
    const root = mkdtempSync(join(tmpdir(), "nikos-mcp-"));
    init(root, { name: "Fixture", key: "FX" });
    writeFileSync(join(root, "package.json"), '{"name":"fx","private":true}');
    symlinkSync(join(__dirname, "../node_modules"), join(root, "node_modules"));
    setupVerify(root);
    writeFileSync(
      join(root, "test/steps/first-story.steps.mjs"),
      `import { Given, When, Then } from "@cucumber/cucumber";\nGiven("I am a new user", () => {});\nWhen("I do the one thing this product is for", () => {});\nThen("I see the result I came for", () => {});\n`,
    );
    setState("FX-1", "in_progress", { dir: root });
    setState("FX-1", "done", { dir: root });

    const no = await connect(root, "Not yet");
    expect((await no.call("approve", { ids: ["FX-1"] })).text).toBe("FX-1: not approved");
    expect(no.asked).toEqual(["Do you want to approve FX-1: First story? Its scenarios run again first."]);

    const none = await connect(root);
    expect((await none.call("approve", { ids: ["FX-1"] })).text).toContain("can't ask the person directly");

    const yes = await connect(root, "Approve");
    expect((await yes.call("approve", { ids: ["FX-1"] })).text).toMatch(/^FX-1: approved by /);
    expect(parse(readFileSync(join(root, "intent/approvals.yaml"), "utf8")).approvals["FX-1"].via).toBe("app");
  }, 60_000);
});
