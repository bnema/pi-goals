import type { GoalConfig, LoadedGoalConfig } from "./config.js";
import type { GoalStateV1 } from "./goal-state.js";

export interface PiGoalsStore {
  getState(): GoalStateV1;
  setState(state: GoalStateV1): void;
  getConfig(): GoalConfig;
  setConfig(config: GoalConfig, loaded?: LoadedGoalConfig): void;
  getLoadedConfig(): LoadedGoalConfig | null;
  getTurnKey(): string;
  advanceTurn(): string;
  getLastBlockedAuditTurn(goalId: string): string | null;
  setLastBlockedAuditTurn(goalId: string, turnKey: string): void;
  clearBlockedAuditTurns(): void;
}

export function createGoalStore(initialState: GoalStateV1, initialConfig: GoalConfig): PiGoalsStore {
  let state = initialState;
  let config = initialConfig;
  let loadedConfig: LoadedGoalConfig | null = null;
  let turnSerial = 0;
  const blockedAuditTurns = new Map<string, string>();
  return {
    getState: () => state,
    setState(next) {
      state = next;
    },
    getConfig: () => config,
    setConfig(next, loaded) {
      config = next;
      loadedConfig = loaded ?? loadedConfig;
      state = { ...state, config: { ...state.config, ...snapshotFromConfig(config) } };
    },
    getLoadedConfig: () => loadedConfig,
    getTurnKey: () => `turn-${turnSerial}`,
    advanceTurn() {
      turnSerial += 1;
      return `turn-${turnSerial}`;
    },
    getLastBlockedAuditTurn(goalId) {
      return blockedAuditTurns.get(goalId) ?? null;
    },
    setLastBlockedAuditTurn(goalId, turnKey) {
      blockedAuditTurns.set(goalId, turnKey);
    },
    clearBlockedAuditTurns() {
      blockedAuditTurns.clear();
    },
  };
}

function snapshotFromConfig(config: GoalConfig): GoalStateV1["config"] {
  return {
    maxObjectiveChars: config.maxObjectiveChars,
    maxAutoContinuations: config.maxAutoContinuations,
    noProgressTurnLimit: config.noProgressTurnLimit,
    countCachedInputTokens: config.countCachedInputTokens,
    defaultTokenBudget: config.defaultTokenBudget,
    showWidget: config.showWidget,
    autoContinue: config.autoContinue,
  };
}
