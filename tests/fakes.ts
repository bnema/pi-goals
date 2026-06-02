export interface FakeCommand {
  description: string;
  handler: (args: string, ctx: FakeCtx) => Promise<string | void>;
}

export interface FakeTool {
  name: string;
  execute: (...args: unknown[]) => Promise<unknown>;
  [key: string]: unknown;
}

export class FakePi {
  commands = new Map<string, FakeCommand>();
  tools = new Map<string, FakeTool>();
  events = new Map<string, Array<(event: unknown, ctx: FakeCtx) => Promise<unknown> | unknown>>();
  entries: Array<{ type: "custom"; customType: string; data: unknown }> = [];
  messages: Array<{ message: Record<string, unknown>; options?: Record<string, unknown> }> = [];

  registerCommand(name: string, definition: FakeCommand): void {
    this.commands.set(name, definition);
  }

  registerTool(definition: FakeTool): void {
    this.tools.set(definition.name, definition);
  }

  on(event: string, handler: (event: unknown, ctx: FakeCtx) => Promise<unknown> | unknown): void {
    const handlers = this.events.get(event) ?? [];
    handlers.push(handler);
    this.events.set(event, handlers);
  }

  appendEntry(customType: string, data?: unknown): void {
    this.entries.push({ type: "custom", customType, data });
  }

  sendMessage(message: Record<string, unknown>, options?: Record<string, unknown>): void {
    this.messages.push(options ? { message, options } : { message });
  }

  async emit(event: string, payload: unknown, ctx: FakeCtx): Promise<unknown[]> {
    const handlers = this.events.get(event) ?? [];
    const results = [];
    for (const handler of handlers) results.push(await handler(payload, ctx));
    return results;
  }
}

export class FakeCtx {
  hasUI = true;
  idle = true;
  pending = false;
  cwd = process.cwd();
  branchEntries: unknown[] = [];
  notifications: Array<{ message: string; level?: string }> = [];
  statuses: Record<string, string> = {};
  widgets: Record<string, string[]> = {};
  confirms: boolean[] = [];
  editorValue: string | null = null;

  ui = {
    notify: (message: string, level?: string) => {
      this.notifications.push(level === undefined ? { message } : { message, level });
    },
    setStatus: (key: string, value: string) => {
      this.statuses[key] = value;
    },
    setWidget: (key: string, lines: string[]) => {
      this.widgets[key] = lines;
    },
    confirm: async () => this.confirms.shift() ?? false,
    editor: async () => this.editorValue,
  };

  sessionManager = {
    getBranch: () => this.branchEntries,
  };

  isIdle(): boolean {
    return this.idle;
  }

  hasPendingMessages(): boolean {
    return this.pending;
  }
}
