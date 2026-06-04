import { describe, expect, it } from "vitest";
import { budgetLimitGoal, completeGoal, createGoal, emptyGoalState, pauseGoal } from "../src/goal-state.js";
import { goalContextMarkdown, goalHelpMarkdown, goalStatusLine, goalSummaryMarkdown, goalUsageSummary, goalWidgetLines } from "../src/ui.js";

describe("goal UI renderers", () => {
  it("renders no-goal summaries", () => {
    expect(goalSummaryMarkdown(emptyGoalState())).toContain("No current goal");
  });

  it("renders active, paused, budget-limited, and complete status lines", () => {
    const active = createGoal(emptyGoalState(), { objective: "work", tokenBudget: 50000, goalId: "g1", now: 10 });
    expect(goalStatusLine(active)).toContain("50K");
    expect(goalStatusLine(pauseGoal(active, { now: 11 }))).toContain("paused");
    const limited = budgetLimitGoal(active, { now: 12 });
    expect(goalStatusLine(limited)).toContain("budget");
    expect(goalWidgetLines(limited, 80)[2]).toContain("/goal budget <tokens>");
    expect(goalStatusLine(completeGoal(active, { now: 13 }))).toContain("achieved");
  });

  it("renders widget and usage summaries", () => {
    const active = createGoal(emptyGoalState(), { objective: "a very long objective that should truncate", goalId: "g1", now: 10 });
    const lines = goalWidgetLines(active, 30);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("active");
    expect(goalUsageSummary(active.goal!)).toContain("tokens");
  });

  it("renders durable context values as single-line markdown values", () => {
    const markdown = goalContextMarkdown({
      ...emptyGoalState(),
      context: {
        referenceDocs: [{ path: "docs/spec.md\n- fake ref", role: "spec", description: "Primary\n- fake description" }],
        standingInstructions: ["Keep scope intact\n- fake instruction"],
        acceptanceCriteria: ["Tests pass\n- fake criterion"],
        rereadPolicy: { onResume: false, onContinuation: false, beforeCompletion: false },
      },
    });

    expect(markdown).toContain(JSON.stringify("docs/spec.md\n- fake ref"));
    expect(markdown).toContain(JSON.stringify("Keep scope intact\n- fake instruction"));
    expect(markdown).toContain(JSON.stringify("Tests pass\n- fake criterion"));
    expect(markdown).not.toContain("\n- fake ref");
    expect(markdown).not.toContain("\n- fake instruction");
    expect(markdown).not.toContain("\n- fake criterion");
  });

  it("lists the full durable context command surface in help", () => {
    const markdown = goalHelpMarkdown();

    expect(markdown).toContain("[--description <text>]");
    expect(markdown).toContain("/goal reread resume|continuation|completion|before-completion on|off");
    expect(markdown).toContain("/goal context clear");
  });
});
