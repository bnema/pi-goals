import { accountElapsedTime, maybeApplyBudgetLimit } from "./accounting.js";
import { configHelp } from "./config.js";
import {
  appendState,
  clearGoal,
  clearGoalBudget,
  createGoal,
  editGoal,
  isUnfinishedGoal,
  pauseGoal,
  replaceGoal,
  resumeGoal,
  setGoalBudget,
  updateGoalContext,
  type GoalStateV1,
} from "./goal-state.js";
import { parseGoalCommand, type GoalCommand } from "./parsing.js";
import { goalClearedPrompt, goalContextUpdatedPrompt, goalPausedPrompt, objectiveUpdatedPrompt } from "./prompts.js";
import type { PiGoalsStore } from "./types.js";
import { goalHelpMarkdown, goalSummaryMarkdown, goalSummaryWithContextMarkdown, updateGoalUi } from "./ui.js";
import { normalizeObjective } from "./validation.js";
import type { GoalContextUpdate } from "./goal-context.js";

export interface CommandRegistrationApi {
  registerCommand(name: string, definition: { description: string; handler: (args: string, ctx: unknown) => Promise<void> }): void;
  appendEntry?: (customType: string, data?: unknown) => unknown;
  sendMessage?: (message: Record<string, unknown>, options?: Record<string, unknown>) => unknown;
}

export function registerGoalCommand(pi: CommandRegistrationApi, store: PiGoalsStore): void {
  pi.registerCommand("goal", {
    description: "Manage the current persisted thread goal",
    handler: async (args, ctx) => {
      const output = await handleGoalCommand(pi, store, args, ctx);
      showCommandOutput(ctx, output);
    },
  });
}

export async function handleGoalCommand(
  pi: Pick<CommandRegistrationApi, "appendEntry" | "sendMessage">,
  store: PiGoalsStore,
  args: string,
  ctx: unknown,
): Promise<string> {
  const command = parseGoalCommand(args);
  const config = store.getConfig();
  const now = unixNow();

  if (command.kind === "summary" || command.kind === "status") {
    updateGoalUi(ctx, store.getState());
    return goalSummaryMarkdown(store.getState());
  }

  if (command.kind === "help") return goalHelpMarkdown();

  if (command.kind === "config") {
    const loaded = store.getLoadedConfig();
    return configHelp(config, loaded?.sources ?? []);
  }

  if (command.kind === "context") {
    const state = store.getState();
    updateGoalUi(ctx, state);
    return goalSummaryWithContextMarkdown(state);
  }

  const contextMutation = contextMutationFor(command);
  if (contextMutation) {
    const state = accountElapsedTime(store.getState(), now);
    const next = updateGoalContext(state, contextMutation.update, { actor: "user", now });
    persist(pi, store, ctx, next);
    sendGoalContextUpdatedSteer(pi, ctx, next);
    notify(ctx, contextMutation.notification, "info");
    return goalSummaryWithContextMarkdown(next);
  }

  if (command.kind === "context-clear") {
    const confirmed = await confirmMutation(ctx, command.force, "Clear durable goal context?");
    if (!confirmed) return "Goal context clear cancelled.";
    const state = accountElapsedTime(store.getState(), now);
    const next = updateGoalContext(state, { action: "context.clear" }, { actor: "user", now });
    persist(pi, store, ctx, next);
    sendGoalContextUpdatedSteer(pi, ctx, next);
    notify(ctx, "Goal context cleared.", "info");
    return goalSummaryWithContextMarkdown(next);
  }

  if (command.kind === "create") {
    const objective = normalizeObjective(command.objective, config.maxObjectiveChars);
    const state = accountElapsedTime(store.getState(), now);
    if (state.goal && isUnfinishedGoal(state.goal)) {
      const confirmed = !config.confirmReplace || (await confirmMutation(ctx, command.force, `Replace existing ${state.goal.status} goal?`));
      if (!confirmed) return "Goal replacement cancelled.";
    }
    const next = state.goal
      ? replaceGoal(state, { objective, tokenBudget: command.tokenBudget, actor: "user", now })
      : createGoal(state, { objective, tokenBudget: command.tokenBudget, actor: "user", now });
    persist(pi, store, ctx, next);
    notify(ctx, state.goal ? "Goal replaced." : "Goal created.", "info");
    return goalSummaryMarkdown(next);
  }

  if (command.kind === "edit") {
    const state = accountElapsedTime(store.getState(), now);
    if (!state.goal) return "No current goal to edit.";
    const edited = await editInUi(ctx, state.goal.objective);
    if (edited === null) return "Goal edit cancelled.";
    const objective = normalizeObjective(edited, config.maxObjectiveChars);
    const next = editGoal(state, { objective, actor: "user", now });
    persist(pi, store, ctx, next);
    if (next.goal?.status === "active" && !isIdle(ctx)) {
      pi.sendMessage?.(
        {
          customType: "pi-goals/objective-updated",
          content: objectiveUpdatedPrompt(next.goal, next.config),
          display: false,
          details: { goalId: next.goal.goalId },
        },
        { deliverAs: "steer" },
      );
    }
    notify(ctx, "Goal updated.", "info");
    return goalSummaryMarkdown(next);
  }

  if (command.kind === "pause") {
    const state = accountElapsedTime(store.getState(), now);
    if (!state.goal) return "No current goal to pause.";
    const next = pauseGoal(state, { actor: "user", now });
    if (next === state) return "Goal cannot be paused from its current status.";
    persist(pi, store, ctx, next);
    if (!isIdle(ctx)) {
      pi.sendMessage?.({ customType: "pi-goals/pause", content: goalPausedPrompt(), display: false }, { deliverAs: "steer" });
    }
    notify(ctx, "Goal paused.", "info");
    return goalSummaryMarkdown(next);
  }

  if (command.kind === "resume") {
    const state = store.getState();
    const next = resumeGoal(state, { actor: "user", now });
    if (next === state) return "Goal cannot be resumed from its current status.";
    persist(pi, store, ctx, next);
    notify(ctx, "Goal resumed.", "info");
    if (isIdle(ctx) && next.config.autoContinue) {
      pi.sendMessage?.(
        {
          customType: "pi-goals/resume",
          content: "The user resumed the active pi-goals objective. Continue only if no user work is pending.",
          display: false,
          details: { goalId: next.goal?.goalId },
        },
        { deliverAs: "followUp", triggerTurn: true },
      );
    }
    return goalSummaryMarkdown(next);
  }

  if (command.kind === "clear") {
    const state = accountElapsedTime(store.getState(), now);
    if (!state.goal) return "No current goal to clear.";
    const confirmed = !isUnfinishedGoal(state.goal) || (await confirmMutation(ctx, command.force, `Clear existing ${state.goal.status} goal?`));
    if (!confirmed) return "Goal clear cancelled.";
    const next = clearGoal(state, { actor: "user", now });
    persist(pi, store, ctx, next);
    if (!isIdle(ctx)) {
      pi.sendMessage?.({ customType: "pi-goals/clear", content: goalClearedPrompt(), display: false }, { deliverAs: "steer" });
    }
    notify(ctx, "Goal cleared.", "info");
    return goalSummaryMarkdown(next);
  }

  if (command.kind === "set-budget") {
    const state = accountElapsedTime(store.getState(), now);
    if (!state.goal) return "No current goal to budget.";
    const next = maybeApplyBudgetLimit(setGoalBudget(state, command.tokenBudget, { actor: "user", now }), now);
    persist(pi, store, ctx, next);
    if (next.goal?.status === "budget_limited") notify(ctx, "Goal token budget reached.", "warning");
    return goalSummaryMarkdown(next);
  }

  if (command.kind === "clear-budget") {
    const state = accountElapsedTime(store.getState(), now);
    if (!state.goal) return "No current goal budget to clear.";
    if (state.goal.status === "budget_limited") {
      const confirmed = await confirmMutation(ctx, command.force, "Clear budget and resume this budget-limited goal?");
      if (!confirmed) return "Budget clear cancelled.";
    }
    const next = clearGoalBudget(state, { actor: "user", now });
    persist(pi, store, ctx, next);
    notify(ctx, "Goal budget cleared.", "info");
    return goalSummaryMarkdown(next);
  }

  return "Unknown /goal command.";
}

function persist(
  pi: Pick<CommandRegistrationApi, "appendEntry">,
  store: PiGoalsStore,
  ctx: unknown,
  state: GoalStateV1,
): void {
  store.setState(state);
  appendState(pi, state);
  updateGoalUi(ctx, state);
}

async function confirmMutation(ctx: unknown, force: boolean, message: string): Promise<boolean> {
  if (force) return true;
  if (hasUi(ctx) === false) return false;
  const ui = (ctx as { ui?: { confirm?: (title: string, message: string) => Promise<boolean>; select?: (title: string, choices: string[]) => Promise<string> } }).ui;
  if (ui?.confirm) return ui.confirm("pi-goals", message);
  if (ui?.select) return (await ui.select(message, ["Continue", "Cancel"])) === "Continue";
  return false;
}

async function editInUi(ctx: unknown, objective: string): Promise<string | null> {
  if (hasUi(ctx) === false) return null;
  const editor = (ctx as { ui?: { editor?: (initial: string) => Promise<string | null | undefined> } }).ui?.editor;
  if (!editor) return null;
  const result = await editor(objective);
  return typeof result === "string" ? result : null;
}

function hasUi(ctx: unknown): boolean | undefined {
  const value = (ctx as { hasUI?: unknown; hasUi?: unknown }).hasUI ?? (ctx as { hasUi?: unknown }).hasUi;
  return typeof value === "boolean" ? value : undefined;
}

function isIdle(ctx: unknown): boolean {
  const idle = (ctx as { isIdle?: unknown }).isIdle;
  if (typeof idle === "function") return Boolean(idle.call(ctx));
  if (typeof idle === "boolean") return idle;
  return true;
}

function notify(ctx: unknown, message: string, level: "info" | "warning"): void {
  (ctx as { ui?: { notify?: (message: string, level?: string) => void } }).ui?.notify?.(message, level);
}

function sendGoalContextUpdatedSteer(pi: Pick<CommandRegistrationApi, "sendMessage">, ctx: unknown, state: GoalStateV1): void {
  if (state.goal?.status !== "active" || isIdle(ctx)) return;
  pi.sendMessage?.(
    {
      customType: "pi-goals/context-updated",
      content: goalContextUpdatedPrompt(state.goal, state.context),
      display: false,
      details: { goalId: state.goal.goalId },
    },
    { deliverAs: "steer" },
  );
}

function showCommandOutput(ctx: unknown, message: string): void {
  notify(ctx, message, "info");
}

function contextMutationFor(command: GoalCommand): { update: GoalContextUpdate; notification: string } | null {
  if (command.kind === "ref-add") {
    return {
      update: { action: "ref.add", path: command.path, role: command.role, description: command.description },
      notification: "Goal reference saved.",
    };
  }
  if (command.kind === "instruction-add") {
    return { update: { action: "instruction.add", text: command.text }, notification: "Goal instruction saved." };
  }
  if (command.kind === "criterion-add") {
    return { update: { action: "criterion.add", text: command.text }, notification: "Goal criterion saved." };
  }
  if (command.kind === "reread-set") {
    return { update: { action: "reread.set", policy: command.policy }, notification: "Goal reread policy saved." };
  }
  return null;
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}
