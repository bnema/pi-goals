import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import extension from "../extensions/goal.js";
import { FakePi } from "./fakes.js";

describe("package smoke", () => {
  it("extension registers command and model tools", () => {
    const pi = new FakePi();
    extension(pi);
    expect(pi.commands.has("goal")).toBe(true);
    expect(pi.tools.has("get_goal")).toBe(true);
    expect(pi.tools.has("create_goal")).toBe(true);
    expect(pi.tools.has("update_goal")).toBe(true);
  });

  it("package metadata points at built entrypoints", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      main: string;
      exports: { ".": { import: string; types: string }; "./extension": { import: string; types: string } };
    };
    expect(pkg.main).toBe("./dist/src/index.js");
    expect(pkg.exports["."].import).toBe("./dist/src/index.js");
    expect(pkg.exports["."].types).toBe("./dist/src/index.d.ts");
    expect(pkg.exports["./extension"].import).toBe("./dist/extensions/goal.js");
  });

  it("built outputs are importable after npm run build", async () => {
    execSync("npm run build", { stdio: "pipe" });
    const index = await import(pathToFileURL(resolve("dist/src/index.js")).href);
    const builtExtension = await import(pathToFileURL(resolve("dist/extensions/goal.js")).href);
    expect(typeof index.registerPiGoals).toBe("function");
    expect(typeof builtExtension.default).toBe("function");
  }, 120_000);
});
