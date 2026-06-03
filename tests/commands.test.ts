import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, snapshotConfig } from "../src/config.js";
import { completeGoal, emptyGoalState } from "../src/goal-state.js";
import { handleGoalCommand, registerPiGoals } from "../src/index.js";
import { createGoalStore } from "../src/types.js";
import { FakeCtx, FakePi } from "./fakes.js";

describe("/goal command", () => {
  it("registers and handles help/status/create/pause/resume/clear", async () => {
    const pi = new FakePi();
    registerPiGoals(pi);
    const ctx = new FakeCtx();
    const goal = pi.commands.get("goal")!;

    await goal.handler("help", ctx);
    expect(lastNotification(ctx)).toContain("/goal <objective>");
    await goal.handler("--budget 10k write docs", ctx);
    expect(lastNotification(ctx)).toContain("write docs");
    expect(ctx.statuses["pi-goals"]).toContain("10K");
    await goal.handler("pause", ctx);
    expect(lastNotification(ctx)).toContain("paused");
    await goal.handler("resume", ctx);
    expect(lastNotification(ctx)).toContain("active");
    ctx.confirms.push(true);
    await goal.handler("clear", ctx);
    expect(lastNotification(ctx)).toContain("No current goal");
    expect(pi.entries.length).toBeGreaterThanOrEqual(4);
  });

  it("fails closed for no-UI replacement unless forced", async () => {
    const pi = new FakePi();
    const store = createGoalStore(emptyGoalState(snapshotConfig(DEFAULT_CONFIG)), DEFAULT_CONFIG);
    const ctx = new FakeCtx();
    ctx.hasUI = false;
    await handleGoalCommand(pi, store, "first", ctx);
    expect(await handleGoalCommand(pi, store, "second", ctx)).toBe("Goal replacement cancelled.");
    expect(await handleGoalCommand(pi, store, "second --force", ctx)).toContain("second");
  });

  it("honors confirmReplace=false for replacement", async () => {
    const pi = new FakePi();
    const store = createGoalStore(emptyGoalState(snapshotConfig(DEFAULT_CONFIG)), { ...DEFAULT_CONFIG, confirmReplace: false });
    const ctx = new FakeCtx();
    await handleGoalCommand(pi, store, "first", ctx);
    expect(await handleGoalCommand(pi, store, "second", ctx)).toContain("second");
    expect(store.getState().goal?.objective).toBe("second");
  });

  it("fails closed for no-UI clear and budget-clear unless forced", async () => {
    const pi = new FakePi();
    const store = createGoalStore(emptyGoalState(snapshotConfig(DEFAULT_CONFIG)), DEFAULT_CONFIG);
    const ctx = new FakeCtx();
    ctx.hasUI = false;

    await handleGoalCommand(pi, store, "--budget 10 first", ctx);
    expect(await handleGoalCommand(pi, store, "clear", ctx)).toBe("Goal clear cancelled.");
    expect(await handleGoalCommand(pi, store, "clear --force", ctx)).toContain("No current goal");

    await handleGoalCommand(pi, store, "--budget 10 first", ctx);
    const currentGoal = store.getState().goal;
    if (!currentGoal) throw new Error("expected goal");
    store.setState({ ...store.getState(), goal: { ...currentGoal, tokensUsed: 10 } });
    await handleGoalCommand(pi, store, "budget 10", ctx);
    expect(store.getState().goal?.status).toBe("budget_limited");
    expect(await handleGoalCommand(pi, store, "budget clear", ctx)).toBe("Budget clear cancelled.");
    expect(await handleGoalCommand(pi, store, "budget clear --force", ctx)).toContain("Token budget: none");
  });

  it("accounts active time before clearing a budget", async () => {
    vi.useFakeTimers();
    try {
      const pi = new FakePi();
      const store = createGoalStore(emptyGoalState(snapshotConfig(DEFAULT_CONFIG)), DEFAULT_CONFIG);
      const ctx = new FakeCtx();

      vi.setSystemTime(10_000);
      await handleGoalCommand(pi, store, "--budget 100 work", ctx);
      vi.setSystemTime(15_000);
      await handleGoalCommand(pi, store, "budget clear", ctx);

      expect(store.getState().goal?.tokenBudget).toBeNull();
      expect(store.getState().goal?.timeUsedSeconds).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists and displays durable goal context updates", async () => {
    const pi = new FakePi();
    const store = createGoalStore(emptyGoalState(snapshotConfig(DEFAULT_CONFIG)), DEFAULT_CONFIG);
    const ctx = new FakeCtx();

    const referenceOutput = await handleGoalCommand(pi, store, "ref add docs/spec.md --role spec --description product spec", ctx);
    expect(referenceOutput).toContain("docs/spec.md");
    expect(referenceOutput).toContain("product spec");
    expect(JSON.stringify(store.getState())).toContain("docs/spec.md");
    expect(store.getState().goal).toBeNull();
    expect(store.getState().lastMutation?.goalId).toBeNull();

    const instructionOutput = await handleGoalCommand(pi, store, "instruction add keep changes minimal", ctx);
    expect(instructionOutput).toContain("keep changes minimal");
    expect(JSON.stringify(store.getState())).toContain("keep changes minimal");
    expect(store.getState().goal).toBeNull();
    expect(store.getState().lastMutation?.goalId).toBeNull();

    const criterionOutput = await handleGoalCommand(pi, store, "criterion add targeted tests pass", ctx);
    expect(criterionOutput).toContain("targeted tests pass");
    expect(JSON.stringify(store.getState())).toContain("targeted tests pass");
    expect(store.getState().goal).toBeNull();
    expect(store.getState().lastMutation?.goalId).toBeNull();

    const rereadOutput = await handleGoalCommand(pi, store, "reread on", ctx);
    expect(rereadOutput).toContain("on continuation: required");
    expect(store.getState().context.rereadPolicy.beforeCompletion).toBe(true);
    expect(store.getState().goal).toBeNull();
    expect(store.getState().lastMutation?.goalId).toBeNull();

    const contextBeforeRejectedClear = store.getState().context;
    const entriesBeforeRejectedClear = pi.entries.length;
    ctx.hasUI = false;
    expect(await handleGoalCommand(pi, store, "context clear", ctx)).toBe("Goal context clear cancelled.");
    expect(store.getState().context).toEqual(contextBeforeRejectedClear);
    expect(pi.entries).toHaveLength(entriesBeforeRejectedClear);
    ctx.hasUI = true;

    ctx.confirms.push(false);
    const clearedOutput = await handleGoalCommand(pi, store, "context clear --force", ctx);
    expect(clearedOutput).toContain("No durable goal context.");
    // The queued rejection remains, proving --force bypassed confirmation.
    expect(ctx.confirms).toEqual([false]);
    expect(pi.entries.length).toBeGreaterThanOrEqual(4);
  });

  it("edits through ui.editor and steers running turns", async () => {
    const pi = new FakePi();
    const store = createGoalStore(emptyGoalState(snapshotConfig(DEFAULT_CONFIG)), DEFAULT_CONFIG);
    const ctx = new FakeCtx();
    ctx.idle = false;
    await handleGoalCommand(pi, store, "first", ctx);
    ctx.editorValue = "edited";
    expect(await handleGoalCommand(pi, store, "edit", ctx)).toContain("edited");
    expect(pi.messages.some((item) => item.message.customType === "pi-goals/objective-updated")).toBe(true);
  });

  it("cancels replacement and clear when confirmation is rejected", async () => {
    const pi = new FakePi();
    const store = createGoalStore(emptyGoalState(snapshotConfig(DEFAULT_CONFIG)), DEFAULT_CONFIG);
    const ctx = new FakeCtx();
    await handleGoalCommand(pi, store, "first", ctx);
    ctx.confirms.push(false);
    expect(await handleGoalCommand(pi, store, "second", ctx)).toBe("Goal replacement cancelled.");
    ctx.confirms.push(false);
    expect(await handleGoalCommand(pi, store, "clear", ctx)).toBe("Goal clear cancelled.");
  });

  it("clears completed goals without confirmation", async () => {
    const pi = new FakePi();
    const store = createGoalStore(emptyGoalState(snapshotConfig(DEFAULT_CONFIG)), DEFAULT_CONFIG);
    const ctx = new FakeCtx();
    await handleGoalCommand(pi, store, "first", ctx);
    store.setState(completeGoal(store.getState(), { now: 20 }));
    expect(await handleGoalCommand(pi, store, "clear", ctx)).toContain("No current goal");
  });
});

function lastNotification(ctx: FakeCtx): string {
  return ctx.notifications.at(-1)?.message ?? "";
}
