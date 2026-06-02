import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, snapshotConfig } from "../src/config.js";
import {
  GOAL_STATE_CUSTOM_TYPE,
  budgetLimitGoal,
  createGoal,
  emptyGoalState,
  pauseGoal,
  recordBlockedAttempt,
  snapshotState,
} from "../src/goal-state.js";
import { maybeScheduleContinuation, registerPiGoals } from "../src/index.js";
import { createGoalStore } from "../src/types.js";
import { GOAL_STATUS_ICON } from "../src/ui.js";
import { FakeCtx, FakePi } from "./fakes.js";

describe("lifecycle restore and accounting", () => {
  it("restores branch state on session_start and avoids duplicate append", async () => {
    const state = createGoal(emptyGoalState(snapshotConfig(DEFAULT_CONFIG)), { objective: "branch goal", goalId: "g1", now: 10 });
    const pi = new FakePi();
    registerPiGoals(pi);
    const ctx = new FakeCtx();
    ctx.branchEntries = [{ type: "custom", customType: GOAL_STATE_CUSTOM_TYPE, data: snapshotState(state) }];
    await pi.emit("session_start", {}, ctx);
    expect(ctx.statuses["pi-goals"]).toContain(GOAL_STATUS_ICON);
    expect(pi.entries).toHaveLength(0);
  });

  it("restores branch state on session_tree and current config overrides persisted config", async () => {
    const persisted = createGoal(emptyGoalState({ autoContinue: true }), { objective: "branch goal", goalId: "g1", now: 10 });
    const pi = new FakePi();
    const store = registerPiGoals(pi);
    const ctx = new FakeCtx();
    const cwd = mkdtempSync(join(tmpdir(), "pi-goals-"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(join(cwd, ".pi", "pi-goals.json"), JSON.stringify({ autoContinue: false }));
    ctx.branchEntries = [{ type: "custom", customType: GOAL_STATE_CUSTOM_TYPE, data: snapshotState(persisted) }];
    ctx.cwd = cwd;
    await pi.emit("session_tree", {}, ctx);
    expect(store.getState().goal?.objective).toBe("branch goal");
    expect(store.getState().config.autoContinue).toBe(false);
  });

  it("clears non-persisted blocked-audit turn guards on branch restore", async () => {
    const state = createGoal(emptyGoalState(DEFAULT_CONFIG), { objective: "branch goal", goalId: "g1", now: 10 });
    const pi = new FakePi();
    const store = registerPiGoals(pi);
    const ctx = new FakeCtx();
    await pi.commands.get("goal")!.handler("work", ctx);
    await expect(pi.tools.get("update_goal")!.execute("id", { status: "blocked", blocker_key: "same" }, undefined, undefined, ctx)).rejects.toThrow(/Blocked audit/);

    ctx.branchEntries = [{ type: "custom", customType: GOAL_STATE_CUSTOM_TYPE, data: snapshotState(state) }];
    await pi.emit("session_tree", {}, ctx);
    await expect(pi.tools.get("update_goal")!.execute("id", { status: "blocked", blocker_key: "same" }, undefined, undefined, ctx)).rejects.toThrow(/Blocked audit/);
    expect(store.getState().goal?.blockedAudit.consecutiveTurns).toBe(1);
  });

  it("injects active goal context before agent starts", async () => {
    const pi = new FakePi();
    registerPiGoals(pi);
    const ctx = new FakeCtx();
    await pi.commands.get("goal")!.handler("work", ctx);
    const results = await pi.emit("before_agent_start", {}, ctx);
    expect(JSON.stringify(results)).toContain("pi-goals/context");
  });

  it("accounts usage, applies budget, and schedules budget wrap-up once", async () => {
    const pi = new FakePi();
    registerPiGoals(pi);
    const ctx = new FakeCtx();
    await pi.commands.get("goal")!.handler("--budget 10 work", ctx);
    await pi.emit("turn_start", {}, ctx);
    await pi.emit("message_end", { usage: { input: 5, output: 5 }, text: "made progress on the current implementation with real output" }, ctx);
    await pi.emit("turn_end", {}, ctx);
    await pi.emit("agent_end", {}, ctx);
    await pi.emit("agent_end", {}, ctx);
    expect(pi.messages.filter((item) => item.message.customType === "pi-goals/budget-wrapup")).toHaveLength(1);
  });

  it("does not count offline time between shutdown and restored turns", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(10_000_000);
      const pi = new FakePi();
      registerPiGoals(pi);
      const ctx = new FakeCtx();
      await pi.commands.get("goal")!.handler("work", ctx);

      vi.setSystemTime(10_010_000);
      await pi.emit("session_shutdown", {}, ctx);
      expect(pi.entries.at(-1)?.data).toBeDefined();

      const restoredPi = new FakePi();
      const restoredStore = registerPiGoals(restoredPi);
      const restoredCtx = new FakeCtx();
      restoredCtx.branchEntries = pi.entries;
      vi.setSystemTime(10_110_000);
      await restoredPi.emit("session_start", {}, restoredCtx);
      await restoredPi.emit("turn_start", {}, restoredCtx);
      vi.setSystemTime(10_115_000);
      await restoredPi.emit("turn_end", {}, restoredCtx);

      expect(restoredStore.getState().goal?.timeUsedSeconds).toBe(15);
      expect(restoredStore.getState().runtime.lastAccountedAt).toBe(10_115);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("auto-continuation", () => {
  it("schedules continuation only for eligible active goals", () => {
    const pi = new FakePi();
    const active = createGoal(emptyGoalState(snapshotConfig(DEFAULT_CONFIG)), { objective: "work", goalId: "g1", now: 10 });
    const store = createGoalStore(active, DEFAULT_CONFIG);
    const ctx = new FakeCtx();
    expect(maybeScheduleContinuation(pi, store, ctx)).toBe(true);
    expect(pi.messages[0]?.message.customType).toBe("pi-goals/continuation");

    const pausedStore = createGoalStore(pauseGoal(active, { now: 11 }), DEFAULT_CONFIG);
    expect(maybeScheduleContinuation(new FakePi(), pausedStore, ctx)).toBe(false);

    const pendingCtx = new FakeCtx();
    pendingCtx.pending = true;
    const pendingStore = createGoalStore(createGoal(emptyGoalState(snapshotConfig(DEFAULT_CONFIG)), { objective: "work", goalId: "g2", now: 12 }), DEFAULT_CONFIG);
    expect(maybeScheduleContinuation(new FakePi(), pendingStore, pendingCtx)).toBe(false);
  });

  it("suppresses continuation at cap and sends budget wrap-up for limited goals", () => {
    const capped = createGoal(emptyGoalState({ maxAutoContinuations: 0 }), { objective: "work", goalId: "g1", now: 10 });
    const pi = new FakePi();
    const store = createGoalStore(capped, DEFAULT_CONFIG);
    const ctx = new FakeCtx();
    expect(maybeScheduleContinuation(pi, store, ctx)).toBe(false);
    expect(store.getState().runtime.autoContinueSuppressedReason).toContain("cap");

    const limited = budgetLimitGoal(createGoal(emptyGoalState(snapshotConfig(DEFAULT_CONFIG)), { objective: "work", goalId: "g2", now: 20 }), { now: 21 });
    const wrapPi = new FakePi();
    const wrapStore = createGoalStore(limited, DEFAULT_CONFIG);
    expect(maybeScheduleContinuation(wrapPi, wrapStore, ctx)).toBe(true);
    expect(maybeScheduleContinuation(wrapPi, wrapStore, ctx)).toBe(false);
    expect(wrapPi.messages).toHaveLength(1);
  });

  it("does not persist continuation latches when delivery is unavailable", () => {
    const active = createGoal(emptyGoalState(snapshotConfig(DEFAULT_CONFIG)), { objective: "work", goalId: "g1", now: 10 });
    const entries: unknown[] = [];
    const pi = { appendEntry: (_customType: string, data?: unknown) => entries.push(data) };
    const store = createGoalStore(active, DEFAULT_CONFIG);
    const ctx = new FakeCtx();

    expect(maybeScheduleContinuation(pi, store, ctx)).toBe(false);
    expect(store.getState().runtime.lastContinuationRequestId).toBeNull();
    expect(store.getState().goal?.continuationCount).toBe(0);
    expect(store.getState().runtime.autoContinueSuppressedReason).toContain("delivery");
  });

  it("continues scheduled no-progress turns until the no-progress threshold", async () => {
    const pi = new FakePi();
    registerPiGoals(pi);
    const ctx = new FakeCtx();
    await pi.commands.get("goal")!.handler("work", ctx);

    await pi.emit("agent_end", {}, ctx);
    expect(pi.messages.filter((item) => item.message.customType === "pi-goals/continuation")).toHaveLength(1);

    await pi.emit("turn_start", {}, ctx);
    await pi.emit("turn_end", {}, ctx);
    await pi.emit("agent_end", {}, ctx);

    expect(pi.messages.filter((item) => item.message.customType === "pi-goals/continuation")).toHaveLength(2);
    expect(ctx.notifications.some((item) => item.message.includes("progress"))).toBe(false);
  });

  it("does not count long blocker restatements as meaningful progress", async () => {
    const pi = new FakePi();
    const store = registerPiGoals(pi);
    const ctx = new FakeCtx();
    await pi.commands.get("goal")!.handler("work", ctx);
    await pi.emit("message_end", { text: "blocked blocked blocked cannot proceed ".repeat(10) }, ctx);
    await pi.emit("turn_end", {}, ctx);
    expect(store.getState().runtime.noProgressTurns).toBe(1);
  });

  it("counts meaningful updates that mention blockers as progress", async () => {
    const pi = new FakePi();
    const store = registerPiGoals(pi);
    const ctx = new FakeCtx();
    await pi.commands.get("goal")!.handler("work", ctx);
    store.setState(recordBlockedAttempt(store.getState(), "dependency", { now: 20 }));

    await pi.emit("turn_start", {}, ctx);
    await pi.emit(
      "message_end",
      {
        text: "Implemented the fallback, ran the verification suite, and documented the remaining blocked dependency so the goal can continue safely.",
      },
      ctx,
    );
    await pi.emit("turn_end", {}, ctx);

    expect(store.getState().runtime.noProgressTurns).toBe(0);
    expect(store.getState().goal?.blockedAudit.active).toBe(false);
  });

  it("detects usage limits and no-progress suppression", async () => {
    const pi = new FakePi();
    const store = registerPiGoals(pi);
    const ctx = new FakeCtx();
    await pi.commands.get("goal")!.handler("work", ctx);
    await pi.emit("message_end", { text: "Implemented rate limit handling and verified the retry behavior in tests." }, ctx);
    expect(store.getState().goal?.status).toBe("active");
    await pi.emit("message_end", { message: { errorMessage: "provider says insufficient_quota" } }, ctx);
    expect(store.getState().goal?.status).toBe("usage_limited");
    expect(ctx.notifications.some((item) => item.message.includes("usage"))).toBe(true);

    const pi2 = new FakePi();
    registerPiGoals(pi2);
    const ctx2 = new FakeCtx();
    await pi2.commands.get("goal")!.handler("work", ctx2);
    await pi2.emit("turn_end", {}, ctx2);
    await pi2.emit("turn_end", {}, ctx2);
    await pi2.emit("turn_end", {}, ctx2);
    await pi2.emit("agent_end", {}, ctx2);
    expect(pi2.messages.filter((item) => item.message.customType === "pi-goals/continuation")).toHaveLength(0);
  });
});
