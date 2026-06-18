# @codewright/solver

Bug-fix **strategy layer** (the "accuracy core"). Owns the per-agent
logic (analyze / triage / reproduce / implement / critic) and their
prompts. This is the layer you iterate on to improve fix accuracy.

## Boundary (important)

`solver` = strategy (*what* to do to fix a bug). `@codewright/agent-runtime` =
mechanism (*how* to run an agent). The split is enforced by one rule:

- **`solver` MUST NOT import `@anthropic-ai/claude-agent-sdk`.** All SDK
  contact lives in `@codewright/agent-runtime`. Agents call `runAgent` and use
  the sandbox tool config from `@codewright/agent-runtime`.
- No `query()` / MCP / SDK plumbing here; no defect vocabulary in
  agent-runtime. (Vocabulary test for the boundary.)

## Internal structure

```
src/
  agents/<name>/
    index.ts     # ~20 lines: calls runAgent() from @codewright/agent-runtime
    prompts.ts   # system + user prompt strings only (no schema)
  index.ts       # public re-exports (the agent functions)
  logger.ts
```

## Adding a new agent

1. Define the output schema in `@codewright/domain/agent-outputs/<name>.ts` (zod).
2. `src/agents/<name>/prompts.ts` — prompt builders (strings only).
3. `src/agents/<name>/index.ts` — import the schema from `@codewright/domain`,
   call `runAgent<Result>({ schema, ... })` from `@codewright/agent-runtime`.
4. Re-export from `src/index.ts`.

The contract lives in `@codewright/domain/agent-outputs/` so consumers
(workflow/server/web) share the same source of truth as the producer.

## Dependencies

- `@codewright/agent-runtime` — `runAgent`, sandbox tools, observer (the engine)
- `@codewright/domain` — schemas/types (DefectAnalysis, ResolutionResult, …)
- `@codewright/sandbox` — `Sandbox` type
- `@codewright/shared` — logger
- `dedent` — prompt formatting

## Key constraint

Agents operate exclusively through the `Sandbox` interface (via the engine's
sandbox MCP tools) — never the host filesystem. Model is configurable via
`AGENT_MODEL` (resolved inside `@codewright/agent-runtime`).
