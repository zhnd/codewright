# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Codewright is an AI-powered execution system for software engineering. It turns engineering tasks into executable systems — understanding tasks, breaking them into steps, executing with tools, tracking state across long-running workflows, recovering from failure, and remaining observable and controllable throughout.

## Architecture

pnpm monorepo. Each package has its own CLAUDE.md with detailed responsibilities.

```
apps/
  server/       # GraphQL API (Apollo Server + Fastify)
  web/          # Frontend — Next.js 15 task dashboard
  worker/       # Temporal worker process

packages/
  database/     # Prisma schema, migrations, shared client, Pothos types
  domain/       # Core types shared across the system
  workflow/     # Temporal workflows, activities, and client
  agent/        # Claude Agent SDK, prompts, sandbox tools
  sandbox/      # Isolated execution environment (Docker-based)
  githost/      # Multi-provider git host abstraction (GitHub + cnb.cool)
  shared/       # Pino logger, utilities
```

### Dependency direction

```
server → database, workflow/client, githost (URL parsing), shared
worker → workflow → agent → sandbox → githost (credential helper)
workflow → database (activities), domain, githost (PR/review API)
All packages may use shared
web → server (GraphQL only)
```

### Key principle

agent decides *what* to do; workflow activities *execute* it. Temporal is the runtime for orchestration — workflows define the control flow, activities perform side effects.

## Build & Dev

- Package manager: pnpm (v10.33+)
- `pnpm -r check-types` — type check all packages
- `pnpm format-fix` / `pnpm lint-fix` — format and lint via Biome
- `pnpm docker:up:dev` — start Postgres, Temporal, Temporal UI
- `pnpm dev` — full local stack (docker + server + worker + web) in one [mprocs](https://github.com/pvolok/mprocs) TUI; see `mprocs.yaml`. App procs gate on docker via `scripts/wait-for-dev-services.mjs`. Press `q` to stop everything, including containers.
- `pnpm dev:apps` — app dev servers only, via Turborepo (assumes docker already up)
- Dev scripts use `tsx watch --conditions development --env-file=../../.env`

## Logging

Structured logging via Pino (`@codewright/shared`). Each package has a `src/logger.ts` exporting a single `log` instance. Dev: pino-pretty (colored). Prod: JSON. Control via `LOG_LEVEL` env var.

## Design Principles

- Execution over generation
- Workflows over scripts
- Observability by default
- Controllable automation
- Modular tool-based architecture
- Human-in-the-loop when necessary
