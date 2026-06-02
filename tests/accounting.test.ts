import { describe, expect, it } from "vitest";
import {
  accountAssistantUsage,
  accountElapsedTime,
  countedTokens,
  maybeApplyBudgetLimit,
  startTurnAccounting,
} from "../src/accounting.js";
import { createGoal, emptyGoalState, pauseGoal } from "../src/goal-state.js";

describe("accounting", () => {
  it("accounts elapsed active time monotonically", () => {
    const active = createGoal(emptyGoalState(), { objective: "work", goalId: "g1", now: 10 });
    const started = startTurnAccounting(active, 20);
    const accounted = accountElapsedTime(started, 25);
    expect(accounted.goal?.timeUsedSeconds).toBe(15);
    const same = accountElapsedTime(accounted, 24);
    expect(same.goal?.timeUsedSeconds).toBe(15);
    expect(same.runtime.lastAccountedAt).toBe(25);
    expect(accountElapsedTime(same, 30).goal?.timeUsedSeconds).toBe(20);
  });

  it("accounts assistant usage and cache policy", () => {
    const active = createGoal(emptyGoalState(), { objective: "work", goalId: "g1", now: 10 });
    const accounted = accountAssistantUsage(active, { inputTokens: 10, outputTokens: 20, cachedInputTokens: 5, cacheCreationInputTokens: 2 });
    expect(accounted.goal?.tokensUsed).toBe(30);
    expect(accounted.goal?.tokenBreakdown.cacheRead).toBe(5);
    expect(countedTokens({ input: 1, output: 2, cacheRead: 3, cacheWrite: 0 }, { countCachedInputTokens: true })).toBe(6);
  });

  it("does not account assistant usage for inactive goals", () => {
    const active = createGoal(emptyGoalState(), { objective: "work", goalId: "g1", now: 10 });
    const paused = pauseGoal(active, { now: 11 });
    const accounted = accountAssistantUsage(paused, { input: 10, output: 20 });
    expect(accounted.goal?.tokensUsed).toBe(0);
  });

  it("applies budget limits at lifecycle boundaries", () => {
    const active = createGoal(emptyGoalState(), { objective: "work", tokenBudget: 10, goalId: "g1", now: 10 });
    const used = accountAssistantUsage(active, { input: 5, output: 5 });
    const limited = maybeApplyBudgetLimit(used, 20);
    expect(limited.goal?.status).toBe("budget_limited");
  });
});
