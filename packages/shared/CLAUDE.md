# @codewright/shared

Common utilities shared across all packages.

## Responsibilities

- Structured logging via Pino (`createLogger`, `loggerConfig`)
- Dev: pino-pretty (colored output). Prod: JSON. Controlled by `LOG_LEVEL` env var.
- Each consumer package creates a `src/logger.ts` with `createLogger('package-name')`

## Exports

- `logger` — root Pino instance
- `createLogger(name, context?)` — create a child logger with module name
- `loggerConfig` — Pino options (pass to Fastify for consistent config)
- `Logger` type

## Dependencies

None (`@codewright/*` packages). Third-party: pino (root-level dependency).

## Key constraint

Must remain lightweight and free of domain logic. If something is specific to tasks, workflows, or agents, it belongs in the respective package, not here.
