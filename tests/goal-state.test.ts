import { describe, expect, it } from "vitest";
import {
  GOAL_STATE_CUSTOM_TYPE,
  blockGoal,
  budgetLimitGoal,
  clearGoal,
  clearGoalBudget,
  completeGoal,
  createGoal,
  editGoal,
  emptyGoalState,
  pauseGoal,
  recordBlockedAttempt,
  replaceGoal,
  restoreStateFromBranch,
  resumeGoal,
  setGoalBudget,
  snapshotState,
  usageLimitGoal,
} from "../src/goal-state.js";
import { canAcceptBlocked, normalizeObjective, validateModelToolStatus, validatePositiveBudget } from "../src/validation.js";

describe("goal state transitions", () => {
  it("creates a new active goal", () => {
    const state = createGoal(emptyGoalState(), { objective: "ship it", tokenBudget: 1000, goalId: "g1", now: 10 });
    expect(state.goal?.status).toBe("active");
    expect(state.goal?.goalId).toBe("g1");
    expect(state.goal?.tokenBudget).toBe(1000);
    expect(state.goal?.tokensUsed).toBe(0);
    expect(state.lastMutation?.type).toBe("goal.create");
  });

  it("replaces current goal with a fresh id and reset usage", () => {
    const first = createGoal(emptyGoalState(), { objective: "old", goalId: "g1", now: 10 });
    const used = { ...first, goal: first.goal && { ...first.goal, tokensUsed: 50 } };
    const replaced = replaceGoal(used, { objective: "new", goalId: "g2", now: 20 });
    expect(replaced.goal?.goalId).toBe("g2");
    expect(replaced.goal?.tokensUsed).toBe(0);
    expect(first.goal?.objective).toBe("old");
  });

  it("edits active and terminal goals with the expected status behavior", () => {
    const active = createGoal(emptyGoalState(), { objective: "old", goalId: "g1", now: 10 });
    const activeWithUsage = { ...active, goal: active.goal && { ...active.goal, tokensUsed: 42 } };
    const edited = editGoal(activeWithUsage, { objective: "new", now: 11 });
    expect(edited.goal?.status).toBe("active");
    expect(edited.goal?.objective).toBe("new");
    expect(edited.goal?.tokensUsed).toBe(42);
    expect(edited.goal?.updatedAt).toBeGreaterThan(active.goal?.updatedAt ?? 0);
    expect(active.goal?.objective).toBe("old");

    const complete = completeGoal(edited, { now: 12 });
    const reactivated = editGoal(complete, { objective: "newer", now: 13 });
    expect(reactivated.goal?.status).toBe("active");
    expect(reactivated.goal?.completedAt).toBeNull();

    const budgeted = budgetLimitGoal(reactivated, { now: 20 });
    const editedBudgetLimited = editGoal(budgeted, { objective: "again", now: 21 });
    expect(editedBudgetLimited.goal?.status).toBe("budget_limited");
    expect(editedBudgetLimited.goal?.terminalReason).toBe("budget_limited");

    const budgetedWithHeadroom = {
      ...budgeted,
      goal: budgeted.goal && { ...budgeted.goal, tokenBudget: 100, tokensUsed: 10 },
    };
    const reactivatedBudget = editGoal(budgetedWithHeadroom, { objective: "again with budget", now: 22 });
    expect(reactivatedBudget.goal?.status).toBe("active");
  });

  it("edits paused, blocked, and usage-limited goals while preserving usage and status", () => {
    const active = createGoal(emptyGoalState(), { objective: "old", goalId: "g1", now: 10 });
    const used = { ...active, goal: active.goal && { ...active.goal, tokensUsed: 99 } };
    const paused = pauseGoal(used, { now: 11 });
    const editedPaused = editGoal(paused, { objective: "paused objective", now: 12 });
    expect(editedPaused.goal?.status).toBe("paused");
    expect(editedPaused.goal?.tokensUsed).toBe(99);

    const blocked = blockGoal(resumeGoal(paused, { now: 13 }), { now: 14 });
    const editedBlocked = editGoal(blocked, { objective: "blocked objective", now: 15 });
    expect(editedBlocked.goal?.status).toBe("blocked");
    expect(editedBlocked.goal?.tokensUsed).toBe(99);

    const usageLimited = usageLimitGoal(resumeGoal(paused, { now: 16 }), { now: 17 });
    const editedUsageLimited = editGoal(usageLimited, { objective: "usage objective", now: 18 });
    expect(editedUsageLimited.goal?.status).toBe("usage_limited");
    expect(editedUsageLimited.goal?.tokensUsed).toBe(99);
  });

  it("pauses, resumes, clears, and terminalizes goals", () => {
    const active = createGoal(emptyGoalState(), { objective: "work", goalId: "g1", now: 10 });
    const paused = pauseGoal(active, { now: 11 });
    expect(paused.goal?.status).toBe("paused");
    expect(paused.runtime.activeTurnStartedAt).toBeNull();
    expect(pauseGoal(completeGoal(active, { now: 12 }), { now: 13 }).goal?.status).toBe("complete");

    const resumed = resumeGoal(paused, { now: 13 });
    expect(resumed.goal?.status).toBe("active");

    expect(completeGoal(resumed, { now: 14 }).goal?.status).toBe("complete");
    expect(blockGoal(resumed, { now: 14 }).goal?.status).toBe("blocked");
    expect(usageLimitGoal(resumed, { now: 15 }).goal?.status).toBe("usage_limited");
    expect(budgetLimitGoal(resumed, { now: 16 }).goal?.status).toBe("budget_limited");
    expect(clearGoal(resumed, { now: 17 }).goal).toBeNull();
  });

  it("sets budget-limited when current usage already exceeds a new budget", () => {
    const active = createGoal(emptyGoalState(), { objective: "work", goalId: "g1", now: 10 });
    const used = {
      ...active,
      goal: active.goal && { ...active.goal, tokensUsed: 500 },
      runtime: { ...active.runtime, noProgressTurns: 3, lastContinuationRequestId: "g1:1:10", wrapUpScheduledForGoalId: "g1" },
    };
    const limited = setGoalBudget(used, 100, { now: 11 });
    expect(limited.goal?.status).toBe("budget_limited");
    const raised = setGoalBudget(limited, 1000, { now: 12 });
    expect(raised.goal?.status).toBe("active");
    expect(raised.runtime.wrapUpScheduledForGoalId).toBeNull();
    expect(raised.runtime.lastContinuationRequestId).toBeNull();
    expect(raised.runtime.noProgressTurns).toBe(0);

    const cleared = clearGoalBudget(limited, { now: 13 });
    expect(cleared.goal?.status).toBe("active");
    expect(cleared.runtime.wrapUpScheduledForGoalId).toBeNull();
    expect(cleared.runtime.lastContinuationRequestId).toBeNull();
    expect(cleared.runtime.noProgressTurns).toBe(0);
  });

  it("tracks blocked audit threshold", () => {
    const active = createGoal(emptyGoalState(), { objective: "work", goalId: "g1", now: 10 });
    const one = recordBlockedAttempt(active, "missing-key", { now: 11 });
    const two = recordBlockedAttempt(one, "missing-key", { now: 12 });
    const three = recordBlockedAttempt(two, "missing-key", { now: 13 });
    expect(canAcceptBlocked(one.goal, "missing-key")).toBe(false);
    expect(canAcceptBlocked(two.goal, "missing-key")).toBe(false);
    expect(canAcceptBlocked(three.goal, "missing-key")).toBe(true);
  });
});

describe("validation", () => {
  it("validates objectives, budgets, and model statuses", () => {
    expect(normalizeObjective("  hello  ")).toBe("hello");
    expect(() => normalizeObjective("")).toThrow(/non-empty/);
    expect(validatePositiveBudget(10.9)).toBe(10);
    expect(() => validatePositiveBudget(0.5)).toThrow(/positive/);
    expect(() => validatePositiveBudget(0)).toThrow(/positive/);
    expect(validateModelToolStatus("complete")).toBe("complete");
    expect(() => validateModelToolStatus("paused")).toThrow(/complete or blocked/);
  });
});

describe("branch-aware persistence", () => {
  it("restores empty state when no entries exist", () => {
    expect(restoreStateFromBranch([]).goal).toBeNull();
  });

  it("uses the latest valid snapshot on the active branch", () => {
    const first = createGoal(emptyGoalState(), { objective: "first", goalId: "g1", now: 10 });
    const second = createGoal(emptyGoalState(), { objective: "second", goalId: "g2", now: 20 });
    const restored = restoreStateFromBranch([
      { type: "custom", customType: GOAL_STATE_CUSTOM_TYPE, data: snapshotState(first) },
      { type: "custom", customType: "other", data: snapshotState(second) },
      { type: "custom", customType: GOAL_STATE_CUSTOM_TYPE, data: { schemaVersion: 99 } },
      { type: "custom", customType: GOAL_STATE_CUSTOM_TYPE, data: snapshotState(second) },
    ]);
    expect(restored.goal?.objective).toBe("second");
  });

  it("restores partial v1 runtime and config snapshots with defaults", () => {
    const state = createGoal(emptyGoalState(), { objective: "partial", goalId: "g1", now: 10 });
    const snapshot = snapshotState(state) as { goal: unknown };
    const restored = restoreStateFromBranch([
      {
        type: "custom",
        customType: GOAL_STATE_CUSTOM_TYPE,
        data: {
          schemaVersion: 1,
          goal: snapshot.goal,
          runtime: { noProgressTurns: 2 },
          config: { maxAutoContinuations: 0 },
          lastMutation: null,
        },
      },
    ]);
    expect(restored.goal?.objective).toBe("partial");
    expect(restored.runtime.noProgressTurns).toBe(2);
    expect(restored.runtime.lastAccountedAt).toBeNull();
    expect(restored.config.maxAutoContinuations).toBe(0);
    expect(restored.config.noProgressTurnLimit).toBe(3);
  });

  it("does not leak abandoned branch snapshots when branch entries omit them", () => {
    const active = createGoal(emptyGoalState(), { objective: "active branch", goalId: "g1", now: 10 });
    const abandoned = createGoal(emptyGoalState(), { objective: "abandoned", goalId: "g2", now: 20 });
    const restored = restoreStateFromBranch([{ type: "custom", customType: GOAL_STATE_CUSTOM_TYPE, data: snapshotState(active) }]);
    expect(restored.goal?.objective).not.toBe(abandoned.goal?.objective);
  });

  it("ignores malformed snapshots instead of trusting partial shape", () => {
    const restored = restoreStateFromBranch([
      {
        type: "custom",
        customType: GOAL_STATE_CUSTOM_TYPE,
        data: {
          schemaVersion: 1,
          goal: { status: "active" },
          runtime: {},
          config: {},
          lastMutation: null,
        },
      },
    ]);
    expect(restored.goal).toBeNull();
  });
});
