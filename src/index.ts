import { DEFAULT_CONFIG, snapshotConfig } from "./config.js";
import { emptyGoalState } from "./goal-state.js";
import { registerGoalCommand } from "./commands.js";
import { registerGoalLifecycle } from "./lifecycle.js";
import { registerGoalTools } from "./tools.js";
import { createGoalStore, type PiGoalsStore } from "./types.js";

export { handleGoalCommand } from "./commands.js";
export { maybeScheduleContinuation, restoreFromSession } from "./lifecycle.js";
export * from "./accounting.js";
export * from "./config.js";
export * from "./goal-state.js";
export * from "./parsing.js";
export * from "./prompts.js";
export * from "./tools.js";
export * from "./ui.js";
export * from "./validation.js";

export function registerPiGoals(pi: unknown): PiGoalsStore {
  const store = createGoalStore(emptyGoalState(snapshotConfig(DEFAULT_CONFIG)), DEFAULT_CONFIG);
  const api = pi as Parameters<typeof registerGoalCommand>[0] & Parameters<typeof registerGoalTools>[0] & Parameters<typeof registerGoalLifecycle>[0];
  registerGoalCommand(api, store);
  registerGoalTools(api, store);
  registerGoalLifecycle(api, store);
  return store;
}
