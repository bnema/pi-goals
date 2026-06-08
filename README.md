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

## Use

```text
/goal Ship the README cleanup across the Pi extensions
/goal status
/goal pause
/goal resume
/goal clear
```

Model tools:

- `get_goal`
- `create_goal`
- `update_goal`

## Develop

```bash
npm install
npm run typecheck
pi -e .
```
