import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { accountElapsedTime } from "./accounting.js";
import { appendState, blockGoal, completeGoal, createGoal, recordBlockedAttempt, remainingTokens } from "./goal-state.js";
import type { PiGoalsStore } from "./types.js";
import { goalUsageSummary, updateGoalUi } from "./ui.js";
import { canAcceptBlocked, normalizeObjective, validateModelToolStatus, validatePositiveBudget } from "./validation.js";

export interface ToolRegistrationApi {
  registerTool(definition: Record<string, unknown>): void;
  appendEntry?: (customType: string, data?: unknown) => unknown;
}

export function registerGoalTools(pi: ToolRegistrationApi, store: PiGoalsStore): void {
  pi.registerTool({
    name: "get_goal",
    label: "Get Goal",
    description: "Inspect the current pi-goals objective, accounting, and continuation state.",
    parameters: Type.Object({}),
    async execute(_toolCallId: string, _params: unknown, _signal: unknown, _onUpdate: unknown, ctx: unknown) {
      const state = store.getState();
      updateGoalUi(ctx, state);
      return toolResult(
        {
          goal: state.goal,
          remainingTokens: remainingTokens(state.goal),
          autoContinueSuppressedReason: state.runtime.autoContinueSuppressedReason,
        },
        state,
      );
    },
  });

  pi.registerTool({
    name: "create_goal",
    label: "Create Goal",
    description: "Create a new active pi-goals objective only when the user explicitly requested goal creation.",
    promptGuidelines: [
      "Use create_goal only when the user explicitly asks to create or set a persisted goal.",
      "Do not use create_goal when a goal already exists; ask the user to use /goal replacement commands instead.",
      "Do not set token_budget unless the user explicitly asks for a token limit or budget; subscription-based Codex usage does not require a budget.",
    ],
    parameters: Type.Object({
      objective: Type.String({ minLength: 1 }),
      token_budget: Type.Optional(
        Type.Number({
          minimum: 1,
          description: "Optional effort cap in tokens. Provide only when the user explicitly asks for a token limit or budget.",
        }),
      ),
    }),
    async execute(_toolCallId: string, params: { objective: string; token_budget?: number }, _signal: unknown, _onUpdate: unknown, ctx: unknown) {
      const state = store.getState();
      if (state.goal) throw new Error("A goal already exists; use /goal to replace or clear it.");
      const objective = normalizeObjective(params.objective, store.getConfig().maxObjectiveChars);
      const tokenBudget = params.token_budget === undefined ? null : validatePositiveBudget(params.token_budget);
      const next = createGoal(state, { objective, tokenBudget, actor: "model", now: unixNow() });
      store.setState(next);
      appendState(pi, next);
      updateGoalUi(ctx, next);
      return toolResult({ goal: next.goal, remainingTokens: remainingTokens(next.goal) }, next);
    },
  });

  pi.registerTool({
    name: "update_goal",
    label: "Update Goal",
    description: "Mark the current pi-goals objective complete or strictly blocked.",
    promptGuidelines: [
      "Use update_goal complete only when the entire current goal is achieved and verified.",
      "Use update_goal blocked only after the same blocker has recurred for at least three consecutive goal turns.",
      "Never use update_goal for active, paused, budget_limited, usage_limited, resumed, or cleared states.",
    ],
    parameters: Type.Object({
      status: StringEnum(["complete", "blocked"] as const),
      blocker_key: Type.Optional(Type.String()),
      evidence: Type.Optional(Type.String()),
    }),
    async execute(
      _toolCallId: string,
      params: { status: string; blocker_key?: string; evidence?: string },
      _signal: unknown,
      _onUpdate: unknown,
      ctx: unknown,
    ) {
      const status = validateModelToolStatus(params.status);
      const accounted = accountElapsedTime(store.getState(), unixNow());
      if (!accounted.goal) throw new Error("No current goal exists.");

      if (status === "complete") {
        if (accounted.goal.status !== "active") throw new Error("Complete status can only be reported for an active goal.");
        const evidence = params.evidence?.trim();
        if (!evidence) throw new Error("Completion evidence is required.");
        const next = completeGoal(accounted, { actor: "model", now: unixNow(), details: { evidence } });
        store.setState(next);
        appendState(pi, next);
        updateGoalUi(ctx, next);
        return toolResult(
          {
            goal: next.goal,
            completionBudgetReport: next.goal ? completionBudgetReport(next.goal) : null,
            userInstruction: next.goal ? `Report final goal usage to the user: ${goalUsageSummary(next.goal)}.` : null,
          },
          next,
        );
      }

      const blockerKey = params.blocker_key?.trim() || params.evidence?.trim().slice(0, 80) || "unspecified-blocker";
      if (accounted.goal.status !== "active") {
        throw new Error("Blocked status can only be reported for an active goal.");
      }
      const turnKey = store.getTurnKey();
      if (store.getLastBlockedAuditTurn(accounted.goal.goalId) === turnKey) {
        throw new Error(`Blocked audit already recorded for this goal turn; blocker ${blockerKey} must recur in a later goal turn.`);
      }
      const audited = recordBlockedAttempt(accounted, blockerKey, { actor: "model", now: unixNow(), details: { evidence: params.evidence } });
      store.setLastBlockedAuditTurn(accounted.goal.goalId, turnKey);
      if (!canAcceptBlocked(audited.goal, blockerKey, 3)) {
        store.setState(audited);
        appendState(pi, audited);
        updateGoalUi(ctx, audited);
        throw new Error(`Blocked audit not satisfied for ${blockerKey}; same blocker must recur for at least three consecutive goal turns.`);
      }
      const next = blockGoal(audited, { actor: "model", now: unixNow(), details: { blockerKey, evidence: params.evidence } });
      store.setState(next);
      appendState(pi, next);
      updateGoalUi(ctx, next);
      return toolResult({ goal: next.goal, remainingTokens: remainingTokens(next.goal) }, next);
    },
  });
}

function toolResult(payload: Record<string, unknown>, state: unknown): { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: { ...payload, state },
  };
}

function completionBudgetReport(goal: NonNullable<ReturnType<typeof completeGoal>["goal"]>): Record<string, unknown> {
  return {
    goalId: goal.goalId,
    tokensUsed: goal.tokensUsed,
    tokenBudget: goal.tokenBudget,
    remainingTokens: remainingTokens(goal),
    timeUsedSeconds: goal.timeUsedSeconds,
    tokenBreakdown: goal.tokenBreakdown,
  };
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}
