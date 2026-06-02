import { remainingTokens, type GoalStateV1, type ThreadGoal } from "./goal-state.js";

// Nerd Font: nf-fa-bullseye.
export const GOAL_STATUS_ICON = "\uf140";

export function goalStatusLine(state: GoalStateV1): string {
  const goal = state.goal;
  if (!goal) return "";
  if (goal.status === "active") {
    if (goal.tokenBudget !== null) return `${GOAL_STATUS_ICON} ${formatTokens(goal.tokensUsed)} / ${formatTokens(goal.tokenBudget)}`;
    return `${GOAL_STATUS_ICON} ${formatDuration(goal.timeUsedSeconds)}`;
  }
  if (goal.status === "paused") return `${GOAL_STATUS_ICON} paused (/goal resume)`;
  if (goal.status === "blocked") return `${GOAL_STATUS_ICON} blocked (/goal resume)`;
  if (goal.status === "usage_limited") return `${GOAL_STATUS_ICON} usage limited`;
  if (goal.status === "budget_limited") {
    if (goal.tokenBudget !== null) return `${GOAL_STATUS_ICON} budget ${formatTokens(goal.tokensUsed)} / ${formatTokens(goal.tokenBudget)}`;
    return `${GOAL_STATUS_ICON} budget limited`;
  }
  if (goal.tokensUsed > 0) return `${GOAL_STATUS_ICON} achieved (${formatTokens(goal.tokensUsed)} tokens)`;
  return `${GOAL_STATUS_ICON} achieved (${formatDuration(goal.timeUsedSeconds)})`;
}

export function goalWidgetLines(state: GoalStateV1, width = 80): string[] {
  const goal = state.goal;
  if (!goal) return [];
  const remaining = remainingTokens(goal);
  const budget = remaining === null ? "no budget" : `${formatTokens(remaining)} left`;
  return [
    `${statusLabel(goal)}: ${truncate(goal.objective, Math.max(12, width - 16))}`,
    `${formatDuration(goal.timeUsedSeconds)} · ${formatTokens(goal.tokensUsed)} tokens · ${budget}`,
    nextCommands(goal),
  ];
}

export function goalSummaryMarkdown(state: GoalStateV1): string {
  const goal = state.goal;
  if (!goal) {
    return [
      "No current goal.",
      "",
      "Examples:",
      "- `/goal --budget 50k finish the release`",
      "- `/goal write integration tests`",
      "- `/goal help`",
    ].join("\n");
  }
  const remaining = remainingTokens(goal);
  const lines = [
    `# Goal ${statusLabel(goal)}`,
    "",
    `Objective: ${goal.objective}`,
    `Status: ${goal.status}`,
    `Time used: ${formatDuration(goal.timeUsedSeconds)}`,
    `Tokens used: ${formatTokens(goal.tokensUsed)}`,
    `Token budget: ${goal.tokenBudget === null ? "none" : formatTokens(goal.tokenBudget)}`,
  ];
  if (remaining !== null) lines.push(`Tokens remaining: ${formatTokens(remaining)}`);
  lines.push(`Continuations: ${goal.continuationCount}`);
  if (goal.blockedAudit.active) {
    lines.push(`Blocked audit: ${goal.blockedAudit.blockerKey ?? "unknown"} (${goal.blockedAudit.consecutiveTurns})`);
  }
  lines.push("", `Next commands: ${nextCommands(goal)}`);
  return lines.join("\n");
}

export function goalUsageSummary(goal: ThreadGoal): string {
  return [
    `${formatTokens(goal.tokensUsed)} counted tokens`,
    `input ${formatTokens(goal.tokenBreakdown.input)}`,
    `output ${formatTokens(goal.tokenBreakdown.output)}`,
    `cache read ${formatTokens(goal.tokenBreakdown.cacheRead)}`,
    `cache write ${formatTokens(goal.tokenBreakdown.cacheWrite)}`,
    `${formatDuration(goal.timeUsedSeconds)}`,
  ].join(" · ");
}

export function goalHelpMarkdown(): string {
  return [
    "# /goal",
    "",
    "Commands:",
    "- `/goal <objective>`",
    "- `/goal --budget <tokens> <objective>`",
    "- `/goal status`",
    "- `/goal edit`",
    "- `/goal pause`",
    "- `/goal resume`",
    "- `/goal budget <tokens>`",
    "- `/goal budget clear`",
    "- `/goal clear`",
    "- `/goal config`",
    "",
    "Model tools:",
    "- `get_goal` inspects the current goal.",
    "- `create_goal` creates a goal only when explicitly requested and no goal exists.",
    "- `update_goal` accepts only `complete` or strict repeated-blocker `blocked`.",
  ].join("\n");
}

export function updateGoalUi(ctx: unknown, state: GoalStateV1): void {
  const ui = (ctx as { ui?: { setStatus?: (key: string, value: string) => void; setWidget?: (key: string, lines: string[]) => void } }).ui;
  ui?.setStatus?.("pi-goals", goalStatusLine(state));
  if (state.config.showWidget) ui?.setWidget?.("pi-goals", goalWidgetLines(state));
  else ui?.setWidget?.("pi-goals", []);
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${trim(tokens / 1_000_000)}M`;
  if (tokens >= 1_000) return `${trim(tokens / 1_000)}K`;
  return `${tokens}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function statusLabel(goal: ThreadGoal): string {
  if (goal.status === "active") return "active";
  if (goal.status === "paused") return "paused";
  if (goal.status === "blocked") return "blocked";
  if (goal.status === "usage_limited") return "usage limited";
  if (goal.status === "budget_limited") return "budget limited";
  return "achieved";
}

function nextCommands(goal: ThreadGoal): string {
  if (goal.status === "active") return "/goal pause · /goal edit · /goal clear";
  if (goal.status === "paused" || goal.status === "blocked" || goal.status === "usage_limited") {
    return "/goal resume · /goal edit · /goal clear";
  }
  if (goal.status === "budget_limited") return "/goal budget <tokens> · /goal budget clear · /goal edit · /goal clear";
  return "/goal <new objective> · /goal clear";
}

function truncate(input: string, width: number): string {
  if (input.length <= width) return input;
  if (width <= 1) return "…";
  return `${input.slice(0, width - 1)}…`;
}

function trim(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1).replace(/\.0$/, "");
}
