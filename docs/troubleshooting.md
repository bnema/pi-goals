# pi-goals troubleshooting

## Goal Did Not Continue

Auto-continuation requires all of these:

- The goal exists and is `active`.
- `autoContinue` is true.
- Pi reports idle.
- No pending user messages exist.
- Token budget and usage limits are not active.
- `continuationCount < maxAutoContinuations`.
- No no-progress suppressor is active.
- The extension is not already waiting on a scheduled continuation for the same goal.

Use `/goal` to inspect status and `/goal config` to inspect configuration.

## Budget Limited

`budget_limited` means counted tokens reached or exceeded `tokenBudget` at an accounting boundary. The extension cannot interrupt a provider mid-stream with core-runtime fidelity, so crossing is applied when lifecycle usage is available.

To continue:

```text
/goal budget clear
```

or:

```text
/goal budget 200k
```

If the goal remains over the new budget, it stays budget-limited.

## Usage Limited

`usage_limited` is applied when assistant/provider text matches configured usage-limit patterns such as `usage limit`, `rate limit`, `insufficient_quota`, or `quota exceeded`.

After external availability changes:

```text
/goal resume
```

## Blocked Audit

The model cannot mark a goal blocked on the first attempt. It must present the same blocker key for at least three consecutive goal turns. User resume, objective edit, replacement, clear, and meaningful progress reset or supersede the audit.

## No-Progress Suppression

The extension increments no-progress turns when a goal turn produces no non-goal tool result and no meaningful assistant text. Once `noProgressTurnLimit` is reached, auto-continuation is suppressed. User input, resume, or edit clears the suppressor.

## Branch Recovery

Goal state is stored as custom session entries with `customType: "pi-goals/state"`. State is restored from `ctx.sessionManager.getBranch()`, not from all session entries. If a goal appears missing after `/tree`, verify that the branch you selected actually contains the relevant state entries.

## Non-Interactive Mode

Commands that require confirmation fail closed when `ctx.hasUI === false` unless `--force` is present. This prevents accidental replacement or clearing in JSON/print workflows.
