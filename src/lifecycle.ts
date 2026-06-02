import { accountAssistantUsage, accountElapsedTime, maybeApplyBudgetLimit, startTurnAccounting } from "./accounting.js";
import { loadGoalConfig, snapshotConfig } from "./config.js";
import {
  appendState,
  GOAL_CONTEXT_CUSTOM_TYPE,
  budgetLimitGoal,
  restoreStateFromBranch,
  updateRuntime,
  usageLimitGoal,
  type GoalStateV1,
  emptyBlockedAudit,
} from "./goal-state.js";
import { activeGoalContextPrompt, budgetLimitPrompt, continuationPrompt } from "./prompts.js";
import type { PiGoalsStore } from "./types.js";
import { updateGoalUi } from "./ui.js";

export interface LifecycleApi {
  on(event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown> | unknown): void;
  appendEntry?: (customType: string, data?: unknown) => unknown;
  sendMessage?: (message: Record<string, unknown>, options?: Record<string, unknown>) => unknown;
}

export function registerGoalLifecycle(pi: LifecycleApi, store: PiGoalsStore): void {
  let turnHadProgress = false;
  let assistantTextForTurn = "";

  pi.on("session_start", async (_event, ctx) => {
    restoreFromSession(ctx, store);
    updateGoalUi(ctx, store.getState());
  });

  pi.on("session_tree", async (_event, ctx) => {
    restoreFromSession(ctx, store);
    updateGoalUi(ctx, store.getState());
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    const now = unixNow();
    const accounted = accountElapsedTime(store.getState(), now);
    const state =
      accounted.goal?.status === "active"
        ? updateRuntime(
            accounted,
            (runtime) => ({ ...runtime, activeTurnStartedAt: null, lastAccountedAt: null }),
            { type: "goal.shutdown_account", actor: "system", now },
          )
        : accounted;
    if (state !== store.getState()) {
      store.setState(state);
      appendState(pi, state);
      updateGoalUi(ctx, state);
    }
  });

  pi.on("before_agent_start", async (_event, _ctx) => {
    const state = store.getState();
    if (state.goal?.status !== "active") return undefined;
    const message = {
      customType: GOAL_CONTEXT_CUSTOM_TYPE,
      content: activeGoalContextPrompt(state.goal, state.config),
      display: false,
      details: { goalId: state.goal.goalId },
    };
    return {
      message,
      messages: [message],
    };
  });

  pi.on("turn_start", async (_event, ctx) => {
    store.advanceTurn();
    turnHadProgress = false;
    assistantTextForTurn = "";
    const started = startTurnAccounting(store.getState(), unixNow());
    const next =
      started.goal?.status === "active"
        ? { ...started, runtime: { ...started.runtime, lastContinuationRequestId: null } }
        : started;
    store.setState(next);
    updateGoalUi(ctx, next);
  });

  pi.on("tool_result", async (event, _ctx) => {
    const toolName = extractToolName(event);
    if (toolName && !["get_goal", "create_goal", "update_goal"].includes(toolName)) turnHadProgress = true;
  });

  pi.on("message_end", async (event, ctx) => {
    const state = store.getState();
    if (!state.goal) return;
    const text = extractText(event);
    assistantTextForTurn = appendAssistantText(assistantTextForTurn, text);
    if (isMeaningfulAssistantText(assistantTextForTurn, store.getConfig().noProgressTextThreshold)) turnHadProgress = true;
    let next = accountAssistantUsage(state, extractUsage(event));
    const errorText = extractErrorText(event);
    if (next.goal?.status === "active" && errorText && isUsageLimitText(errorText, store.getConfig().usageLimitPatterns)) {
      const now = unixNow();
      next = usageLimitGoal(accountElapsedTime(next, now), { actor: "system", now, details: { text: errorText.slice(0, 240) } });
      notify(ctx, "Goal stopped by provider usage limit.", "warning");
    }
    if (next !== state) {
      store.setState(next);
      appendState(pi, next);
      updateGoalUi(ctx, next);
    }
  });

  pi.on("turn_end", async (_event, ctx) => {
    const state = store.getState();
    let next = accountElapsedTime(state, unixNow());
    next = updateProgressRuntime(next, turnHadProgress, store.getConfig().noProgressTurnLimit);
    next = maybeApplyBudgetLimit(next, unixNow());
    if (next.goal?.status === "budget_limited" && state.goal?.status !== "budget_limited") {
      notify(ctx, "Goal token budget reached.", "warning");
    }
    if (next.runtime.autoContinueSuppressedReason && next.runtime.autoContinueSuppressedReason !== state.runtime.autoContinueSuppressedReason) {
      notify(ctx, `Goal auto-continuation suppressed: ${next.runtime.autoContinueSuppressedReason}.`, "warning");
    }
    if (next !== state) {
      store.setState(next);
      appendState(pi, next);
      updateGoalUi(ctx, next);
    }
  });

  pi.on("agent_end", async (_event, ctx) => {
    maybeScheduleContinuation(pi, store, ctx);
  });
}

export function restoreFromSession(ctx: unknown, store: PiGoalsStore): void {
  const cwd = (ctx as { cwd?: string }).cwd ?? process.cwd();
  const loaded = loadGoalConfig({ cwd });
  store.setConfig(loaded.config, loaded);
  const entries = (ctx as { sessionManager?: { getBranch?: () => unknown[] } }).sessionManager?.getBranch?.() ?? [];
  const restored = restoreStateFromBranch(entries, snapshotConfig(loaded.config));
  store.clearBlockedAuditTurns();
  store.setState(restored);
}

export function maybeScheduleContinuation(pi: Pick<LifecycleApi, "sendMessage" | "appendEntry">, store: PiGoalsStore, ctx: unknown): boolean {
  const state = store.getState();
  const goal = state.goal;
  if (!goal) return false;

  if (goal.status === "budget_limited") {
    if (state.runtime.autoContinueSuppressedReason) return false;
    if (state.runtime.wrapUpScheduledForGoalId === goal.goalId) return false;
    const message = {
      customType: "pi-goals/budget-wrapup",
      content: budgetLimitPrompt(goal, state.config),
      display: false,
      details: { goalId: goal.goalId },
    };
    const options = { deliverAs: "followUp", triggerTurn: true };
    if (!deliverFollowUp(pi, ctx, message, options)) return suppress(pi, store, ctx, "continuation delivery unavailable");
    const next = updateRuntime(
      state,
      (runtime) => ({ ...runtime, wrapUpScheduledForGoalId: goal.goalId, lastContinuationRequestId: `wrap-${goal.goalId}` }),
      { type: "goal.budget_wrapup", actor: "system", now: unixNow() },
    );
    store.setState(next);
    appendState(pi, next);
    return true;
  }

  if (goal.status !== "active") return false;
  if (!state.config.autoContinue) return suppress(pi, store, ctx, "auto-continuation disabled");
  if (!isIdle(ctx)) return false;
  if (hasPendingMessages(ctx)) return false;
  if (goal.tokenBudget !== null && goal.tokensUsed >= goal.tokenBudget) {
    const next = budgetLimitGoal(state, { actor: "system", now: unixNow() });
    store.setState(next);
    appendState(pi, next);
    return maybeScheduleContinuation(pi, store, ctx);
  }
  if (goal.continuationCount >= state.config.maxAutoContinuations) return suppress(pi, store, ctx, "auto-continuation cap reached");
  if (state.runtime.autoContinueSuppressedReason) return false;
  if (state.runtime.lastContinuationRequestId?.startsWith(goal.goalId)) return false;

  const requestId = `${goal.goalId}:${goal.continuationCount + 1}:${unixNow()}`;
  const next: GoalStateV1 = {
    ...state,
    goal: {
      ...goal,
      continuationCount: goal.continuationCount + 1,
      updatedAt: Math.max(unixNow(), goal.updatedAt + 1),
    },
    runtime: {
      ...state.runtime,
      lastContinuationRequestId: requestId,
    },
    lastMutation: {
      type: "goal.continuation.schedule",
      actor: "system",
      at: unixNow(),
      goalId: goal.goalId,
      details: { requestId },
    },
  };
  const scheduledGoal = next.goal;
  if (!scheduledGoal) return false;
  const message = {
    customType: "pi-goals/continuation",
    content: continuationPrompt(scheduledGoal, next.config),
    display: false,
    details: { goalId: goal.goalId, requestId },
  };
  const options = { deliverAs: "followUp", triggerTurn: true };
  if (!deliverFollowUp(pi, ctx, message, options)) return suppress(pi, store, ctx, "continuation delivery unavailable");
  store.setState(next);
  appendState(pi, next);
  return true;
}

function updateProgressRuntime(state: GoalStateV1, hadProgress: boolean, limit: number): GoalStateV1 {
  if (state.goal?.status !== "active") return state;
  const noProgressTurns = hadProgress ? 0 : state.runtime.noProgressTurns + 1;
  const reason = hadProgress ? null : noProgressTurns >= limit ? "no meaningful progress detected" : state.runtime.autoContinueSuppressedReason;
  const resetBlockedAudit = hadProgress && state.goal.blockedAudit.active;
  if (
    noProgressTurns === state.runtime.noProgressTurns &&
    reason === state.runtime.autoContinueSuppressedReason &&
    !resetBlockedAudit
  ) {
    return state;
  }
  return {
    ...state,
    goal: resetBlockedAudit
      ? {
          ...state.goal,
          blockedAudit: emptyBlockedAudit(state.goal.blockedAudit.resumedAt),
          updatedAt: Math.max(unixNow(), state.goal.updatedAt + 1),
        }
      : state.goal,
    runtime: {
      ...state.runtime,
      noProgressTurns,
      autoContinueSuppressedReason: reason,
      lastContinuationRequestId: hadProgress ? null : state.runtime.lastContinuationRequestId,
    },
    lastMutation: {
      type: hadProgress ? "goal.progress" : "goal.no_progress",
      actor: "system",
      at: unixNow(),
      goalId: state.goal.goalId,
      details: { noProgressTurns, ...(resetBlockedAudit ? { blockedAuditReset: true } : {}) },
    },
  };
}

function suppress(pi: Pick<LifecycleApi, "appendEntry">, store: PiGoalsStore, ctx: unknown, reason: string): boolean {
  const state = store.getState();
  if (state.runtime.autoContinueSuppressedReason === reason) return false;
  const next = updateRuntime(
    state,
    (runtime) => ({ ...runtime, autoContinueSuppressedReason: reason }),
    { type: "goal.continuation.suppressed", actor: "system", now: unixNow(), details: { reason } },
  );
  store.setState(next);
  appendState(pi, next);
  notify(ctx, `Goal auto-continuation suppressed: ${reason}.`, "warning");
  return false;
}

function extractUsage(event: unknown): Record<string, unknown> | null {
  const candidate = event as { usage?: Record<string, unknown>; message?: { usage?: Record<string, unknown> } };
  return candidate.usage ?? candidate.message?.usage ?? null;
}

function extractText(event: unknown): string {
  const candidate = event as { text?: unknown; content?: unknown; error?: unknown; message?: { content?: unknown; text?: unknown; error?: unknown } };
  const value = candidate.text ?? candidate.content ?? candidate.error ?? candidate.message?.text ?? candidate.message?.content ?? candidate.message?.error;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join("\n");
  }
  return value ? JSON.stringify(value) : "";
}

function extractErrorText(event: unknown): string {
  const candidate = event as {
    errorMessage?: unknown;
    error?: unknown;
    message?: { errorMessage?: unknown; error?: unknown };
  };
  const value = candidate.errorMessage ?? candidate.message?.errorMessage ?? candidate.error ?? candidate.message?.error;
  if (typeof value === "string") return value;
  return value ? JSON.stringify(value) : "";
}

function extractToolName(event: unknown): string | null {
  const value = (event as { toolName?: unknown; tool?: unknown; message?: { toolName?: unknown } }).toolName ?? (event as { tool?: unknown }).tool ?? (event as { message?: { toolName?: unknown } }).message?.toolName;
  return typeof value === "string" ? value : null;
}

function appendAssistantText(current: string, text: string): string {
  if (!text) return current;
  return current ? `${current}\n${text}` : text;
}

function isMeaningfulAssistantText(text: string, threshold: number): boolean {
  const normalized = text.trim();
  if (normalized.length < threshold) return false;
  if (PROGRESS_TEXT_PATTERN.test(normalized)) return true;
  return !looksLikeOnlyBlockerRestatement(normalized);
}

function isUsageLimitText(text: string, patterns: string[]): boolean {
  const lower = text.toLowerCase();
  return patterns.some((pattern) => {
    try {
      return new RegExp(pattern, "i").test(text);
    } catch {
      return lower.includes(pattern.toLowerCase());
    }
  });
}

const PROGRESS_TEXT_PATTERN =
  /\b(added|adjusted|built|changed|completed|created|fixed|implemented|patched|ran|refactored|resolved|tested|updated|verified|wrote)\b/i;

function looksLikeOnlyBlockerRestatement(text: string): boolean {
  const lower = text.toLowerCase();
  if (PROGRESS_TEXT_PATTERN.test(text)) return false;
  return lower.includes("blocked") || lower.includes("cannot proceed") || lower.includes("waiting for user");
}

function isIdle(ctx: unknown): boolean {
  const idle = (ctx as { isIdle?: unknown }).isIdle;
  if (typeof idle === "function") return Boolean(idle.call(ctx));
  if (typeof idle === "boolean") return idle;
  return true;
}

function hasPendingMessages(ctx: unknown): boolean {
  const pending = (ctx as { hasPendingMessages?: unknown }).hasPendingMessages;
  if (typeof pending === "function") return Boolean(pending.call(ctx));
  if (typeof pending === "boolean") return pending;
  return false;
}

function notify(ctx: unknown, message: string, level: "info" | "warning"): void {
  (ctx as { ui?: { notify?: (message: string, level?: string) => void } }).ui?.notify?.(message, level);
}

function deliverFollowUp(
  pi: Pick<LifecycleApi, "sendMessage">,
  ctx: unknown,
  message: Record<string, unknown>,
  options: Record<string, unknown>,
): boolean {
  if (!pi.sendMessage) return false;
  try {
    pi.sendMessage(message, options);
    return true;
  } catch (error) {
    notify(ctx, `Goal auto-continuation delivery failed: ${error instanceof Error ? error.message : String(error)}.`, "warning");
    return false;
  }
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}
