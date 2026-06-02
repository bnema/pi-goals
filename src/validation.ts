import type { GoalStatus, ThreadGoal } from "./goal-state.js";

export class GoalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoalValidationError";
  }
}

export function normalizeObjective(objective: string, maxChars = 4000): string {
  const trimmed = objective.trim();
  if (trimmed.length === 0) {
    throw new GoalValidationError("Goal objective must be non-empty.");
  }
  if (trimmed.length > maxChars) {
    throw new GoalValidationError(`Goal objective must be at most ${maxChars} characters.`);
  }
  return trimmed;
}

export function validatePositiveBudget(value: number): number {
  const parsed = Math.floor(value);
  if (!Number.isFinite(value) || parsed <= 0) {
    throw new GoalValidationError("Token budget must be a positive number.");
  }
  return parsed;
}

export function validateModelToolStatus(status: string): Extract<GoalStatus, "complete" | "blocked"> {
  if (status !== "complete" && status !== "blocked") {
    throw new GoalValidationError("Model tools may only set goal status to complete or blocked.");
  }
  return status;
}

export function canAcceptBlocked(goal: ThreadGoal | null, blockerKey: string, threshold = 3): boolean {
  if (!goal) return false;
  return (
    goal.status === "active" &&
    goal.blockedAudit.active &&
    goal.blockedAudit.blockerKey === blockerKey &&
    goal.blockedAudit.consecutiveTurns >= threshold
  );
}

export function requireGoal(goal: ThreadGoal | null): ThreadGoal {
  if (!goal) throw new GoalValidationError("No current goal exists.");
  return goal;
}
