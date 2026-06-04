import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, snapshotConfig } from "../src/config.js";
import { completeGoal, createGoal, emptyGoalState, pauseGoal } from "../src/goal-state.js";
import { registerGoalTools } from "../src/tools.js";
import { createGoalStore } from "../src/types.js";
import { FakeCtx, FakePi } from "./fakes.js";

describe("goal tools", () => {
  it("gets no goal and creates a goal", async () => {
    const pi = new FakePi();
    const store = createGoalStore(emptyGoalState(snapshotConfig(DEFAULT_CONFIG)), DEFAULT_CONFIG);
    registerGoalTools(pi, store);
    const ctx = new FakeCtx();

    const empty = await pi.tools.get("get_goal")!.execute("id", {}, undefined, undefined, ctx);
    expect((empty as { details: { goal: unknown } }).details.goal).toBeNull();

    const created = await pi.tools.get("create_goal")!.execute("id", { objective: "ship", token_budget: 100 }, undefined, undefined, ctx);
    expect(JSON.stringify(created)).toContain("ship");
    await expect(pi.tools.get("create_goal")!.execute("id", { objective: "again" }, undefined, undefined, ctx)).rejects.toThrow(/unfinished goal already exists/);
  });

  it("allows create_goal to start a new goal after the previous goal is complete", async () => {
    const pi = new FakePi();
    const completed = completeGoal(
      createGoal(emptyGoalState(snapshotConfig(DEFAULT_CONFIG)), { objective: "done", goalId: "g1", now: 10 }),
      { now: 11 },
    );
    const store = createGoalStore(completed, DEFAULT_CONFIG);
    registerGoalTools(pi, store);
    const ctx = new FakeCtx();

    const created = await pi.tools.get("create_goal")!.execute("id", { objective: "next" }, undefined, undefined, ctx);

    expect(JSON.stringify(created)).toContain("next");
    expect(store.getState().goal?.objective).toBe("next");
    expect(store.getState().goal?.status).toBe("active");
    expect(store.getState().lastMutation?.type).toBe("goal.replace");
    expect(pi.entries).toHaveLength(1);
  });

  it("rejects invalid update statuses and completes with usage report", async () => {
    const pi = new FakePi();
    const store = createGoalStore(createGoal(emptyGoalState(snapshotConfig(DEFAULT_CONFIG)), { objective: "ship", goalId: "g1", now: 10 }), DEFAULT_CONFIG);
    registerGoalTools(pi, store);
    const ctx = new FakeCtx();

    await expect(pi.tools.get("update_goal")!.execute("id", { status: "paused" }, undefined, undefined, ctx)).rejects.toThrow();
    const result = await pi.tools.get("update_goal")!.execute("id", { status: "complete", evidence: "tests pass" }, undefined, undefined, ctx);
    expect(JSON.stringify(result)).toContain("completionBudgetReport");
    expect(store.getState().goal?.status).toBe("complete");
  });

  it("requires active status and evidence before completing", async () => {
    const pi = new FakePi();
    const active = createGoal(emptyGoalState(snapshotConfig(DEFAULT_CONFIG)), { objective: "ship", goalId: "g1", now: 10 });
    const store = createGoalStore(active, DEFAULT_CONFIG);
    registerGoalTools(pi, store);
    const ctx = new FakeCtx();
    const tool = pi.tools.get("update_goal")!;

    await expect(tool.execute("id", { status: "complete" }, undefined, undefined, ctx)).rejects.toThrow(/evidence/i);
    store.setState(pauseGoal(active, { now: 11 }));
    await expect(tool.execute("id", { status: "complete", evidence: "verified" }, undefined, undefined, ctx)).rejects.toThrow(/active goal/i);
    expect(store.getState().goal?.status).toBe("paused");
  });

  it("requires three same blocker attempts before blocked succeeds", async () => {
    const pi = new FakePi();
    const store = createGoalStore(createGoal(emptyGoalState(snapshotConfig(DEFAULT_CONFIG)), { objective: "ship", goalId: "g1", now: 10 }), DEFAULT_CONFIG);
    registerGoalTools(pi, store);
    const ctx = new FakeCtx();
    const tool = pi.tools.get("update_goal")!;

    await expect(tool.execute("id", { status: "blocked", blocker_key: "missing-api" }, undefined, undefined, ctx)).rejects.toThrow(/Blocked audit/);
    await expect(tool.execute("id", { status: "blocked", blocker_key: "missing-api" }, undefined, undefined, ctx)).rejects.toThrow(/already recorded/);
    expect(store.getState().goal?.blockedAudit.consecutiveTurns).toBe(1);
    store.advanceTurn();
    await expect(tool.execute("id", { status: "blocked", blocker_key: "missing-api" }, undefined, undefined, ctx)).rejects.toThrow(/Blocked audit/);
    store.advanceTurn();
    const result = await tool.execute("id", { status: "blocked", blocker_key: "missing-api" }, undefined, undefined, ctx);
    expect(JSON.stringify(result)).toContain("blocked");
    expect(store.getState().goal?.status).toBe("blocked");
  });

  it("rejects blocked updates for non-active goals without mutating audit state", async () => {
    const pi = new FakePi();
    const active = createGoal(emptyGoalState(snapshotConfig(DEFAULT_CONFIG)), { objective: "ship", goalId: "g1", now: 10 });
    const paused = pauseGoal(active, { now: 11 });
    const store = createGoalStore(paused, DEFAULT_CONFIG);
    registerGoalTools(pi, store);
    const ctx = new FakeCtx();

    await expect(pi.tools.get("update_goal")!.execute("id", { status: "blocked", blocker_key: "missing-api" }, undefined, undefined, ctx)).rejects.toThrow(/active goal/);
    expect(store.getState().goal?.blockedAudit.consecutiveTurns).toBe(0);
    expect(pi.entries).toHaveLength(0);
  });
});
