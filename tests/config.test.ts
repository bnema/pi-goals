import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadGoalConfig, mergeConfig, snapshotConfig } from "../src/config.js";

describe("config", () => {
  it("loads defaults and merges user then project config", () => {
    const files = new Map<string, string>([
      ["/home/.pi/agent/pi-goals.json", JSON.stringify({ autoContinue: false, maxAutoContinuations: 10 })],
      ["/repo/.pi/pi-goals.json", JSON.stringify({ autoContinue: true, showWidget: true })],
    ]);
    const loaded = loadGoalConfig({
      cwd: "/repo",
      home: "/home",
      exists: (path) => files.has(path),
      readFile: (path) => files.get(path) ?? "",
    });
    expect(loaded.config.autoContinue).toBe(true);
    expect(loaded.config.maxAutoContinuations).toBe(10);
    expect(loaded.config.showWidget).toBe(true);
    expect(loaded.sources).toHaveLength(2);
  });

  it("falls back safely with warnings for invalid values", () => {
    const warnings: string[] = [];
    const config = mergeConfig(
      DEFAULT_CONFIG,
      { maxAutoContinuations: -1, noProgressTurnLimit: 0.5, defaultTokenBudget: 0.5, usageLimitPatterns: [1] },
      warnings,
    );
    expect(config.maxAutoContinuations).toBe(DEFAULT_CONFIG.maxAutoContinuations);
    expect(config.noProgressTurnLimit).toBe(DEFAULT_CONFIG.noProgressTurnLimit);
    expect(config.defaultTokenBudget).toBe(DEFAULT_CONFIG.defaultTokenBudget);
    expect(warnings.length).toBeGreaterThan(0);
    expect(snapshotConfig(config).autoContinue).toBe(DEFAULT_CONFIG.autoContinue);
  });

  it("allows zero maxAutoContinuations to disable automatic continuations by cap", () => {
    const warnings: string[] = [];
    const config = mergeConfig(DEFAULT_CONFIG, { maxAutoContinuations: 0 }, warnings);
    expect(config.maxAutoContinuations).toBe(0);
    expect(warnings).toHaveLength(0);
  });
});
