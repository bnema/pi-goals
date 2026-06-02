import {
  budgetLimitGoal,
  type GoalConfigSnapshot,
  type GoalStateV1,
  type TokenBreakdown,
} from "./goal-state.js";

export interface TokenUsageInput {
  input?: number | null;
  output?: number | null;
  cacheRead?: number | null;
  cacheWrite?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
}

export function startTurnAccounting(state: GoalStateV1, now: number): GoalStateV1 {
  if (state.goal?.status !== "active") return state;
  return {
    ...state,
    runtime: {
      ...state.runtime,
      activeTurnStartedAt: state.runtime.activeTurnStartedAt ?? now,
      lastAccountedAt: state.runtime.lastAccountedAt ?? now,
    },
  };
}

export function accountElapsedTime(state: GoalStateV1, now: number): GoalStateV1 {
  if (state.goal?.status !== "active") return state;
  const startedAt = state.runtime.lastAccountedAt ?? state.runtime.activeTurnStartedAt;
  if (startedAt === null || now <= startedAt) {
    return {
      ...state,
      runtime: { ...state.runtime, lastAccountedAt: startedAt ?? now },
    };
  }
  const elapsed = Math.floor(now - startedAt);
  return {
    ...state,
    goal: {
      ...state.goal,
      timeUsedSeconds: state.goal.timeUsedSeconds + elapsed,
      updatedAt: Math.max(now, state.goal.updatedAt + 1),
    },
    runtime: {
      ...state.runtime,
      lastAccountedAt: now,
    },
  };
}

export function accountAssistantUsage(state: GoalStateV1, usage: TokenUsageInput | null | undefined): GoalStateV1 {
  if (state.goal?.status !== "active" || !usage) return state;
  const normalized = normalizeUsage(usage);
  const tokens = countedTokens(normalized, state.config);
  if (tokens <= 0 && normalized.cacheWrite <= 0 && normalized.cacheRead <= 0) return state;
  return {
    ...state,
    goal: {
      ...state.goal,
      tokensUsed: state.goal.tokensUsed + tokens,
      tokenBreakdown: {
        input: state.goal.tokenBreakdown.input + normalized.input,
        output: state.goal.tokenBreakdown.output + normalized.output,
        cacheRead: state.goal.tokenBreakdown.cacheRead + normalized.cacheRead,
        cacheWrite: state.goal.tokenBreakdown.cacheWrite + normalized.cacheWrite,
      },
      updatedAt: Math.max(unixNow(), state.goal.updatedAt + 1),
    },
  };
}

export function countedTokens(usage: TokenBreakdown, config: Pick<GoalConfigSnapshot, "countCachedInputTokens">): number {
  const cachedInput = config.countCachedInputTokens ? usage.cacheRead : 0;
  return usage.input + usage.output + cachedInput;
}

export function maybeApplyBudgetLimit(state: GoalStateV1, now: number): GoalStateV1 {
  if (!state.goal || state.goal.status !== "active" || state.goal.tokenBudget === null) return state;
  if (state.goal.tokensUsed < state.goal.tokenBudget) return state;
  return budgetLimitGoal(state, { actor: "system", now });
}

export function normalizeUsage(usage: TokenUsageInput): TokenBreakdown {
  return {
    input: pickNumber(usage.input, usage.inputTokens, usage.prompt_tokens, usage.promptTokens),
    output: pickNumber(usage.output, usage.outputTokens, usage.completion_tokens, usage.completionTokens),
    cacheRead: pickNumber(usage.cacheRead, usage.cachedInputTokens),
    cacheWrite: pickNumber(usage.cacheWrite, usage.cacheCreationInputTokens),
  };
}

function pickNumber(...values: Array<number | null | undefined>): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
  }
  return 0;
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}
