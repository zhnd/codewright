# @codewright/domain

Core domain types — the shared type contracts of the Codewright system.

## Responsibilities

- Define shared types and constants used across packages
- Each domain area lives in its own file, re-exported from `index.ts`

## Internal structure

```
src/
  agent-outputs/         # LLM boundary schemas (zod) — see rules below
    analysis-result.ts
    defect-analysis.ts
    reproduction-oracle.ts
    resolution-result.ts
    index.ts
  task.ts                # TaskStatus, TaskStage, StageStatus, ExecutionStatus, TaskBadge, TASK_STAGES
  workflow.ts            # Workflow inputs, HITL types, CandidatePatch, PullRequestResult
  log.ts                 # LogLevel, EventLevel
  index.ts               # Re-exports all modules
```

## agent-outputs/ — LLM boundary schemas

Types here are what LLM agents emit. They are the **single source of
truth** for the agent/workflow contract — the producer (agent) validates
its output against the schema; the consumers (workflow/server/web) import
the inferred type.

Rules:

1. Defined as a zod schema; type is `z.infer<typeof schema>`. Never write
   a parallel `interface` — that reintroduces drift.
2. Changes are breaking. Update the agent's prompt AND every consumer in
   the same PR.
3. Use `.refine` for cross-field invariants the LLM might violate
   (e.g. `runCommand` non-empty when `mode !== 'none'`).
4. Non-LLM types (DB rows, GraphQL shapes, workflow-built aggregates)
   DO NOT belong here — keep them as interfaces in `workflow.ts` or a
   dedicated file. Zod overhead without benefit there.

## Conventions

- One file per domain area — group related types together
- All exports go through `index.ts` so consumers import from `@codewright/domain`
- When adding new types, place them in the appropriate domain file or create a new one

## Dependencies

- `zod` — runtime dependency for `agent-outputs/` schemas. This is the
  one intentional exception to the "pure types" rule; see rationale below.
- No dependency on any other `@codewright/*` package — leaf package.

## Key constraint

Pure types, constants, and **LLM boundary schemas**. No I/O, no workflow
logic, no side effects. The `zod` dependency exists specifically so
`agent-outputs/` can provide runtime validation at the LLM boundary; it
is not a license to add general-purpose runtime logic here.
