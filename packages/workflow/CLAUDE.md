# @codewright/workflow

Temporal workflow definitions, activities, and client utilities.

## Responsibilities

- Define Temporal workflows (control flow, state transitions)
- Define activities split by single responsibility with independent timeouts
- Expose a Temporal client wrapper for server to start/query workflows
- Handle retry policies and failure recovery

## Internal structure

```
src/
  workflows/
    analyze-repository.ts   # Orchestrates: create sandbox → analyze → destroy
    resolve-defect.ts       # Orchestrates: analyze → HITL → implement → PR
  activities/
    create-sandbox.ts       # Create Docker sandbox, clone repo
    analyze-code.ts         # Agent-driven repository analysis
    analyze-defect.ts       # Agent-driven defect analysis
    implement-resolution.ts # Agent-driven resolution implementation
    destroy-sandbox.ts      # Cleanup container
    push-branch.ts          # git push from sandbox
    create-pull-request.ts  # Open PR via @codewright/githost (GitHub or cnb.cool)
    add-pr-review-comments.ts
    save-task-events.ts     # Persist observation events
    update-task.ts          # Update Task status in DB
  client/
    index.ts                # TASK_QUEUE + SANDBOX_TASK_QUEUE + client factory
  utils/
    git-context.ts          # gitClientFor(project) — adapter from Project → GitHostClient
    boot-verify.ts          # dev-server boot-and-probe used by filter-candidate
    build-pr-body.ts        # PR body composition
    precondition-check.ts   # repo precondition guardrails
    retry-feedback.ts       # Reflexion-style retry context
    scope-check.ts          # change-scope analysis
    test-runner-detect.ts   # detect test runner from repo files
    trivial-gate.ts         # trivial-class shortcut detection
  logger.ts                 # Package-level Pino logger
```

## Git host access

Activities that need the git host API (PR create, review comments) call `gitClientFor(project)` from `utils/git-context.ts`. It decrypts credentials, parses the repo URL, and returns a `GitHostClient` from `@codewright/githost` bound to that project — methods take action args only. Activities that need provider/token but no API client (sandbox create, push-branch) gate on `project.encryptedCredentials` and read `client?.provider` / `client?.token` / `client?.botIdentity` off the same client. `gitClientFor` throws if there are no credentials, so callers that allow no-creds must do the conditional themselves.

## Two task queues (host-safety pattern)

- `TASK_QUEUE` (`codewright-main`) — workflows + lightweight activities (DB, GitHub API). High concurrency.
- `SANDBOX_TASK_QUEUE` (`codewright-sandbox-heavy`) — every activity that touches a Docker container or drives the agent. Worker concurrency is capped by `SANDBOX_CONCURRENCY` so the host never runs more than N containers at once; overflow queues on the Temporal server.

Workflows route calls via three `proxyActivities` groups:

- `main` — default queue, 2 min timeout
- `sandboxInfra` — sandbox queue, 5 min timeout (create/destroy/push)
- `sandboxAgent` — sandbox queue, 10–15 min timeout (analyze/implement)

When adding a new activity: if it connects to a sandbox (even briefly), put it on `SANDBOX_TASK_QUEUE`. Otherwise `TASK_QUEUE`.

## Dependencies

- `@codewright/agent` — called from agent-driven activities
- `@codewright/sandbox` — create/connect/destroy sandboxes
- `@codewright/githost` — provider-aware PR / review-comment client + URL parsing
- `@codewright/database` — update Task records
- `@codewright/domain` — shared types
- `@codewright/shared` — logger

## Key constraint

Workflow code runs in a Temporal sandbox — it must be deterministic and cannot do I/O directly. All I/O goes through activities.
