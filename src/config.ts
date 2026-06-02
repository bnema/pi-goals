import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_GOAL_CONFIG, type GoalConfigSnapshot } from "./goal-state.js";

export interface GoalConfig extends GoalConfigSnapshot {
  confirmReplace: boolean;
  usageLimitPatterns: string[];
  noProgressTextThreshold: number;
}

export interface ConfigLoadOptions {
  cwd?: string;
  home?: string;
  readFile?: (path: string) => string;
  exists?: (path: string) => boolean;
}

export interface LoadedGoalConfig {
  config: GoalConfig;
  warnings: string[];
  sources: string[];
}

export const DEFAULT_CONFIG: GoalConfig = {
  ...DEFAULT_GOAL_CONFIG,
  confirmReplace: true,
  usageLimitPatterns: ["usage limit", "rate limit", "insufficient_quota", "quota exceeded"],
  noProgressTextThreshold: 80,
};

export function snapshotConfig(config: GoalConfig): GoalConfigSnapshot {
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

export function loadGoalConfig(options: ConfigLoadOptions = {}): LoadedGoalConfig {
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? homedir();
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, "utf8"));
  const exists = options.exists ?? existsSync;
  const warnings: string[] = [];
  const sources: string[] = [];
  let config = { ...DEFAULT_CONFIG };

  for (const source of [join(home, ".pi", "agent", "pi-goals.json"), join(cwd, ".pi", "pi-goals.json")]) {
    if (!exists(source)) continue;
    try {
      const parsed = JSON.parse(readFile(source)) as unknown;
      config = mergeConfig(config, parsed, warnings, source);
      sources.push(source);
    } catch (error) {
      warnings.push(`${source}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { config, warnings, sources };
}

export function mergeConfig(base: GoalConfig, value: unknown, warnings: string[] = [], source = "config"): GoalConfig {
  if (!value || typeof value !== "object") {
    warnings.push(`${source}: expected an object.`);
    return base;
  }
  const input = value as Record<string, unknown>;
  const next = { ...base };
  setPositiveInt(input, "maxObjectiveChars", next, warnings, source);
  setNonNegativeInt(input, "maxAutoContinuations", next, warnings, source);
  setPositiveInt(input, "noProgressTurnLimit", next, warnings, source);
  setPositiveInt(input, "noProgressTextThreshold", next, warnings, source);
  setOptionalPositiveInt(input, "defaultTokenBudget", next, warnings, source);
  setBoolean(input, "countCachedInputTokens", next, warnings, source);
  setBoolean(input, "showWidget", next, warnings, source);
  setBoolean(input, "autoContinue", next, warnings, source);
  setBoolean(input, "confirmReplace", next, warnings, source);
  if ("usageLimitPatterns" in input) {
    if (Array.isArray(input.usageLimitPatterns) && input.usageLimitPatterns.every((item) => typeof item === "string")) {
      next.usageLimitPatterns = input.usageLimitPatterns;
    } else {
      warnings.push(`${source}: usageLimitPatterns must be an array of strings.`);
    }
  }
  return next;
}

export function configHelp(config: GoalConfig, sources: string[] = []): string {
  const sourceLine = sources.length ? `Sources: ${sources.join(", ")}` : "Sources: built-in defaults";
  return [
    "pi-goals configuration",
    sourceLine,
    `autoContinue: ${config.autoContinue}`,
    `showWidget: ${config.showWidget}`,
    `maxAutoContinuations: ${config.maxAutoContinuations}`,
    `noProgressTurnLimit: ${config.noProgressTurnLimit}`,
    `defaultTokenBudget: ${config.defaultTokenBudget ?? "none"}`,
  ].join("\n");
}

function setPositiveInt(input: Record<string, unknown>, key: keyof GoalConfig, target: GoalConfig, warnings: string[], source: string): void {
  if (!(key in input)) return;
  const value = input[key];
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    (target[key] as number) = Math.floor(value);
    return;
  }
  warnings.push(`${source}: ${key} must be a positive number.`);
}

function setNonNegativeInt(input: Record<string, unknown>, key: keyof GoalConfig, target: GoalConfig, warnings: string[], source: string): void {
  if (!(key in input)) return;
  const value = input[key];
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    (target[key] as number) = Math.floor(value);
    return;
  }
  warnings.push(`${source}: ${key} must be a non-negative number.`);
}

function setOptionalPositiveInt(
  input: Record<string, unknown>,
  key: "defaultTokenBudget",
  target: GoalConfig,
  warnings: string[],
  source: string,
): void {
  if (!(key in input)) return;
  const value = input[key];
  if (value === null) {
    target[key] = null;
    return;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    target[key] = Math.floor(value);
    return;
  }
  warnings.push(`${source}: ${key} must be null or a positive number.`);
}

function setBoolean(input: Record<string, unknown>, key: keyof GoalConfig, target: GoalConfig, warnings: string[], source: string): void {
  if (!(key in input)) return;
  const value = input[key];
  if (typeof value === "boolean") {
    (target[key] as boolean) = value;
    return;
  }
  warnings.push(`${source}: ${key} must be a boolean.`);
}
