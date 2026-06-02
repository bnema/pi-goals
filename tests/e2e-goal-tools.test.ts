import { describe, expect, it } from "vitest";
import { accountAssistantUsage } from "../src/accounting.js";
import { registerPiGoals } from "../src/index.js";
import { FakeCtx, FakePi } from "./fakes.js";

describe("e2e model tool scenario", () => {
  it("creates goal, injects context, accounts usage, and completes", async () => {
    const pi = new FakePi();
    const store = registerPiGoals(pi);
    const ctx = new FakeCtx();

    await pi.tools.get("create_goal")!.execute("id", { objective: "finish tools", token_budget: 1000 }, undefined, undefined, ctx);
    const beforeAgent = await pi.emit("before_agent_start", {}, ctx);
    expect(JSON.stringify(beforeAgent)).toContain("finish tools");

    store.setState(accountAssistantUsage(store.getState(), { input: 50, output: 75 }));
    const result = await pi.tools.get("update_goal")!.execute("id", { status: "complete", evidence: "verified" }, undefined, undefined, ctx);

    expect(store.getState().goal?.status).toBe("complete");
    expect(JSON.stringify(result)).toContain('"tokensUsed":125');
  });

  it("blocked audit fails twice and succeeds on third same blocker", async () => {
    const pi = new FakePi();
    const store = registerPiGoals(pi);
    const ctx = new FakeCtx();
    await pi.tools.get("create_goal")!.execute("id", { objective: "finish blocked path" }, undefined, undefined, ctx);
    const update = pi.tools.get("update_goal")!;

    await expect(update.execute("id", { status: "blocked", blocker_key: "same" }, undefined, undefined, ctx)).rejects.toThrow();
    store.advanceTurn();
    await expect(update.execute("id", { status: "blocked", blocker_key: "same" }, undefined, undefined, ctx)).rejects.toThrow();
    store.advanceTurn();
    await update.execute("id", { status: "blocked", blocker_key: "same" }, undefined, undefined, ctx);

    expect(store.getState().goal?.status).toBe("blocked");
  });
});
