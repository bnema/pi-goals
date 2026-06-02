import { validatePositiveBudget } from "./validation.js";

export type GoalCommand =
  | { kind: "summary" }
  | { kind: "status" }
  | { kind: "help" }
  | { kind: "config" }
  | { kind: "edit" }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "clear"; force: boolean }
  | { kind: "create"; objective: string; tokenBudget: number | null; force: boolean }
  | { kind: "set-budget"; tokenBudget: number }
  | { kind: "clear-budget"; force: boolean };

export class GoalParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoalParseError";
  }
}

const RESERVED = new Set([
  "status",
  "help",
  "edit",
  "pause",
  "resume",
  "clear",
  "budget",
  "config",
  "--budget",
  "--tokens",
  "--force",
]);

export function parseGoalCommand(args: string): GoalCommand {
  const tokens = splitArgs(args);
  if (tokens.length === 0) return { kind: "summary" };

  const force = removeFlag(tokens, "--force");
  if (force && tokens.length === 0) throw new GoalParseError("Usage: /goal --force <objective|clear|budget clear>.");
  const [first] = tokens;

  if (first === "status") return assertNoExtra(tokens, { kind: "status" });
  if (first === "help") return assertNoExtra(tokens, { kind: "help" });
  if (first === "config") return assertNoExtra(tokens, { kind: "config" });
  if (first === "edit") return assertNoExtra(tokens, { kind: "edit" });
  if (first === "pause") return assertNoExtra(tokens, { kind: "pause" });
  if (first === "resume") return assertNoExtra(tokens, { kind: "resume" });
  if (first === "clear") return assertNoExtra(tokens, { kind: "clear", force });

  if (first === "budget") {
    if (tokens.length === 2 && tokens[1] === "clear") return { kind: "clear-budget", force };
    if (tokens.length === 2) return { kind: "set-budget", tokenBudget: parseBudget(tokens[1] ?? "") };
    throw new GoalParseError("Usage: /goal budget <tokens> or /goal budget clear.");
  }

  if (first === "--budget" || first === "--tokens") {
    if (tokens.length < 3) throw new GoalParseError(`Usage: /goal ${first} <tokens> <objective>.`);
    const budgetToken = tokens[1] ?? "";
    const objective = tokens.slice(2).join(" ");
    return { kind: "create", objective, tokenBudget: parseBudget(budgetToken), force };
  }

  if (first?.startsWith("--")) {
    throw new GoalParseError(`Unknown /goal flag: ${first}.`);
  }

  if (tokens.length === 1 && first && RESERVED.has(first)) {
    throw new GoalParseError(`Reserved /goal subcommand cannot be used as an objective: ${first}.`);
  }

  return { kind: "create", objective: tokens.join(" "), tokenBudget: null, force };
}

export function parseBudget(input: string): number {
  const trimmed = input.trim();
  const match = /^(\d+(?:\.\d+)?)([kKmM])?$/.exec(trimmed);
  if (!match) throw new GoalParseError(`Invalid token budget: ${input}.`);
  if (!match[2] && match[1]?.includes(".")) {
    throw new GoalParseError(`Invalid token budget: ${input}. Plain token budgets must be integers.`);
  }
  const number = Number(match[1]);
  const suffix = match[2]?.toLowerCase();
  const multiplier = suffix === "m" ? 1_000_000 : suffix === "k" ? 1_000 : 1;
  return validatePositiveBudget(number * multiplier);
}

export function splitArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const char of input.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaped) current += "\\";
  if (quote) throw new GoalParseError("Unclosed quote in /goal command.");
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function removeFlag(tokens: string[], flag: string): boolean {
  const index = tokens.indexOf(flag);
  if (index === -1) return false;
  tokens.splice(index, 1);
  return true;
}

function assertNoExtra<T extends GoalCommand>(tokens: string[], command: T): T {
  if (tokens.length > 1) throw new GoalParseError(`Unexpected arguments after /goal ${tokens[0]}.`);
  return command;
}
