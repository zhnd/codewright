# @codewright/agent-runtime

Agent **execution engine** (the "mechanism" layer). The ONLY package that
imports the Claude Agent SDK. Owns the query loop, observability,
structured-output parsing, and the sandbox tool surface. Knows nothing
about bug-fixing — that lives in `@codewright/solver`.

## Boundary (important)

- **Only this package may import `@anthropic-ai/claude-agent-sdk`.**
- No bug-fix vocabulary here (`defect` / `localize` / `repair`) — it is
  domain-agnostic; it just runs an agent session against a sandbox.
- Consumed by `@codewright/solver` (strategies call `runAgent` + tools) and by
  `@codewright/workflow` (`createObserver` in the agent-activity wrapper).

## Internal structure

```
src/
  driver/
    run-agent.ts          # generic SDK query loop; returns { result, observation }
    observer.ts           # AgentObserver — SDK message stream -> trace/cost
    parse-json.ts         # zod-validated structured-output decoder
  tools/
    sandbox-server.ts     # createSandboxMcpServer(sandbox) — the sandbox MCP tools
    submit-result-server.ts  # one-tool MCP server for schema'd structured output
    tool-config.ts        # SANDBOX_READ_TOOLS / SANDBOX_WRITE_TOOLS / sandboxOnlyToolConfig
  logger.ts
  index.ts                # public re-exports only
```

## Tool gating

Agents must ONLY use sandbox MCP tools. The SDK ships built-in tools
(Bash/Read/Write/…) that touch the **host** filesystem — not what we want.
`sandboxOnlyToolConfig()` returns an `allowedTools` + `canUseTool` pair
that denies anything outside the MCP namespace. Presets:
`SANDBOX_READ_TOOLS` (bash+read+list), `SANDBOX_WRITE_TOOLS` (adds write).

## Dependencies

- `@anthropic-ai/claude-agent-sdk` — the SDK (isolated here)
- `@codewright/sandbox` — `Sandbox` interface for code execution
- `@codewright/domain` — trace/observability + agent-output types
- `@codewright/shared` — logger
- `zod` — structured-output validation

## Key constraint

This package is the swappable execution adapter behind the strategy layer.
Keeping the SDK import confined here is what lets `solver` stay
model/SDK-agnostic (and lets a future non-Claude adapter slot in without
touching strategies).
