# pi-goals model tools

The model-visible tools are designed to support goal lifecycle work without giving the model arbitrary control over user-owned state.

## `get_goal`

Parameters: none.

Returns:

```json
{
  "goal": null,
  "remainingTokens": null,
  "autoContinueSuppressedReason": null
}
```

When a goal exists, `goal` contains the full `ThreadGoal` snapshot including status, objective, token budget, tokens used, time used, continuation count, and blocked audit fields.

## `create_goal`

Parameters:

```json
{
  "objective": "finish the migration",
  "token_budget": 50000
}
```

Policy:

- Use only when the user explicitly requested a persisted goal.
- Fails if any goal already exists, even a complete one.
- The `/goal` command owns replacement semantics because replacement may require user confirmation.
- Objective text is trimmed, must be non-empty, and must fit `maxObjectiveChars`.
- Budget must be positive when provided.

## `update_goal`

Parameters:

```json
{
  "status": "complete",
  "evidence": "tests pass and docs are updated"
}
```

or:

```json
{
  "status": "blocked",
  "blocker_key": "missing-production-credential",
  "evidence": "same credential was required for three consecutive goal turns"
}
```

Policy:

- Only `complete` and `blocked` are valid statuses.
- Invalid statuses throw so Pi records an error tool result.
- `complete` should be used only when the entire current objective is achieved and verified.
- `blocked` requires the same blocker key to recur at least three times through the audit before the terminal blocked transition succeeds.
- The tool cannot pause, resume, clear, budget-limit, or usage-limit goals.

Completing returns a structured usage report and tells the model to report final usage to the user.

## Hidden Context

When a goal is active, `before_agent_start` injects a hidden custom message with concise active-goal context. The objective is wrapped as untrusted user-provided data. The prompt reminds the model to inspect current project state, preserve full scope, and only call `update_goal` when the strict complete or blocked policy is satisfied.

Automatic continuations use a stronger continuation prompt. Budget-limited wrap-ups use a dedicated prompt that forbids new substantive work.
