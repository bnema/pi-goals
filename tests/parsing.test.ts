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
    expect(parseGoalCommand("context")).toEqual({ kind: "context" });
    expect(parseGoalCommand("refs")).toEqual({ kind: "context" });
    expect(parseGoalCommand("context clear --force")).toEqual({ kind: "context-clear", force: true });
    expect(parseGoalCommand("--force context clear")).toEqual({ kind: "context-clear", force: true });
    expect(parseGoalCommand("ref add docs/spec.md --role spec --description product spec")).toEqual({
      kind: "ref-add",
      path: "docs/spec.md",
      role: "spec",
      description: "product spec",
    });
    expect(parseGoalCommand("instruction add keep changes minimal")).toEqual({
      kind: "instruction-add",
      text: "keep changes minimal",
    });
    expect(parseGoalCommand("criterion add targeted tests pass")).toEqual({
      kind: "criterion-add",
      text: "targeted tests pass",
    });
    expect(parseGoalCommand("reread on")).toEqual({
      kind: "reread-set",
      policy: { onResume: true, onContinuation: true, beforeCompletion: true },
    });
    expect(parseGoalCommand("reread continuation off")).toEqual({
      kind: "reread-set",
      policy: { onContinuation: false },
    });
    expect(parseGoalCommand("budget 10k")).toEqual({ kind: "set-budget", tokenBudget: 10000 });
    expect(parseGoalCommand("budget clear --force")).toEqual({ kind: "clear-budget", force: true });
    expect(parseGoalCommand("--force budget clear")).toEqual({ kind: "clear-budget", force: true });
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
    expect(parseGoalCommand("--force ship the plugin")).toEqual({
      kind: "create",
      objective: "ship the plugin",
      tokenBudget: null,
      force: true,
    });
  });

  it("handles shell-like splitting and reserved invalid forms", () => {
    expect(splitArgs("one 'two words' \"three words\"")).toEqual(["one", "two words", "three words"]);
    expect(() => splitArgs("'unterminated")).toThrow();
    expect(() => parseGoalCommand("--unknown thing")).toThrow(/Unknown/);
    expect(() => parseGoalCommand("--force")).toThrow(/Usage/);
    expect(() => parseGoalCommand("--force context")).toThrow(/Usage/);
    expect(() => parseGoalCommand("--force budget 10k")).toThrow(/Usage/);
    expect(() => parseGoalCommand("budget")).toThrow(/Usage/);
    expect(() => parseGoalCommand("ref add")).toThrow(/Usage/);
    expect(() => parseGoalCommand("ref add --role spec")).toThrow(/Usage/);
    expect(() => parseGoalCommand("ref add docs/spec.md --role unknown")).toThrow(/Invalid reference role/);
    expect(() => parseGoalCommand("instruction add")).toThrow(/Usage/);
    expect(() => parseGoalCommand("criterion add")).toThrow(/Usage/);
    expect(() => parseGoalCommand("reread later")).toThrow(/Usage/);
    expect(() => parseGoalCommand("reread resume maybe")).toThrow(/Invalid reread value/);
  });

  it("preserves --force as user text in commands that do not consume it", () => {
    expect(parseGoalCommand("instruction add --force keep retries off")).toEqual({
      kind: "instruction-add",
      text: "--force keep retries off",
    });
    expect(parseGoalCommand("criterion add verify --force handling")).toEqual({
      kind: "criterion-add",
      text: "verify --force handling",
    });
    expect(parseGoalCommand("ref add docs/spec.md --description --force required")).toEqual({
      kind: "ref-add",
      path: "docs/spec.md",
      role: "other",
      description: "--force required",
    });
  });
});
