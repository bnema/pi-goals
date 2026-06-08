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

Goals can store reference paths, standing instructions, acceptance criteria, and reread policy. Goal state is branch-aware and stored outside normal README/docs flow in the Pi session/state layer.

## Develop

```bash
npm install
npm run typecheck
pi -e .
```
