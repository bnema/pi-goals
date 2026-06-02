export const GOAL_STATE_CUSTOM_TYPE = "pi-goals/state";
export const GOAL_CONTEXT_CUSTOM_TYPE = "pi-goals/context";

export const GOAL_STATUSES = [
  "active",
  "paused",
  "blocked",
  "usage_limited",
  "budget_limited",
  "complete",
] as const;

export type GoalStatus = (typeof GOAL_STATUSES)[number];

export interface TokenBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface BlockedAudit {
  active: boolean;
  blockerKey: string | null;
  consecutiveTurns: number;
  resumedAt: number | null;
}

export interface ThreadGoal {
  goalId: string;
  objective: string;
  status: GoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  tokenBreakdown: TokenBreakdown;
  timeUsedSeconds: number;
  continuationCount: number;
  blockedAudit: BlockedAudit;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  terminalReason: string | null;
}

export interface GoalRuntimeSnapshot {
  activeTurnStartedAt: number | null;
  lastAccountedAt: number | null;
  lastAssistantEntryId: string | null;
  lastContinuationRequestId: string | null;
  wrapUpScheduledForGoalId: string | null;
  autoContinueSuppressedReason: string | null;
  noProgressTurns: number;
}

export interface GoalConfigSnapshot {
  maxObjectiveChars: number;
  maxAutoContinuations: number;
  noProgressTurnLimit: number;
  countCachedInputTokens: boolean;
  defaultTokenBudget: number | null;
  showWidget: boolean;
  autoContinue: boolean;
}

export interface GoalMutationRecord {
  type: string;
  actor: "user" | "model" | "system";
  at: number;
  goalId: string | null;
  details?: Record<string, unknown>;
}

export interface GoalStateV1 {
  schemaVersion: 1;
  goal: ThreadGoal | null;
  runtime: GoalRuntimeSnapshot;
  config: GoalConfigSnapshot;
  lastMutation: GoalMutationRecord | null;
}

interface RestorableGoalStateV1 {
  schemaVersion: 1;
  goal: ThreadGoal | null;
  runtime?: Partial<GoalRuntimeSnapshot>;
  config?: Partial<GoalConfigSnapshot>;
  lastMutation?: GoalMutationRecord | null;
}

export type JsonSerializable =
  | null
  | boolean
  | number
  | string
  | JsonSerializable[]
  | { [key: string]: JsonSerializable };

export interface TransitionOptions {
  now?: number;
  actor?: GoalMutationRecord["actor"];
  details?: Record<string, unknown>;
}

export interface CreateGoalInput extends TransitionOptions {
  objective: string;
  tokenBudget?: number | null;
  goalId?: string;
}

export interface EditGoalInput extends TransitionOptions {
  objective: string;
}

export const DEFAULT_GOAL_CONFIG: GoalConfigSnapshot = {
  maxObjectiveChars: 4000,
  maxAutoContinuations: 50,
  noProgressTurnLimit: 3,
  countCachedInputTokens: false,
  defaultTokenBudget: null,
  showWidget: false,
  autoContinue: true,
};

export function emptyRuntimeSnapshot(): GoalRuntimeSnapshot {
  return {
    activeTurnStartedAt: null,
    lastAccountedAt: null,
    lastAssistantEntryId: null,
    lastContinuationRequestId: null,
    wrapUpScheduledForGoalId: null,
    autoContinueSuppressedReason: null,
    noProgressTurns: 0,
  };
}

export function emptyTokenBreakdown(): TokenBreakdown {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
}

export function emptyBlockedAudit(resumedAt: number | null = null): BlockedAudit {
  return {
    active: false,
    blockerKey: null,
    consecutiveTurns: 0,
    resumedAt,
  };
}

export function emptyGoalState(config: Partial<GoalConfigSnapshot> = {}): GoalStateV1 {
  return {
    schemaVersion: 1,
    goal: null,
    runtime: emptyRuntimeSnapshot(),
    config: { ...DEFAULT_GOAL_CONFIG, ...config },
    lastMutation: null,
  };
}

export function isTerminalGoalStatus(status: GoalStatus): boolean {
  return status === "blocked" || status === "usage_limited" || status === "budget_limited" || status === "complete";
}

export function canAutoContinue(goal: ThreadGoal | null): boolean {
  return goal?.status === "active";
}

export function remainingTokens(goal: ThreadGoal | null): number | null {
  if (!goal || goal.tokenBudget === null) return null;
  return Math.max(0, goal.tokenBudget - goal.tokensUsed);
}

export function isUnfinishedGoal(goal: ThreadGoal | null): boolean {
  return goal !== null && goal.status !== "complete";
}

export function createGoal(state: GoalStateV1, input: CreateGoalInput): GoalStateV1 {
  const now = input.now ?? unixNow();
  const tokenBudget = input.tokenBudget === undefined ? state.config.defaultTokenBudget : input.tokenBudget;
  const goalId = input.goalId ?? generateGoalId(now);
  const goal: ThreadGoal = {
    goalId,
    objective: input.objective,
    status: "active",
    tokenBudget: tokenBudget ?? null,
    tokensUsed: 0,
    tokenBreakdown: emptyTokenBreakdown(),
    timeUsedSeconds: 0,
    continuationCount: 0,
    blockedAudit: emptyBlockedAudit(),
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    terminalReason: null,
  };
  return withMutation(
    {
      ...state,
      goal,
      runtime: {
        ...emptyRuntimeSnapshot(),
        activeTurnStartedAt: now,
        lastAccountedAt: now,
      },
    },
    "goal.create",
    input.actor ?? "user",
    now,
    goalId,
    input.details,
  );
}

export function replaceGoal(state: GoalStateV1, input: CreateGoalInput): GoalStateV1 {
  return withMutation(
    createGoal({ ...state, goal: null, runtime: emptyRuntimeSnapshot(), lastMutation: null }, input),
    "goal.replace",
    input.actor ?? "user",
    input.now ?? unixNow(),
    undefined,
    input.details,
  );
}

export function editGoal(state: GoalStateV1, input: EditGoalInput): GoalStateV1 {
  if (!state.goal) return state;
  const now = nextUpdatedAt(state.goal, input.now);
  const remaining = remainingTokens(state.goal);
  const reactivated = state.goal.status === "complete" || (state.goal.status === "budget_limited" && remaining !== null && remaining > 0);
  const goal: ThreadGoal = {
    ...state.goal,
    objective: input.objective,
    status: reactivated ? "active" : state.goal.status,
    blockedAudit: emptyBlockedAudit(reactivated ? now : state.goal.blockedAudit.resumedAt),
    updatedAt: now,
    completedAt: reactivated ? null : state.goal.completedAt,
    terminalReason: reactivated ? null : state.goal.terminalReason,
  };
  return withMutation(
    {
      ...state,
      goal,
      runtime: {
        ...state.runtime,
        autoContinueSuppressedReason: null,
        noProgressTurns: 0,
        activeTurnStartedAt: goal.status === "active" ? (state.runtime.activeTurnStartedAt ?? now) : state.runtime.activeTurnStartedAt,
        lastAccountedAt: goal.status === "active" ? (state.runtime.lastAccountedAt ?? now) : state.runtime.lastAccountedAt,
      },
    },
    "goal.edit",
    input.actor ?? "user",
    now,
    goal.goalId,
    input.details,
  );
}

export function pauseGoal(state: GoalStateV1, options: TransitionOptions = {}): GoalStateV1 {
  if (state.goal?.status !== "active") return state;
  return transitionStatus(state, "paused", "goal.pause", options);
}

export function resumeGoal(state: GoalStateV1, options: TransitionOptions = {}): GoalStateV1 {
  if (!state.goal) return state;
  if (!["paused", "blocked", "usage_limited"].includes(state.goal.status)) return state;
  const now = nextUpdatedAt(state.goal, options.now);
  const goal: ThreadGoal = {
    ...state.goal,
    status: "active",
    blockedAudit: emptyBlockedAudit(state.goal.status === "blocked" ? now : state.goal.blockedAudit.resumedAt),
    updatedAt: now,
    completedAt: null,
    terminalReason: null,
  };
  return withMutation(
    {
      ...state,
      goal,
      runtime: {
        ...state.runtime,
        activeTurnStartedAt: now,
        lastAccountedAt: now,
        autoContinueSuppressedReason: null,
        noProgressTurns: 0,
        lastContinuationRequestId: null,
      },
    },
    "goal.resume",
    options.actor ?? "user",
    now,
    goal.goalId,
    options.details,
  );
}

export function clearGoal(state: GoalStateV1, options: TransitionOptions = {}): GoalStateV1 {
  const now = options.now ?? unixNow();
  return withMutation(
    {
      ...state,
      goal: null,
      runtime: emptyRuntimeSnapshot(),
    },
    "goal.clear",
    options.actor ?? "user",
    now,
    state.goal?.goalId ?? null,
    options.details,
  );
}

export function completeGoal(state: GoalStateV1, options: TransitionOptions = {}): GoalStateV1 {
  if (!state.goal) return state;
  const now = nextUpdatedAt(state.goal, options.now);
  const goal: ThreadGoal = {
    ...state.goal,
    status: "complete",
    updatedAt: now,
    completedAt: now,
    terminalReason: "complete",
  };
  return withTerminalMutation(state, goal, "goal.complete", options, now);
}

export function blockGoal(state: GoalStateV1, options: TransitionOptions = {}): GoalStateV1 {
  if (!state.goal) return state;
  const now = nextUpdatedAt(state.goal, options.now);
  const goal: ThreadGoal = {
    ...state.goal,
    status: "blocked",
    updatedAt: now,
    completedAt: null,
    terminalReason: "blocked",
  };
  return withTerminalMutation(state, goal, "goal.block", options, now);
}

export function budgetLimitGoal(state: GoalStateV1, options: TransitionOptions = {}): GoalStateV1 {
  return transitionStatus(state, "budget_limited", "goal.budget_limited", {
    ...options,
    details: { reason: "token budget reached", ...options.details },
  });
}

export function usageLimitGoal(state: GoalStateV1, options: TransitionOptions = {}): GoalStateV1 {
  return transitionStatus(state, "usage_limited", "goal.usage_limited", {
    ...options,
    details: { reason: "provider usage limit", ...options.details },
  });
}

export function setGoalBudget(state: GoalStateV1, tokenBudget: number | null, options: TransitionOptions = {}): GoalStateV1 {
  if (!state.goal) return state;
  const now = nextUpdatedAt(state.goal, options.now);
  let goal: ThreadGoal = {
    ...state.goal,
    tokenBudget,
    updatedAt: now,
  };
  let runtime = state.runtime;
  let type = "goal.budget";
  if (state.goal.status === "budget_limited" && tokenBudget !== null && goal.tokensUsed < tokenBudget) {
    goal = {
      ...goal,
      status: "active",
      terminalReason: null,
    };
    runtime = {
      ...runtime,
      activeTurnStartedAt: now,
      lastAccountedAt: now,
      autoContinueSuppressedReason: null,
      noProgressTurns: 0,
      lastContinuationRequestId: null,
      wrapUpScheduledForGoalId: null,
    };
    type = "goal.budget.resume";
  }
  if (tokenBudget !== null && goal.status === "active" && goal.tokensUsed >= tokenBudget) {
    goal = {
      ...goal,
      status: "budget_limited",
      terminalReason: "budget_limited",
    };
    runtime = { ...runtime, activeTurnStartedAt: null, lastAccountedAt: null };
    type = "goal.budget_limited";
  }
  return withMutation({ ...state, goal, runtime }, type, options.actor ?? "user", now, goal.goalId, options.details);
}

export function clearGoalBudget(state: GoalStateV1, options: TransitionOptions = {}): GoalStateV1 {
  if (!state.goal) return state;
  const now = nextUpdatedAt(state.goal, options.now);
  const resumes = state.goal.status === "budget_limited";
  const goal: ThreadGoal = {
    ...state.goal,
    tokenBudget: null,
    status: resumes ? "active" : state.goal.status,
    updatedAt: now,
    terminalReason: resumes ? null : state.goal.terminalReason,
  };
  return withMutation(
    {
      ...state,
      goal,
      runtime: {
        ...state.runtime,
        activeTurnStartedAt: resumes ? now : state.runtime.activeTurnStartedAt,
        lastAccountedAt: resumes ? now : state.runtime.lastAccountedAt,
        autoContinueSuppressedReason: resumes ? null : state.runtime.autoContinueSuppressedReason,
        noProgressTurns: resumes ? 0 : state.runtime.noProgressTurns,
      },
    },
    "goal.budget.clear",
    options.actor ?? "user",
    now,
    goal.goalId,
    options.details,
  );
}

export function recordBlockedAttempt(state: GoalStateV1, blockerKey: string, options: TransitionOptions = {}): GoalStateV1 {
  if (!state.goal) return state;
  const now = nextUpdatedAt(state.goal, options.now);
  const previous = state.goal.blockedAudit;
  const sameBlocker = previous.active && previous.blockerKey === blockerKey;
  const goal: ThreadGoal = {
    ...state.goal,
    blockedAudit: {
      active: true,
      blockerKey,
      consecutiveTurns: sameBlocker ? previous.consecutiveTurns + 1 : 1,
      resumedAt: previous.resumedAt,
    },
    updatedAt: now,
  };
  return withMutation(
    { ...state, goal },
    "goal.blocked_audit",
    options.actor ?? "model",
    now,
    goal.goalId,
    { blockerKey, ...options.details },
  );
}

export function resetBlockedAudit(state: GoalStateV1, options: TransitionOptions = {}): GoalStateV1 {
  if (!state.goal) return state;
  const now = nextUpdatedAt(state.goal, options.now);
  const goal: ThreadGoal = {
    ...state.goal,
    blockedAudit: emptyBlockedAudit(state.goal.blockedAudit.resumedAt),
    updatedAt: now,
  };
  return withMutation(
    { ...state, goal },
    "goal.blocked_audit.reset",
    options.actor ?? "system",
    now,
    goal.goalId,
    options.details,
  );
}

export function updateRuntime(
  state: GoalStateV1,
  updater: (runtime: GoalRuntimeSnapshot) => GoalRuntimeSnapshot,
  options: TransitionOptions & { type?: string } = {},
): GoalStateV1 {
  const now = options.now ?? unixNow();
  return withMutation(
    { ...state, runtime: updater(state.runtime) },
    options.type ?? "goal.runtime",
    options.actor ?? "system",
    now,
    state.goal?.goalId ?? null,
    options.details,
  );
}

export function snapshotState(state: GoalStateV1): JsonSerializable {
  return JSON.parse(JSON.stringify(state)) as JsonSerializable;
}

export function restoreStateFromBranch(entries: readonly unknown[], config: Partial<GoalConfigSnapshot> = {}): GoalStateV1 {
  let restored: GoalStateV1 | null = null;
  for (const entry of entries) {
    const customEntry = entry as { type?: unknown; customType?: unknown; data?: unknown };
    if (customEntry.type !== "custom" || customEntry.customType !== GOAL_STATE_CUSTOM_TYPE) continue;
    if (!isGoalState(customEntry.data)) continue;
    restored = normalizeRestoredState(customEntry.data, config);
  }
  return restored ?? emptyGoalState(config);
}

export function appendState(pi: { appendEntry?: (customType: string, data?: JsonSerializable) => unknown }, state: GoalStateV1): void {
  pi.appendEntry?.(GOAL_STATE_CUSTOM_TYPE, snapshotState(state));
}

function transitionStatus(
  state: GoalStateV1,
  status: GoalStatus,
  type: string,
  options: TransitionOptions = {},
): GoalStateV1 {
  if (!state.goal) return state;
  const now = nextUpdatedAt(state.goal, options.now);
  const terminal = isTerminalGoalStatus(status) || status === "paused";
  const goal: ThreadGoal = {
    ...state.goal,
    status,
    updatedAt: now,
    completedAt: status === "complete" ? now : state.goal.completedAt,
    terminalReason: isTerminalGoalStatus(status) ? status : state.goal.terminalReason,
  };
  return withMutation(
    {
      ...state,
      goal,
      runtime: terminal
        ? { ...state.runtime, activeTurnStartedAt: null, lastAccountedAt: null, lastContinuationRequestId: null }
        : state.runtime,
    },
    type,
    options.actor ?? "user",
    now,
    goal.goalId,
    options.details,
  );
}

function withTerminalMutation(
  state: GoalStateV1,
  goal: ThreadGoal,
  type: string,
  options: TransitionOptions,
  now: number,
): GoalStateV1 {
  return withMutation(
    {
      ...state,
      goal,
      runtime: {
        ...state.runtime,
        activeTurnStartedAt: null,
        lastAccountedAt: null,
        lastContinuationRequestId: null,
      },
    },
    type,
    options.actor ?? "model",
    now,
    goal.goalId,
    options.details,
  );
}

function withMutation(
  state: GoalStateV1,
  type: string,
  actor: GoalMutationRecord["actor"],
  at: number,
  goalId: string | null | undefined,
  details?: Record<string, unknown>,
): GoalStateV1 {
  return {
    ...state,
    lastMutation: {
      type,
      actor,
      at,
      goalId: goalId ?? state.goal?.goalId ?? null,
      ...(details ? { details } : {}),
    },
  };
}

function isGoalState(value: unknown): value is RestorableGoalStateV1 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RestorableGoalStateV1>;
  return (
    candidate.schemaVersion === 1 &&
    (candidate.goal === null || isThreadGoal(candidate.goal)) &&
    (candidate.runtime === undefined || isObjectRecord(candidate.runtime)) &&
    (candidate.config === undefined || isObjectRecord(candidate.config)) &&
    (candidate.lastMutation === null || candidate.lastMutation === undefined || isMutationRecord(candidate.lastMutation))
  );
}

function normalizeRestoredState(state: RestorableGoalStateV1, config: Partial<GoalConfigSnapshot>): GoalStateV1 {
  return {
    schemaVersion: 1,
    goal: state.goal,
    runtime: { ...emptyRuntimeSnapshot(), ...sanitizeRuntimeSnapshot(state.runtime) },
    config: { ...DEFAULT_GOAL_CONFIG, ...sanitizeConfigSnapshot(state.config), ...sanitizeConfigSnapshot(config) },
    lastMutation: state.lastMutation ?? null,
  };
}

function sanitizeRuntimeSnapshot(value: unknown): Partial<GoalRuntimeSnapshot> {
  if (!isObjectRecord(value)) return {};
  const runtime = value as Partial<GoalRuntimeSnapshot>;
  const sanitized: Partial<GoalRuntimeSnapshot> = {};
  if (isNullableNumber(runtime.activeTurnStartedAt)) sanitized.activeTurnStartedAt = runtime.activeTurnStartedAt;
  if (isNullableNumber(runtime.lastAccountedAt)) sanitized.lastAccountedAt = runtime.lastAccountedAt;
  if (isNullableString(runtime.lastAssistantEntryId)) sanitized.lastAssistantEntryId = runtime.lastAssistantEntryId;
  if (isNullableString(runtime.lastContinuationRequestId)) sanitized.lastContinuationRequestId = runtime.lastContinuationRequestId;
  if (isNullableString(runtime.wrapUpScheduledForGoalId)) sanitized.wrapUpScheduledForGoalId = runtime.wrapUpScheduledForGoalId;
  if (isNullableString(runtime.autoContinueSuppressedReason)) sanitized.autoContinueSuppressedReason = runtime.autoContinueSuppressedReason;
  if (isNonNegativeInteger(runtime.noProgressTurns)) sanitized.noProgressTurns = runtime.noProgressTurns;
  return sanitized;
}

function sanitizeConfigSnapshot(value: unknown): Partial<GoalConfigSnapshot> {
  if (!isObjectRecord(value)) return {};
  const config = value as Partial<GoalConfigSnapshot>;
  const sanitized: Partial<GoalConfigSnapshot> = {};
  if (isPositiveInteger(config.maxObjectiveChars)) sanitized.maxObjectiveChars = config.maxObjectiveChars;
  if (isNonNegativeInteger(config.maxAutoContinuations)) sanitized.maxAutoContinuations = config.maxAutoContinuations;
  if (isPositiveInteger(config.noProgressTurnLimit)) sanitized.noProgressTurnLimit = config.noProgressTurnLimit;
  if (typeof config.countCachedInputTokens === "boolean") sanitized.countCachedInputTokens = config.countCachedInputTokens;
  if (config.defaultTokenBudget === null || isPositiveInteger(config.defaultTokenBudget)) sanitized.defaultTokenBudget = config.defaultTokenBudget;
  if (typeof config.showWidget === "boolean") sanitized.showWidget = config.showWidget;
  if (typeof config.autoContinue === "boolean") sanitized.autoContinue = config.autoContinue;
  return sanitized;
}

function isThreadGoal(value: unknown): value is ThreadGoal {
  if (!value || typeof value !== "object") return false;
  const goal = value as Partial<ThreadGoal>;
  return (
    typeof goal.goalId === "string" &&
    typeof goal.objective === "string" &&
    isGoalStatus(goal.status) &&
    (goal.tokenBudget === null || isNonNegativeInteger(goal.tokenBudget)) &&
    isNonNegativeInteger(goal.tokensUsed) &&
    isTokenBreakdown(goal.tokenBreakdown) &&
    isNonNegativeInteger(goal.timeUsedSeconds) &&
    isNonNegativeInteger(goal.continuationCount) &&
    isBlockedAudit(goal.blockedAudit) &&
    isNonNegativeInteger(goal.createdAt) &&
    isNonNegativeInteger(goal.updatedAt) &&
    (goal.completedAt === null || isNonNegativeInteger(goal.completedAt)) &&
    (goal.terminalReason === null || typeof goal.terminalReason === "string")
  );
}

function isMutationRecord(value: unknown): value is GoalMutationRecord {
  if (!value || typeof value !== "object") return false;
  const mutation = value as Partial<GoalMutationRecord>;
  return (
    typeof mutation.type === "string" &&
    (mutation.actor === "user" || mutation.actor === "model" || mutation.actor === "system") &&
    isNonNegativeInteger(mutation.at) &&
    (mutation.goalId === null || typeof mutation.goalId === "string")
  );
}

function isTokenBreakdown(value: unknown): value is TokenBreakdown {
  if (!value || typeof value !== "object") return false;
  const tokens = value as Partial<TokenBreakdown>;
  return (
    isNonNegativeInteger(tokens.input) &&
    isNonNegativeInteger(tokens.output) &&
    isNonNegativeInteger(tokens.cacheRead) &&
    isNonNegativeInteger(tokens.cacheWrite)
  );
}

function isBlockedAudit(value: unknown): value is BlockedAudit {
  if (!value || typeof value !== "object") return false;
  const audit = value as Partial<BlockedAudit>;
  return (
    typeof audit.active === "boolean" &&
    isNullableString(audit.blockerKey) &&
    isNonNegativeInteger(audit.consecutiveTurns) &&
    isNullableNumber(audit.resumedAt)
  );
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isGoalStatus(value: unknown): value is GoalStatus {
  return typeof value === "string" && (GOAL_STATUSES as readonly string[]).includes(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isNonNegativeInteger(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function nextUpdatedAt(goal: ThreadGoal, now: number | undefined): number {
  return Math.max(now ?? unixNow(), goal.updatedAt + 1);
}

function generateGoalId(now: number): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${now}-${Math.random().toString(36).slice(2, 10)}`;
  return `goal_${random}`;
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}
