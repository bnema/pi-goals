# pi-goals usage

## Summary

`/goal` manages one current goal for the active Pi session branch. Without arguments, it shows the current objective, status, time used, counted tokens, token budget, continuation count, blocked audit state, and next commands. When no goal exists, it shows examples.

## Creating Goals

```text
/goal write the release notes
/goal --budget 50k finish the migration
/goal --tokens 1.5M complete the full test suite
```

Creating a goal while an unfinished or unmet terminal goal exists asks for confirmation. In JSON or print mode, confirmation-required replacement fails closed unless `--force` is present:

```text
/goal --force new objective
```

Completed goals can be replaced without confirmation.

## Editing

```text
/goal edit
```

Editing opens the Pi editor with the current objective. Active, paused, blocked, and usage-limited goals keep their status and usage. Complete and budget-limited goals become active again because editing means the work has changed.

If an agent turn is currently running, the extension sends a hidden steering message telling the model that the edited objective supersedes the old one.

## Pause, Resume, Clear

```text
/goal pause
/goal resume
/goal clear
```

Pause accounts elapsed active time and suppresses future auto-continuation. Resume is allowed for paused, blocked, and usage-limited goals. It resets blocked audits for resumed blocked goals and can trigger continuation when Pi is idle.

Clear removes the current goal after confirmation when unfinished. If a turn is running, a hidden steering message tells the model to stop using prior goal context.

## Budgets

```text
/goal budget 100k
/goal budget clear
```

Budgets must be positive. If current usage is already at or above a new budget, the goal becomes `budget_limited`. A budget-limited goal does not continue substantive work. The extension may schedule one hidden wrap-up turn so the model can summarize progress and next steps.

Clearing the budget resumes a budget-limited goal only after explicit confirmation.

## UI

The footer status is always updated while a goal exists:

```text
🎯 40K / 50K
🎯 12m
🎯 paused (/goal resume)
🎯 blocked (/goal resume)
🎯 usage limited
🎯 budget 63.9K / 50K
🎯 achieved (40K tokens)
```

The optional widget is controlled by `showWidget` and includes status, a truncated one-line objective, usage, budget, and next commands.

## Non-Interactive Mode

When `ctx.hasUI === false`, UI prompts cannot collect consent. Confirmation-required operations fail closed unless `--force` is present. Status, hidden context, model tools, accounting, and auto-continuation remain deterministic.
