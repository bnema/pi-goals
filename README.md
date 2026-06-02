# pi-goals

`pi-goals` is a Pi package that adds Codex-style persisted thread goals to Pi sessions without patching Pi core. A goal is a single long-running objective attached to the current session branch. While active, the extension keeps the objective visible, injects hidden goal context, exposes model tools, accounts time and tokens, and schedules safe automatic continuation until the goal reaches a terminal state or the user changes it.

## Installation

Local path:

```bash
pi install /path/to/pi-goals
```

Git:

```bash
pi install git:github.com/bnema/pi-goals
```

npm, once published:

```bash
pi install npm:pi-goals
```

The package manifest declares:

```json
{
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"]
  }
}
```

## Commands

```text
/goal
/goal <objective>
/goal --budget <tokens> <objective>
/goal --tokens <tokens> <objective>
/goal status
/goal edit
/goal pause
/goal resume
/goal budget <tokens>
/goal budget clear
/goal clear
/goal help
/goal config
```

Budget tokens accept plain integers plus `k` and `m` suffixes, such as `200000`, `200k`, `98.5K`, and `1.5M`.

Confirmation-required commands fail closed in non-interactive mode unless `--force` is supplied. This applies to replacing unfinished goals, clearing unfinished goals, and clearing a budget-limited goal's budget.

## Model Tools

The extension registers:

- `get_goal`
- `create_goal`
- `update_goal`

`create_goal` only works when no goal exists and should only be used when the user explicitly asked to create a persisted goal.

`update_goal` accepts only `complete` or `blocked`. Blocking requires the same blocker key to recur three times through the blocked audit before the terminal `blocked` transition succeeds.

## Persistence

Every goal mutation appends a custom session entry with `customType: "pi-goals/state"`. The extension reconstructs state from `ctx.sessionManager.getBranch()`, so `/tree`, `/fork`, `/clone`, `/resume`, and `/reload` restore the latest state on the active branch instead of leaking global latest state across branches.

## Configuration

Config is loaded from:

1. Built-in defaults
2. `~/.pi/agent/pi-goals.json`
3. `.pi/pi-goals.json` relative to the Pi working directory

Example:

```json
{
  "autoContinue": true,
  "showWidget": false,
  "maxObjectiveChars": 4000,
  "maxAutoContinuations": 50,
  "noProgressTurnLimit": 3,
  "defaultTokenBudget": null,
  "countCachedInputTokens": false,
  "confirmReplace": true,
  "usageLimitPatterns": ["usage limit", "rate limit", "insufficient_quota", "quota exceeded"]
}
```

## Limitations

Pi extensions cannot currently preempt a provider response exactly when a token budget is crossed mid-stream. `pi-goals` accounts deterministically at available lifecycle points, prevents further substantive continuation after the budget is reached, and schedules a one-time wrap-up turn.

Extensions run with normal local process permissions. Install packages only from sources you trust.

## Development

```bash
rtk npm install
rtk npm run typecheck
rtk npm test
rtk npm run lint
rtk npm run build
rtk npm pack --dry-run
```

## License

MIT
