import { GOAL_REFERENCE_DOC_ROLES, type GoalReferenceDocRole } from "./goal-context.js";
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
  | { kind: "context" }
  | { kind: "ref-add"; path: string; role: GoalReferenceDocRole; description: string | null }
  | { kind: "instruction-add"; text: string }
  | { kind: "criterion-add"; text: string }
  | { kind: "reread-set"; policy: GoalRereadPolicyPatch }
  | { kind: "context-clear"; force: boolean }
  | { kind: "create"; objective: string; tokenBudget: number | null; force: boolean }
  | { kind: "set-budget"; tokenBudget: number }
  | { kind: "clear-budget"; force: boolean };

export interface GoalRereadPolicyPatch {
  onResume?: boolean;
  onContinuation?: boolean;
  beforeCompletion?: boolean;
}

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
  "context",
  "refs",
  "ref",
  "instruction",
  "criterion",
  "reread",
  "budget",
  "config",
  "--budget",
  "--tokens",
  "--force",
]);

export function parseGoalCommand(args: string): GoalCommand {
  const tokens = splitArgs(args);
  if (tokens.length === 0) return { kind: "summary" };

  let prefixForce = false;
  if (tokens[0] === "--force") {
    prefixForce = true;
    tokens.shift();
    if (tokens.length === 0) throw new GoalParseError("Usage: /goal --force <objective|clear|context clear|budget clear>.");
  }
  const [first] = tokens;

  if (prefixForce && first && ["status", "help", "config", "edit", "pause", "resume", "refs", "ref", "instruction", "criterion", "reread"].includes(first)) {
    throw new GoalParseError("Usage: /goal --force <objective|clear|context clear|budget clear>.");
  }

  if (first === "status") return assertNoExtra(tokens, { kind: "status" });
  if (first === "help") return assertNoExtra(tokens, { kind: "help" });
  if (first === "config") return assertNoExtra(tokens, { kind: "config" });
  if (first === "edit") return assertNoExtra(tokens, { kind: "edit" });
  if (first === "pause") return assertNoExtra(tokens, { kind: "pause" });
  if (first === "resume") return assertNoExtra(tokens, { kind: "resume" });
  if (first === "clear") {
    const force = prefixForce || removeFlag(tokens, "--force");
    return assertNoExtra(tokens, { kind: "clear", force });
  }

  if (first === "context") {
    if (tokens.length === 1 && prefixForce) throw new GoalParseError("Usage: /goal --force <objective|clear|context clear|budget clear>.");
    if (tokens.length === 1) return { kind: "context" };
    if (tokens[1] === "clear") {
      const force = prefixForce || removeFlag(tokens, "--force");
      if (tokens.length === 2) return { kind: "context-clear", force };
    }
    throw new GoalParseError("Usage: /goal context or /goal context clear --force.");
  }
  if (first === "refs") return assertNoExtra(tokens, { kind: "context" });
  if (first === "ref") return parseRefCommand(tokens);
  if (first === "instruction") return parseTextAddCommand(tokens, "instruction", "instruction-add");
  if (first === "criterion") return parseTextAddCommand(tokens, "criterion", "criterion-add");
  if (first === "reread") return parseRereadCommand(tokens);

  if (first === "budget") {
    if (tokens[1] === "clear") {
      const force = prefixForce || removeFlag(tokens, "--force");
      if (tokens.length === 2) return { kind: "clear-budget", force };
    }
    if (prefixForce) throw new GoalParseError("Usage: /goal --force <objective|clear|context clear|budget clear>.");
    if (tokens.length === 2) return { kind: "set-budget", tokenBudget: parseBudget(tokens[1] ?? "") };
    throw new GoalParseError("Usage: /goal budget <tokens> or /goal budget clear.");
  }

  if (first === "--budget" || first === "--tokens") {
    const force = prefixForce || removeFlag(tokens, "--force");
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

  const force = prefixForce || removeFlag(tokens, "--force");
  if (tokens.length === 0) throw new GoalParseError("Usage: /goal --force <objective|clear|context clear|budget clear>.");
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

function parseRefCommand(tokens: string[]): GoalCommand {
  const roleUsage = GOAL_REFERENCE_DOC_ROLES.join("|");
  if (tokens[1] !== "add") throw new GoalParseError(`Usage: /goal ref add <path> [--role ${roleUsage}] [--description text...].`);
  const path = tokens[2];
  if (!path || path.startsWith("--")) throw new GoalParseError(`Usage: /goal ref add <path> [--role ${roleUsage}] [--description text...].`);

  let role: GoalReferenceDocRole = "other";
  let description: string | null = null;
  for (let index = 3; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--role") {
      const next = tokens[index + 1];
      if (!next) throw new GoalParseError("Missing value for --role.");
      role = parseReferenceRole(next);
      index += 1;
      continue;
    }
    if (token === "--description") {
      const text = tokens.slice(index + 1).join(" ").trim();
      if (!text) throw new GoalParseError("Missing text for --description.");
      description = text;
      break;
    }
    if (token?.startsWith("--")) throw new GoalParseError(`Unknown /goal ref add flag: ${token}.`);
    throw new GoalParseError(`Unexpected argument after /goal ref add <path>: ${token}.`);
  }

  return { kind: "ref-add", path, role, description };
}

function parseTextAddCommand(
  tokens: string[],
  label: "instruction" | "criterion",
  kind: "instruction-add" | "criterion-add",
): GoalCommand {
  if (tokens[1] !== "add" || tokens.length < 3) throw new GoalParseError(`Usage: /goal ${label} add <text...>.`);
  const text = tokens.slice(2).join(" ").trim();
  if (!text) throw new GoalParseError(`Usage: /goal ${label} add <text...>.`);
  return { kind, text };
}

function parseReferenceRole(input: string): GoalReferenceDocRole {
  if ((GOAL_REFERENCE_DOC_ROLES as readonly string[]).includes(input)) return input as GoalReferenceDocRole;
  throw new GoalParseError(`Invalid reference role: ${input}.`);
}

function parseRereadCommand(tokens: string[]): GoalCommand {
  const scope = tokens[1];
  const value = tokens[2];
  if (scope === "on" || scope === "off") {
    if (tokens.length !== 2) throw new GoalParseError("Usage: /goal reread on|off.");
    return {
      kind: "reread-set",
      policy: {
        onResume: scope === "on",
        onContinuation: scope === "on",
        beforeCompletion: scope === "on",
      },
    };
  }
  if (!scope || !value || tokens.length !== 3) {
    throw new GoalParseError("Usage: /goal reread on|off or /goal reread resume|continuation|completion|before-completion on|off.");
  }
  const enabled = parseRereadValue(value);
  if (scope === "resume") return { kind: "reread-set", policy: { onResume: enabled } };
  if (scope === "continuation") return { kind: "reread-set", policy: { onContinuation: enabled } };
  if (scope === "completion" || scope === "before-completion") return { kind: "reread-set", policy: { beforeCompletion: enabled } };
  throw new GoalParseError("Usage: /goal reread on|off or /goal reread resume|continuation|completion|before-completion on|off.");
}

function parseRereadValue(input: string): boolean {
  if (input === "on") return true;
  if (input === "off") return false;
  throw new GoalParseError(`Invalid reread value: ${input}.`);
}

function assertNoExtra<T extends GoalCommand>(tokens: string[], command: T): T {
  if (tokens.length > 1) throw new GoalParseError(`Unexpected arguments after /goal ${tokens[0]}.`);
  return command;
}
