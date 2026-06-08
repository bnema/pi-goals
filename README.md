# pi-goals

Persist one branch-aware objective across a Pi session until it is complete or explicitly replaced.

## What it does

- Adds `/goal` commands for creating, inspecting, pausing, resuming, and clearing goals.
- Keeps the active objective visible in Pi.
- Injects compact hidden goal context before turns.
- Adds model tools for reading, creating, and completing goals.
- Supports optional token budgets, durable references, standing instructions, and acceptance criteria.

## Install

```bash
pi install git:github.com/bnema/pi-goals
```

## Commands

```text
/goal
/goal <objective>
/goal --budget <tokens> <objective>
/goal status
/goal edit
/goal pause
/goal resume
/goal budget <tokens>
/goal budget clear
/goal ref add <path> [--role spec|plan|adr|note|other] [--description <text>]
/goal instruction add <text>
/goal criterion add <text>
/goal reread on|off
/goal reread resume|continuation|completion|before-completion on|off
/goal context
/goal context clear [--force]
/goal clear
/goal help
/goal config
```

Budget tokens accept plain integers plus `k` and `m` suffixes.

## Model tools

- `get_goal`
- `create_goal`
- `update_goal`

`create_goal` only creates a goal when no unfinished goal exists. `update_goal` accepts terminal `complete` or `blocked` states.

## Durable context and persistence

Goals can store reference paths, standing instructions, acceptance criteria, and reread policy. Reference paths are injected as references only; the extension does not read those files automatically. If the reread policy asks for it, the agent must reread the referenced docs before coding, concluding, or calling `update_goal complete`.

Every goal mutation appends a custom session entry. The extension reconstructs state from the active session branch, so `/tree`, `/fork`, `/clone`, `/resume`, and `/reload` restore the latest state for that branch.

## Configuration

Config is loaded from built-in defaults, then `~/.pi/agent/pi-goals.json`, then `.pi/pi-goals.json` relative to the Pi working directory.

Example keys:

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
  "usageLimitPatterns": ["usage limit", "rate limit"]
}
```

## Limitations

Pi extensions cannot preempt a provider response exactly when a token budget is crossed mid-stream. `pi-goals` accounts at available lifecycle points, prevents further substantive continuation after the budget is reached, and schedules a one-time wrap-up turn.

## Develop

```bash
npm install
npm run typecheck
pi -e .
```
