# @codewright/sandbox

Isolated code execution environment for the Codewright system.

## Responsibilities

- Define a provider-agnostic `Sandbox` interface (exec with timeout/abort/truncate, file system primitives, lifecycle hooks, serializable state)
- Ship a Docker-based implementation with a two-tier repo image cache
- Expose `createSandbox` / `connectSandbox` factory so Temporal activities can round-trip sandbox identity via a plain `SandboxState` JSON payload

## Internal structure

```
src/
  interface.ts            # Sandbox, ExecResult, SandboxStats, SandboxHooks
  types.ts                # Source, GitUser
  state.ts                # SandboxState discriminated union (persistable)
  factory.ts              # createSandbox / connectSandbox — provider switch
  index.ts                # public re-exports
  logger.ts               # package-level Pino logger
  docker/
    create.ts             # container bootstrap (cache hit → warmStart; miss → bootstrapFromScratch)
    connect.ts            # re-attach by container id
    sandbox.ts            # DockerSandbox class
    exec.ts               # timeout/abort/truncate-aware exec
    filesystem.ts         # putArchive/getArchive file I/O
    credential-broker.ts  # git credential helper; tokens never land in config
    defaults.ts           # toolchain default versions + image/lock/timeout knobs
    setup-detector.ts     # auto-detect toolchain from repo files, emit SetupPlan
    repo-image.ts         # two-tier cache: codewright/repo-raw and codewright/repo
```

## Two-tier repo image cache

Repos are materialized as Docker images so the Nth task on the same repo doesn't pay the clone + install cost:

```
tier-1 (raw clone)     codewright/repo-raw:<repoHash>
  = sandbox-base + `git clone --filter=blob:none`
  = rebuilt when ≥ REPO_RAW_MAX_AGE_MS (default 6h) via `git fetch + reset`

tier-2 (post install)  codewright/repo:<repoHash>-<setupHash>
  = tier-1 + detected/declared toolchain + `<install cmd>`
  = rebuilt when ≥ REPO_IMAGE_MAX_AGE_MS (default 24h) from tier-1
  = setupHash derives from lockfile content + tool versions, so lockfile
    changes invalidate tier-2 only (tier-1 is still reused)
```

Task flow: `ensureRepoImage` → `docker run <tag>` → `git fetch + reset` (delta) → optional `checkout -b` → task starts.

Concurrent builds are serialized per cache key via an in-process `Map` plus a host fs lock at `LOCK_ROOT` (default `<os.tmpdir()>/codewright/locks`, e.g. `/tmp/codewright/locks` on Linux, `/var/folders/.../codewright/locks` on macOS). Orphan builder containers (label `codewright.role=builder`) are cleaned on worker startup; stale managed images are pruned on a daily timer.

## Base image

`codewright/sandbox-base:1` — debian-slim + `git / curl / ca-certificates / jq / ripgrep / build-essential / mise`. No language runtimes. Build with `pnpm sandbox:build-base`.

All language toolchains come in through `mise` at tier-2 build time. A repo declares them via `mise.toml` / `.tool-versions` / `.nvmrc` / `.python-version`; otherwise `setup-detector` falls back to per-lockfile defaults (pnpm > bun > yarn > npm; uv > poetry > pip; cargo; go). Defaults pinned to current-1 LTS (Node 22, Python 3.12, Rust stable, Go latest, Bun latest); per-deployment overrides via `DEFAULT_*_VERSION`.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `SANDBOX_BASE_IMAGE` | `codewright/sandbox-base:1` | Base used by builder containers |
| `REPO_RAW_MAX_AGE_MS` | 6h | Tier-1 refresh threshold |
| `REPO_IMAGE_MAX_AGE_MS` | 24h | Tier-2 refresh threshold |
| `REPO_IMAGE_PRUNE_AFTER_MS` | 7d | Managed-image eviction age |
| `SETUP_COMMAND_TIMEOUT_MS` | 20min | Setup step timeout |
| `LOCK_ROOT` | `<os.tmpdir()>/codewright/locks` | Host fs lock directory |
| `DEFAULT_NODE_VERSION` | `22` | Node default when repo doesn't declare |
| `DEFAULT_PYTHON_VERSION` | `3.12` | Python default |
| `DEFAULT_RUST_VERSION` | `stable` | Rust default |
| `DEFAULT_GO_VERSION` | `latest` | Go default |
| `DEFAULT_BUN_VERSION` | `latest` | Bun default |

## Adding a new provider

1. Add the provider tag to `SandboxProvider` in `interface.ts`
2. Add a branch to `SandboxState` in `state.ts` with the provider's reconnect fields
3. Implement the `Sandbox` interface in a new `src/<provider>/` directory
4. Extend `createSandbox` / `connectSandbox` switch in `factory.ts`

Callers (activities, agent tools) interact only with `Sandbox`, so new providers never require changes outside this package.

## Provider-aware credential helper

git over HTTPS authenticates differently per host (GitHub: `x-access-token`, cnb.cool: `cnb`). Callers pass `gitProvider` (`'github' | 'cnb'`, defaults to `'github'`) and `gitToken` into `createSandbox`/`connectSandbox`; the broker then writes the right helper script via `buildCredentialHelper(provider)`, which delegates to `@codewright/githost`'s `gitCredentialsFor`. The token is injected as `CODEWRIGHT_GIT_TOKEN` (unified across providers — provider distinction lives in the helper script's username, not the env var).

`Source.provider` on the source descriptor is optional for the same reason — defaults to `'github'` so callers that don't care don't have to plumb it.

## Dependencies

- `@codewright/githost` — `GitHostProvider` type and `gitCredentialsFor` (helper script per provider)
- `@codewright/shared` — logger
- Third-party: `dockerode`, `tar-stream`

## Key constraints

- `getState()` never includes secrets. Tokens flow through env only (credential helper reads `$CODEWRIGHT_GIT_TOKEN` at git command time)
- `stop()` is idempotent and always runs `beforeStop` hook
- `exec()` returns `ExecResult` with `success: false` for timeouts instead of throwing
- `.mise.toml` / `.tool-versions` only honored at repo root; monorepo users orchestrate via root-level setup
- When `CreateDockerSandboxOptions.image` is set explicitly, the repo cache is bypassed (escape hatch for tests/custom runtimes)

## Operational notes

Run `pnpm sandbox:build-base` on each worker host before first use. Images accumulate under `codewright/repo-raw:*` and `codewright/repo:*`; the worker prunes daily. Rebuilding a specific repo image: `docker rmi codewright/repo-raw:<hash> codewright/repo:<hash>-*` and it will be rebuilt on the next task.
