# @codewright/database

Shared database layer for the Codewright system.

## Responsibilities

- Own the Prisma schema, migrations, and configuration
- Provide a shared PrismaClient instance for all packages
- Export generated Pothos types for GraphQL integration
- Database connection management via `@prisma/adapter-pg`

## Models

- **User, Session, Account, Verification** — authentication (better-auth)
- **Task** — workflow task tracking (status, result, error, workflowId)

## Dependencies

None (`@codewright/*` packages). Third-party: Prisma, pg, dotenv (prisma CLI only).

## Key constraint

This is the single source of truth for database schema and access. No other package should define its own Prisma setup. The `prisma.config.ts` loads `.env` from repo root for CLI commands; runtime env loading is handled by app-level `--env-file`.
