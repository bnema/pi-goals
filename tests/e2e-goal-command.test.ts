import { describe, expect, it } from "vitest";
import { registerPiGoals } from "../src/index.js";
import { FakeCtx, FakePi } from "./fakes.js";

describe("e2e /goal command scenario", () => {
  it("creates, summarizes, pauses, resumes, edits, and clears", async () => {
    const pi = new FakePi();
    registerPiGoals(pi);
    const ctx = new FakeCtx();
    const command = pi.commands.get("goal")!;

    await command.handler("--budget 10k write docs", ctx);
    expect(lastNotification(ctx)).toContain("write docs");
    await command.handler("", ctx);
    expect(lastNotification(ctx)).toContain("Token budget: 10K");
    await command.handler("pause", ctx);
    expect(lastNotification(ctx)).toContain("paused");
    await command.handler("resume", ctx);
    expect(lastNotification(ctx)).toContain("active");
    ctx.editorValue = "write better docs";
    await command.handler("edit", ctx);
    expect(lastNotification(ctx)).toContain("write better docs");
    ctx.confirms.push(true);
    await command.handler("clear", ctx);
    expect(lastNotification(ctx)).toContain("No current goal");

    expect(pi.entries.length).toBeGreaterThanOrEqual(5);
    expect(ctx.statuses["pi-goals"]).toBe("");
  });
});

function lastNotification(ctx: FakeCtx): string {
  return ctx.notifications.at(-1)?.message ?? "";
}
