import { type Options, query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentObservation } from '@torin/domain';
import type { ZodType } from 'zod/v4';
import { log } from '../logger.js';
import { createSubmitResultServer } from '../tools/submit-result-server.js';
import { type AgentObserver, createObserver } from './observer.js';
import { parseAgentJson } from './parse-json.js';

export interface RunAgentInput<T> {
  /** Name used in logs and observer events. */
  agentName: string;
  /** Task-stage tag the observer attaches to every event. */
  stage: string;
  /** System prompt — the agent's role/rules. */
  systemPrompt: string;
  /** User prompt — the concrete instance to solve. */
  userPrompt: string;
  /** Query options (mcpServers, tool config, maxTurns). systemPrompt is set by us. */
  queryOptions: Omit<Options, 'systemPrompt'>;
  /**
   * Zod schema validating the agent's JSON output. Required unless a
   * custom `parse` is supplied. Using a schema (vs. `as T`) catches
   * malformed output at the stage boundary with a clear error instead
   * of a downstream crash.
   */
  schema?: ZodType<T>;
  /**
   * Custom parser for the raw text reply. Supply this only when the
   * agent is expected to return non-JSON (rare). If omitted, `schema`
   * is required and `parseAgentJson` is used.
   */
  parse?: (rawText: string) => T;
  /** Caller-provided observer. If omitted, one is created internally. */
  observer?: AgentObserver;
}

export interface RunAgentResult<T> {
  result: T;
  observation: AgentObservation;
}

/**
 * Shared driver for every agent in this package. Collapses the
 * repetitive query-loop + JSON-extraction + observer wiring into one
 * call.
 *
 * **Structured output strategy (tool-use-as-output):**
 * When `schema` is provided, a lightweight `submit_result` MCP server
 * is automatically registered. The LLM calls this tool with its
 * structured output as arguments; the SDK validates against the zod
 * schema before invoking the handler. If validation fails, the error
 * is returned to the LLM as a tool_result with isError=true — the
 * agent sees the specific validation error and retries within the
 * same turn loop. No separate retry wrapper needed.
 *
 * Fallback: if the agent finishes without calling submit_result
 * (shouldn't happen, but possible with third-party models), the
 * final text output is parsed with `parseAgentJson` as before.
 */
export async function runAgent<T>(
  input: RunAgentInput<T>
): Promise<RunAgentResult<T>> {
  if (!input.schema && !input.parse) {
    throw new Error(
      `runAgent({ agentName: '${input.agentName}' }): pass either 'schema' or 'parse'`
    );
  }

  const model =
    input.queryOptions.model ?? process.env.AGENT_MODEL ?? 'claude-sonnet-4-6';

  // Per-agent / global maxTurns override. Useful when running on a
  // non-Claude gateway that takes more turns to navigate the same task.
  // Precedence: AGENT_MAX_TURNS_<UPPER_SNAKE_NAME> > AGENT_MAX_TURNS >
  // agent's built-in default in queryOptions.
  const maxTurns =
    resolveMaxTurnsOverride(input.agentName) ?? input.queryOptions.maxTurns;

  const observer =
    input.observer ?? createObserver(input.stage, input.agentName);

  // ── Submit result server (tool-use-as-output) ────────────
  // Only created when a zod schema is provided. The server registers
  // one tool: mcp__output__submit_result. The agent calls it with the
  // structured result; the SDK validates; the handler captures it.
  const submit =
    input.schema && !input.parse
      ? createSubmitResultServer(input.agentName, input.schema)
      : null;

  const mcpServers = {
    ...(input.queryOptions.mcpServers ?? {}),
    ...(submit ? { output: submit.server } : {}),
  };

  const allowedTools = [
    ...((input.queryOptions.allowedTools as string[] | undefined) ?? []),
    ...(submit ? [submit.toolName] : []),
  ];

  // Patch canUseTool to also allow the submit tool.
  // We spread the original canUseTool and intercept only the submit
  // tool name, forwarding everything else unchanged.
  const originalCanUseTool = input.queryOptions.canUseTool;
  const canUseTool = submit
    ? ((async (...args: Parameters<NonNullable<Options['canUseTool']>>) => {
        if (args[0] === submit.toolName) {
          return { behavior: 'allow' as const };
        }
        if (originalCanUseTool) {
          return originalCanUseTool(...args);
        }
        return { behavior: 'allow' as const };
      }) satisfies Options['canUseTool'])
    : input.queryOptions.canUseTool;

  log.info(
    { agent: input.agentName, model, hasSubmitTool: !!submit, maxTurns },
    `${input.agentName} starting`
  );

  // Toggle full SDK message tracing for local debugging via AGENT_TRACE_SDK=1.
  // Off by default — prod logs would otherwise drown in tool_use payloads.
  const traceSdk = process.env.AGENT_TRACE_SDK === '1';

  let lastResult: string | undefined;
  let turn = 0;

  try {
    for await (const message of query({
      prompt: input.userPrompt,
      options: {
        ...input.queryOptions,
        systemPrompt: input.systemPrompt,
        model,
        mcpServers,
        allowedTools,
        canUseTool,
        maxTurns,
      },
    })) {
      if (traceSdk) {
        const m = message as Record<string, unknown>;
        log.info(
          {
            agent: input.agentName,
            turn,
            type: m.type,
            subtype: m.subtype,
            sdkMessage: message,
          },
          `[sdk] ${String(m.type ?? 'unknown')}${m.subtype ? `:${String(m.subtype)}` : ''}`
        );
      }
      turn += 1;
      observer.onMessage(message);
      if (
        (message as Record<string, unknown>).type === 'result' &&
        (message as Record<string, unknown>).subtype === 'success'
      ) {
        lastResult = (message as { result: string }).result;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    observer.recordError(message);
    log.error(
      { agent: input.agentName, model, err },
      `${input.agentName} SDK iteration failed`
    );
    throw err;
  }

  // ── Extract result ─────────────────────────────────────────
  // Three tiers: submit_result tool > text parse fallback > error

  // Tier 1 — primary: tool-use-as-output captured a validated result
  if (submit?.getResult() != null) {
    log.info(
      { agent: input.agentName },
      `${input.agentName} complete (via submit_result tool)`
    );
    return { result: submit.getResult() as T, observation: observer.collect() };
  }

  // Tier 2 — fallback: parse structured JSON from final text.
  // This path exists for backward compatibility with models that
  // ignore the tool and output JSON directly. Log it clearly so
  // we can track how often it fires and eventually remove it.
  if (lastResult) {
    try {
      const parse =
        input.parse ??
        ((raw: string) => parseAgentJson(raw, input.schema as ZodType<T>));
      const parsed = parse(lastResult);
      log.warn(
        { agent: input.agentName },
        `${input.agentName} complete (via text parse fallback) — agent did not call submit_result`
      );
      return { result: parsed, observation: observer.collect() };
    } catch (parseErr) {
      // Both paths failed — fall through to tier 3
      log.error(
        { agent: input.agentName, err: parseErr },
        `${input.agentName} text parse fallback also failed`
      );
    }
  }

  // Tier 3 — error: neither path produced a result
  throw new Error(
    `${input.agentName}: failed to capture structured result. ` +
      'Agent did not call submit_result tool AND final text could not be parsed. ' +
      'Check the agent prompt or model compatibility.'
  );
}

/**
 * Look up a maxTurns override from the environment. Returns null when no
 * relevant env var is set or the value isn't a positive integer (so the
 * caller can fall back to the agent's compiled-in default cleanly).
 *
 * Precedence: per-agent (`AGENT_MAX_TURNS_<UPPER_SNAKE>`) beats global
 * (`AGENT_MAX_TURNS`). Agent name `analyzeDefect` maps to env key
 * `AGENT_MAX_TURNS_ANALYZE_DEFECT`.
 */
function resolveMaxTurnsOverride(agentName: string): number | null {
  const upperSnake = agentName
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toUpperCase();
  const candidates = [
    process.env[`AGENT_MAX_TURNS_${upperSnake}`],
    process.env.AGENT_MAX_TURNS,
  ];
  for (const raw of candidates) {
    if (raw == null || raw === '') continue;
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}
