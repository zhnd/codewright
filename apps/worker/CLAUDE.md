# @codewright/worker

Temporal worker process — registers and runs workflows and activities.

## Responsibilities

- Start Temporal worker and connect to Temporal server
- Register all workflows and activities from `@codewright/workflow`
- Run as a standalone process, independently scalable from the API server
- Enforce host-resource limits via per-queue concurrency caps
- Clean up orphan builder containers on startup and prune stale repo images on a daily timer

## Two workers, one process

Starts two `Worker` instances sharing one `NativeConnection`:

- **Main worker** (`TASK_QUEUE`) — runs workflows + lightweight activities. Concurrency: `WORKER_CONCURRENCY` (default 40).
- **Sandbox worker** (`SANDBOX_TASK_QUEUE`) — runs only heavy, container-touching activities. Concurrency: `SANDBOX_CONCURRENCY` (default 4). Overflow queues on the Temporal server until a slot opens, so the host never spins up more than N containers at once.

Scale horizontally by running additional worker processes; each carries its own per-queue caps, and Temporal load-balances across them.

## Env vars

- `TEMPORAL_ADDRESS` — Temporal frontend (default `localhost:7233`)
- `DATABASE_URL` — Prisma connection (required by activities)
- `SANDBOX_CONCURRENCY` — max concurrent sandbox-heavy activities per process (default 4)
- `WORKER_CONCURRENCY` — max concurrent activities/workflow tasks on the main queue (default 40)
- `CODEWRIGHT_IMAGE_PRUNE_INTERVAL_MS` — how often to prune stale repo images (default 24h)
- Plus all `CODEWRIGHT_*` vars consumed by `@codewright/sandbox` (see that package's CLAUDE.md)

## Dependencies

- `@codewright/workflow` — workflow and activity definitions (activities imported directly, workflows loaded via file path)
- `@codewright/sandbox` — called for periodic image prune + orphan builder cleanup
- `@codewright/shared` — logger

## Key constraint

This is a long-running process, not an HTTP server. It must be deployable and scalable independently from `@codewright/server`. Requires `DATABASE_URL` (activities use Prisma) and Docker daemon access (sandbox creation). Before first start on a new host, run `pnpm sandbox:build-base` to build the `codewright/sandbox-base` image that all repo-cache images derive from.
