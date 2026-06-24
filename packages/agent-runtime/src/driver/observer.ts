import {
  AGENT_EVENT_KIND,
  AGENT_INVOCATION_STATUS,
  type AgentCost,
  type AgentEventKind,
  type AgentInvocationStatusValue,
  type AgentLogEvent,
  type AgentMessageSink,
  type AgentObservation,
  computeCostUsd,
  generateSpanId,
  type ModelPricing,
  type ObservedEvent,
  TOOL_OUTPUT_CAP_BYTES,
  TURN_TEXT_CAP_BYTES,
  truncateToBytes,
} from '@codewright/domain';
import { log } from '../logger.js';
import {
  describeResultError,
  stringifyToolResult,
  summarizeToolInput,
  truncateInput,
} from './observer-parse.js';

export interface AgentObserver {
  onMessage(message: unknown): void;
  /**
   * Record an out-of-band failure (e.g., SDK iterator threw before a
   * terminal `result` message was produced). Emits an error event and
   * stamps cost/status. No-op if the run already completed.
   */
  recordError(message: string): void;
  /** Stage-level events (for logs) + cost rollup (for the stage's
   *  TaskEvent cost columns). */
  collect(): AgentObservation;
}

/**
 * Build an observer that consumes the Agent SDK message stream and:
 *
 * 1. Translates each native SDK message into provider-neutral
 *    `AgentLogEvent`s (message / reasoning / tool_call / tool_result /
 *    usage / error) and appends them to the optional `sink`, so the web
 *    can follow + replay the run live (this is the source-of-truth
 *    agent message log).
 * 2. Computes the run's `AgentCost` (tokens × {@link computeCostUsd}, with
 *    the SDK figure only as fallback) for the stage cost rollup, exposed
 *    via `collect()`.
 *
 * The observer is the ONLY SDK-aware component; everything downstream
 * consumes the neutral `AgentLogEvent` shape.
 */
export interface ObserverOptions {
  /** When provided, message-log events are streamed out during the run. */
  sink?: AgentMessageSink;
  /** This run's invocation span id — the parent of every emitted event
   *  span. Its own parent (the stage span) is reconstructable via the
   *  row's taskEventId → TaskEvent.spanId. */
  spanId?: string;
  /**
   * Price table (USD / 1M tokens, keyed by model) used to compute run cost.
   * Supplied by the workflow pricing service (DB-backed, remote-populated).
   * When omitted, cost falls back to the in-code `MODEL_PRICING` map.
   */
  pricing?: Record<string, ModelPricing>;
}

export function createObserver(
  stage: string,
  agentName: string,
  opts?: ObserverOptions
): AgentObserver {
  const sink = opts?.sink;
  const pricing = opts?.pricing;
  const invocationSpanId = opts?.spanId ?? generateSpanId();
  let logSeq = 0;
  const emit = (e: {
    kind: AgentEventKind;
    role?: string | null;
    textContent?: string | null;
    textTruncatedAt?: number | null;
    toolUseId?: string | null;
    toolName?: string | null;
    payload?: unknown;
    payloadTruncatedAt?: number | null;
  }): void => {
    if (!sink) return;
    const event: AgentLogEvent = {
      seq: logSeq,
      kind: e.kind,
      role: e.role ?? null,
      textContent: e.textContent ?? null,
      textTruncatedAt: e.textTruncatedAt ?? null,
      toolUseId: e.toolUseId ?? null,
      toolName: e.toolName ?? null,
      payload: e.payload ?? null,
      payloadTruncatedAt: e.payloadTruncatedAt ?? null,
      spanId: generateSpanId(),
      parentSpanId: invocationSpanId,
    };
    logSeq += 1;
    sink.append(event);
  };

  // Legacy stage-level events (logs) + cost rollup.
  const events: ObservedEvent[] = [];
  let cost: AgentCost | null = null;
  const startedAtMs = Date.now();

  let invocationStatus: AgentInvocationStatusValue =
    AGENT_INVOCATION_STATUS.RUNNING;
  let modelUsed = 'unknown';

  return {
    onMessage(message: unknown) {
      const msg = message as Record<string, unknown>;
      const nowIso = new Date().toISOString();

      // ── assistant message → text / reasoning / tool_use ────
      if (msg.type === 'assistant') {
        const beta = msg.message as {
          content?: Array<{
            type: string;
            id?: string;
            name?: string;
            input?: unknown;
            text?: string;
            thinking?: string;
          }>;
        };
        const content = beta?.content ?? [];

        const reasoningText = content
          .filter(
            (b) => b.type === 'thinking' && typeof b.thinking === 'string'
          )
          .map((b) => b.thinking as string)
          .join('\n');
        if (reasoningText) {
          const r = truncateToBytes(reasoningText, TURN_TEXT_CAP_BYTES);
          emit({
            kind: AGENT_EVENT_KIND.REASONING,
            role: 'assistant',
            textContent: r.text,
            textTruncatedAt: r.truncatedAt,
          });
        }

        const assistantText = content
          .filter((b) => b.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text as string)
          .join('\n');
        if (assistantText) {
          const t = truncateToBytes(assistantText, TURN_TEXT_CAP_BYTES);
          emit({
            kind: AGENT_EVENT_KIND.MESSAGE,
            role: 'assistant',
            textContent: t.text,
            textTruncatedAt: t.truncatedAt,
          });
        }

        for (const block of content.filter((b) => b.type === 'tool_use')) {
          if (!block.id || !block.name) continue;
          const captured = truncateInput(block.input);
          emit({
            kind: AGENT_EVENT_KIND.TOOL_CALL,
            role: 'assistant',
            toolUseId: block.id,
            toolName: block.name,
            payload: captured.value,
            payloadTruncatedAt: captured.truncatedAt,
          });
          events.push({
            stage,
            event: `Tool call: ${block.name}`,
            level: 'info',
            agent: agentName,
            tool: block.name,
            details: summarizeToolInput(block.name, block.input),
            timestamp: nowIso,
          });
        }
      }

      // ── user message → tool_result blocks ──────────────────
      if (msg.type === 'user') {
        const userMsg = msg.message as {
          content?: Array<{
            type: string;
            tool_use_id?: string;
            is_error?: boolean;
            content?: unknown;
          }>;
        };
        for (const block of userMsg?.content ?? []) {
          if (block.type !== 'tool_result' || !block.tool_use_id) continue;
          const out = truncateToBytes(
            stringifyToolResult(block.content),
            TOOL_OUTPUT_CAP_BYTES
          );
          emit({
            kind: AGENT_EVENT_KIND.TOOL_RESULT,
            role: 'user',
            toolUseId: block.tool_use_id,
            textContent: out.text,
            textTruncatedAt: out.truncatedAt,
            payload: { isError: block.is_error === true },
          });
        }
      }

      // ── terminal result → cost + status ────────────────────
      // BOTH success and error results carry usage/modelUsage/cost
      // (see SDKResultError); compute and record cost for either so the
      // most-worth-observing runs — max turns, budget exceeded, exec
      // errors — never vanish from the cost report.
      if (msg.type === 'result') {
        const result = msg as {
          subtype?: string;
          total_cost_usd?: number;
          duration_ms?: number;
          usage?: { input_tokens?: number; output_tokens?: number };
          modelUsage?: Record<string, unknown>;
          terminal_reason?: string;
          errors?: string[];
          permission_denials?: Array<{ tool_name?: string }>;
        };
        const isSuccess = result.subtype === 'success';

        if (result.modelUsage) {
          modelUsed = Object.keys(result.modelUsage)[0] ?? 'unknown';
        }
        const inputTokens = result.usage?.input_tokens ?? null;
        const outputTokens = result.usage?.output_tokens ?? null;
        // Cost: tokens × our price table (the SDK figure assumes Anthropic
        // pricing and is wrong for custom/gateway models); SDK as fallback.
        const computed = computeCostUsd(
          modelUsed,
          inputTokens,
          outputTokens,
          pricing
        );
        if (computed == null && result.total_cost_usd == null) {
          log.warn(
            { agent: agentName, model: modelUsed },
            'no price entry for model and no SDK cost — cost recorded as 0'
          );
        }
        const totalCostUsd = computed ?? result.total_cost_usd ?? 0;
        const durationMs = result.duration_ms ?? Date.now() - startedAtMs;

        invocationStatus = isSuccess
          ? AGENT_INVOCATION_STATUS.SUCCESS
          : AGENT_INVOCATION_STATUS.ERROR;
        cost = {
          totalCostUsd,
          inputTokens: inputTokens ?? 0,
          outputTokens: outputTokens ?? 0,
          durationMs,
          model: modelUsed,
        };
        // Usage snapshot recorded for BOTH outcomes.
        emit({
          kind: AGENT_EVENT_KIND.USAGE,
          payload: {
            model: modelUsed,
            inputTokens,
            outputTokens,
            totalCostUsd,
            durationMs,
          },
        });

        if (isSuccess) {
          events.push({
            stage,
            event: `Agent completed (${(durationMs / 1000).toFixed(1)}s, $${totalCostUsd.toFixed(4)})`,
            level: 'info',
            agent: agentName,
            timestamp: nowIso,
          });
        } else {
          // Real terminal reason instead of the downstream generic
          // "failed to capture structured result" message.
          const reason = describeResultError(result);
          emit({ kind: AGENT_EVENT_KIND.ERROR, textContent: reason });
          events.push({
            stage,
            event: 'Agent error',
            level: 'error',
            agent: agentName,
            details: reason,
            timestamp: nowIso,
          });
        }
      }
    },

    recordError(message: string) {
      // Skip only if an error was already recorded (e.g. an error
      // `result` message). A late failure after a *successful* result
      // (parse/validation throw) still gets an ERROR event for message-log
      // completeness, and the already-computed cost is left intact.
      if (invocationStatus === AGENT_INVOCATION_STATUS.ERROR) return;
      invocationStatus = AGENT_INVOCATION_STATUS.ERROR;
      const errorText = message.slice(0, 500);
      emit({ kind: AGENT_EVENT_KIND.ERROR, textContent: errorText });
      events.push({
        stage,
        event: 'Agent error',
        level: 'error',
        agent: agentName,
        details: errorText,
        timestamp: new Date().toISOString(),
      });
    },

    collect(): AgentObservation {
      return { events, cost };
    },
  };
}
