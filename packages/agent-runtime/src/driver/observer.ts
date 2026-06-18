import {
  AGENT_INVOCATION_STATUS,
  type AgentCost,
  type AgentInvocationStatusValue,
  type AgentInvocationTrace,
  type AgentObservation,
  type AgentTurnTrace,
  generateSpanId,
  type ObservedEvent,
  type ToolCallTrace,
} from '@torin/domain';

export interface AgentObserver {
  onMessage(message: unknown): void;
  /**
   * Record an out-of-band failure (e.g., SDK iterator threw before a
   * terminal `result` message was produced). Sets `errorText` on the
   * trace and flips status to ERROR if not already terminal. No-op if
   * the run has already completed.
   */
  recordError(message: string): void;
  /** Legacy view: stage-level events + cost summary, consumed by the
   *  TaskEvent path. Untouched for back-compat. */
  collect(): AgentObservation;
  /** Trace view: per-turn + per-tool metadata for the
   *  AgentInvocation/AgentTurn/ToolCall persistence path. Phase 1 omits
   *  textContent + tool input/output (deferred to the raw-message phase). */
  collectTrace(): AgentInvocationTrace;
}

/**
 * Build an observer that consumes the Agent SDK message stream and
 * produces two views of the same run:
 *
 * 1. `collect()` — legacy `ObservedEvent[]` + `AgentCost` for stage-level
 *    summaries; preserved verbatim so existing logging/TaskEvent paths
 *    don't change.
 *
 * 2. `collectTrace()` — `AgentInvocationTrace` for the new per-invocation
 *    persistence layer. Phase 1 captures metadata only:
 *    - per turn: index, role, tokens, toolUseCount (no textContent)
 *    - per tool: name, toolUseId, startedAt, endedAt, durationMs, success
 *      (no input/output bodies — those will come from the raw-message
 *      stream in Phase 2)
 *
 *  Tool durations + success are populated when the corresponding
 *  `tool_result` block arrives in a later `user` message; correlation
 *  is by `tool_use_id`.
 */
export function createObserver(
  stage: string,
  agentName: string
): AgentObserver {
  // ── Legacy state (collect) ─────────────────────────────────
  const events: ObservedEvent[] = [];
  let cost: AgentCost | null = null;

  // ── Trace state (collectTrace) ─────────────────────────────
  // Phase 1: parentSpanId has no real upstream context yet (Phase 3 OTel
  // work will inject the workflow / activity span). Generate a placeholder
  // so the column has a stable value — they're unique per invocation but
  // don't form a meaningful tree until Phase 3.
  const invocationSpanId = generateSpanId();
  const parentSpanId = generateSpanId();
  const startedAtMs = Date.now();
  const startedAtIso = new Date(startedAtMs).toISOString();

  let turnIndex = 0;
  const turns: AgentTurnTrace[] = [];
  const toolCalls: ToolCallTrace[] = [];
  // tool_use_id → index in toolCalls, for tool_result correlation
  const toolCallByUseId = new Map<string, number>();

  let invocationStatus: AgentInvocationStatusValue =
    AGENT_INVOCATION_STATUS.RUNNING;
  let modelUsed = 'unknown';
  let endedAtIso: string | null = null;
  let invocationDurationMs: number | null = null;
  let totalCostUsd: number | null = null;
  let invocationInputTokens: number | null = null;
  let invocationOutputTokens: number | null = null;
  let errorText: string | null = null;

  return {
    onMessage(message: unknown) {
      const msg = message as Record<string, unknown>;
      const nowIso = new Date().toISOString();

      // ── assistant message → new turn + tool_use blocks ─────
      if (msg.type === 'assistant') {
        const beta = msg.message as {
          content?: Array<{
            type: string;
            id?: string;
            name?: string;
            input?: unknown;
          }>;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        const content = beta?.content ?? [];
        const toolUseBlocks = content.filter((b) => b.type === 'tool_use');

        const thisTurnIndex = turnIndex;
        turns.push({
          turnIndex: thisTurnIndex,
          role: 'assistant',
          textContent: null, // Phase 1: not captured
          textTruncatedAt: null,
          toolUseCount: toolUseBlocks.length,
          inputTokens: beta?.usage?.input_tokens ?? null,
          outputTokens: beta?.usage?.output_tokens ?? null,
          startedAt: nowIso,
        });
        turnIndex += 1;

        for (const block of toolUseBlocks) {
          if (!block.id || !block.name) continue;
          toolCallByUseId.set(block.id, toolCalls.length);
          toolCalls.push({
            toolUseId: block.id,
            name: block.name,
            input: null, // Phase 1: not captured
            output: null,
            outputTruncatedAt: null,
            success: null,
            errorText: null,
            startedAt: nowIso,
            endedAt: null,
            durationMs: null,
            agentTurnIndex: thisTurnIndex,
            spanId: generateSpanId(),
            parentSpanId: invocationSpanId,
          });

          // Legacy event (kept for back-compat; details summary preserved
          // so existing logs aren't impoverished)
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

      // ── user message → tool_result blocks (correlate) ──────
      if (msg.type === 'user') {
        const userMsg = msg.message as {
          content?: Array<{
            type: string;
            tool_use_id?: string;
            is_error?: boolean;
          }>;
        };
        const content = userMsg?.content ?? [];
        for (const block of content) {
          if (block.type !== 'tool_result' || !block.tool_use_id) continue;
          const idx = toolCallByUseId.get(block.tool_use_id);
          if (idx === undefined) continue;
          const tc = toolCalls[idx];
          tc.endedAt = nowIso;
          tc.durationMs = Date.parse(nowIso) - Date.parse(tc.startedAt);
          tc.success = block.is_error !== true;
        }
      }

      // ── terminal result → cost + status ────────────────────
      if (msg.type === 'result') {
        endedAtIso = nowIso;
        invocationDurationMs = Date.parse(nowIso) - startedAtMs;

        if (msg.subtype === 'success') {
          const result = msg as {
            total_cost_usd?: number;
            duration_ms?: number;
            usage?: { input_tokens: number; output_tokens: number };
            modelUsage?: Record<string, unknown>;
          };
          totalCostUsd = result.total_cost_usd ?? null;
          if (result.duration_ms != null) {
            invocationDurationMs = result.duration_ms;
          }
          invocationInputTokens = result.usage?.input_tokens ?? null;
          invocationOutputTokens = result.usage?.output_tokens ?? null;
          if (result.modelUsage) {
            modelUsed = Object.keys(result.modelUsage)[0] ?? 'unknown';
          }
          invocationStatus = AGENT_INVOCATION_STATUS.SUCCESS;
          cost = {
            totalCostUsd: result.total_cost_usd ?? 0,
            inputTokens: result.usage?.input_tokens ?? 0,
            outputTokens: result.usage?.output_tokens ?? 0,
            durationMs: result.duration_ms ?? 0,
            model: modelUsed,
          };
          events.push({
            stage,
            event: `Agent completed (${((result.duration_ms ?? 0) / 1000).toFixed(1)}s, $${(result.total_cost_usd ?? 0).toFixed(4)})`,
            level: 'info',
            agent: agentName,
            timestamp: nowIso,
          });
        } else if (msg.subtype === 'error') {
          invocationStatus = AGENT_INVOCATION_STATUS.ERROR;
          errorText = String(msg.error ?? '').slice(0, 500);
          events.push({
            stage,
            event: 'Agent error',
            level: 'error',
            agent: agentName,
            details: errorText,
            timestamp: nowIso,
          });
        }
      }
    },

    recordError(message: string) {
      if (invocationStatus !== AGENT_INVOCATION_STATUS.RUNNING) return;
      invocationStatus = AGENT_INVOCATION_STATUS.ERROR;
      errorText = message.slice(0, 500);
      const nowIso = new Date().toISOString();
      endedAtIso = nowIso;
      invocationDurationMs = Date.parse(nowIso) - startedAtMs;
      events.push({
        stage,
        event: 'Agent error',
        level: 'error',
        agent: agentName,
        details: errorText,
        timestamp: nowIso,
      });
    },

    collect(): AgentObservation {
      return { events, cost };
    },

    collectTrace(): AgentInvocationTrace {
      // Activity wrapper may call this on the error path before a
      // terminal result message arrived; stamp endedAt/duration so the
      // row reflects the actual wall time spent.
      const finalEnded = endedAtIso ?? new Date().toISOString();
      const finalDuration =
        invocationDurationMs ?? Date.parse(finalEnded) - startedAtMs;
      return {
        agentName,
        model: modelUsed,
        status: invocationStatus,
        errorText,
        startedAt: startedAtIso,
        endedAt: finalEnded,
        durationMs: finalDuration,
        totalCostUsd,
        inputTokens: invocationInputTokens,
        outputTokens: invocationOutputTokens,
        turns,
        toolCalls,
        spanId: invocationSpanId,
        parentSpanId,
      };
    },
  };
}

function summarizeToolInput(
  toolName: string,
  input: unknown
): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const inp = input as Record<string, unknown>;
  if (toolName.includes('bash') && typeof inp.command === 'string') {
    return inp.command.slice(0, 200);
  }
  if (typeof inp.path === 'string') {
    return inp.path;
  }
  return undefined;
}
