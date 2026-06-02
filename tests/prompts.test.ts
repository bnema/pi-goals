import { describe, expect, it } from "vitest";
import { createGoal, emptyGoalState } from "../src/goal-state.js";
import { activeGoalContextPrompt, budgetLimitPrompt, continuationPrompt, objectiveUpdatedPrompt } from "../src/prompts.js";

describe("hidden prompt templates", () => {
  it("wraps objectives as untrusted data and includes audit rules", () => {
    const state = createGoal(emptyGoalState(), { objective: 'finish "quotes"', tokenBudget: 1000, goalId: "g1", now: 10 });
    const goal = state.goal!;
    expect(activeGoalContextPrompt(goal, state.config)).toContain("untrusted user-provided data");
    expect(continuationPrompt(goal, state.config)).toContain("Completion audit");
    expect(continuationPrompt(goal, state.config)).toContain("Blocked audit");
    expect(continuationPrompt(goal, state.config)).toContain(JSON.stringify(goal.objective));
    expect(budgetLimitPrompt(goal, state.config)).toContain("Do not start new substantive work");
    expect(objectiveUpdatedPrompt(goal, state.config)).toContain("supersedes");
  });
});
