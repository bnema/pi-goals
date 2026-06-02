import { describe, expect, it } from "vitest";
import { parseBudget, parseGoalCommand, splitArgs } from "../src/parsing.js";

describe("parseBudget", () => {
  it("parses integers and k/m suffixes", () => {
    expect(parseBudget("200000")).toBe(200000);
    expect(parseBudget("200k")).toBe(200000);
    expect(parseBudget("98.5K")).toBe(98500);
    expect(parseBudget("1.5M")).toBe(1500000);
  });

  it("rejects invalid budgets", () => {
    expect(() => parseBudget("0")).toThrow();
    expect(() => parseBudget("0.5")).toThrow();
    expect(() => parseBudget("-1")).toThrow();
    expect(() => parseBudget("NaN")).toThrow();
  });
});

describe("parseGoalCommand", () => {
  it("parses all command forms", () => {
    expect(parseGoalCommand("")).toEqual({ kind: "summary" });
    expect(parseGoalCommand("status")).toEqual({ kind: "status" });
    expect(parseGoalCommand("help")).toEqual({ kind: "help" });
    expect(parseGoalCommand("edit")).toEqual({ kind: "edit" });
    expect(parseGoalCommand("pause")).toEqual({ kind: "pause" });
    expect(parseGoalCommand("resume")).toEqual({ kind: "resume" });
    expect(parseGoalCommand("clear --force")).toEqual({ kind: "clear", force: true });
    expect(parseGoalCommand("budget 10k")).toEqual({ kind: "set-budget", tokenBudget: 10000 });
    expect(parseGoalCommand("budget clear --force")).toEqual({ kind: "clear-budget", force: true });
    expect(parseGoalCommand("--budget 1.5M write docs")).toEqual({
      kind: "create",
      objective: "write docs",
      tokenBudget: 1500000,
      force: false,
    });
    expect(parseGoalCommand("--tokens 5k 'quoted objective'")).toEqual({
      kind: "create",
      objective: "quoted objective",
      tokenBudget: 5000,
      force: false,
    });
    expect(parseGoalCommand("ship the plugin")).toEqual({
      kind: "create",
      objective: "ship the plugin",
      tokenBudget: null,
      force: false,
    });
  });

  it("handles shell-like splitting and reserved invalid forms", () => {
    expect(splitArgs("one 'two words' \"three words\"")).toEqual(["one", "two words", "three words"]);
    expect(() => splitArgs("'unterminated")).toThrow();
    expect(() => parseGoalCommand("--unknown thing")).toThrow(/Unknown/);
    expect(() => parseGoalCommand("--force")).toThrow(/Usage/);
    expect(() => parseGoalCommand("budget")).toThrow(/Usage/);
  });
});
