/**
 * OTel-shaped execution telemetry types. These mirror Layer 1 Prisma
 * models in packages/database/prisma/schema.prisma but exist here so
 * producers (observer, activities) and consumers (server, web) share a
 * single contract without pulling in the Prisma client type.
 */

// ── Size caps for truncated fields ─────────────────────────

export const TOOL_OUTPUT_CAP_BYTES = 32 * 1024;
export const TURN_TEXT_CAP_BYTES = 8 * 1024;

// ── Model pricing (cost computed from tokens, not SDK-reported) ──
//
// The Claude Agent SDK reports `total_cost_usd` using Anthropic's price
// table. When the SDK harness is pointed at a custom model (via an
// Anthropic-compatible gateway), that figure is wrong or zero. We instead
// derive cost from token counts × this table. Keep this map in sync with
// whatever models the gateway actually routes to. Unknown models yield
// `null` (callers must not fabricate a number).

export interface ModelPricing {
  /** USD per 1M input (prompt) tokens. */
  inputPer1M: number;
  /** USD per 1M output (completion) tokens. */
  outputPer1M: number;
}

/**
 * In-code fallback price table. Used only when a model is absent from the
 * database-backed price table AND the remote price fetch fails. The
 * authoritative source is the `ModelPrice` table (see the workflow pricing
 * service), populated on demand from a public price API. Keep a few stable
 * reference prefixes here so cost is never silently zero on a fresh DB.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic Claude — reference list prices (USD / 1M tokens).
  'claude-opus-4': { inputPer1M: 15, outputPer1M: 75 },
  'claude-sonnet-4': { inputPer1M: 3, outputPer1M: 15 },
  'claude-haiku-4-5': { inputPer1M: 1, outputPer1M: 5 },
};

/**
 * Resolve a {@link ModelPricing} entry for `model` from a price table.
 * Matching is exact first, then by the longest table key that is a prefix
 * of `model` (tolerates suffixes like dated / `[1m]` variants). Returns
 * `null` when no key matches. Shared by the cost calculator (below) and
 * the workflow pricing service (to detect a missing model → trigger fetch).
 */
export function findModelPricing(
  model: string,
  table: Record<string, ModelPricing>
): ModelPricing | null {
  const exact = table[model];
  if (exact) return exact;
  const prefixKey = Object.keys(table)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return prefixKey ? (table[prefixKey] ?? null) : null;
}

/**
 * Compute invocation cost from token counts and a price `table` (defaults
 * to the in-code {@link MODEL_PRICING} fallback). Callers that have the
 * database-backed table (the observer, via the workflow pricing service)
 * pass it here. Returns `null` when the model is unknown or token counts
 * are missing — callers should fall back (e.g. to an SDK-reported figure)
 * or record `null` rather than invent a value.
 */
export function computeCostUsd(
  model: string,
  inputTokens: number | null,
  outputTokens: number | null,
  table: Record<string, ModelPricing> = MODEL_PRICING
): number | null {
  if (inputTokens == null || outputTokens == null) return null;
  const pricing = findModelPricing(model, table);
  if (!pricing) return null;
  return (
    (inputTokens / 1_000_000) * pricing.inputPer1M +
    (outputTokens / 1_000_000) * pricing.outputPer1M
  );
}

// ── Status-ish vocabulary (as-const maps, not enums) ───────

export const EXECUTION_STATUS = {
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type ExecutionStatusValue =
  (typeof EXECUTION_STATUS)[keyof typeof EXECUTION_STATUS];

export const STAGE_STATUS = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  AWAITING: 'AWAITING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
} as const;
export type StageStatusValue = (typeof STAGE_STATUS)[keyof typeof STAGE_STATUS];

export const AGENT_INVOCATION_STATUS = {
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  ERROR: 'ERROR',
} as const;
export type AgentInvocationStatusValue =
  (typeof AGENT_INVOCATION_STATUS)[keyof typeof AGENT_INVOCATION_STATUS];

export const ATTEMPT_TRIGGER_KIND = {
  INITIAL: 'initial',
  REFLEXION_RETRY: 'reflexion-retry',
  HITL_REJECT: 'hitl-reject',
  SAMPLE_GENERATION: 'sample-generation',
  FILTER_FAIL_RETRY: 'filter-fail-retry',
} as const;
export type AttemptTriggerKind =
  (typeof ATTEMPT_TRIGGER_KIND)[keyof typeof ATTEMPT_TRIGGER_KIND];

// ── Append-only agent message log (streaming) ─────────────
//
// Provider-neutral event taxonomy. `kind` borrows the OpenTelemetry GenAI
// semantic-convention vocabulary (gen_ai.assistant.message / .tool.message
// / .usage …) so the persisted message log isn't tied to a specific SDK's
// field names. The observer (the only SDK-aware component) translates the
// native message stream into these events; everything downstream — sink,
// DB, server, web — consumes the neutral shape.

export const AGENT_EVENT_KIND = {
  /** assistant or user natural-language message text. */
  MESSAGE: 'message',
  /** assistant reasoning / thinking block (collapsible in UI). */
  REASONING: 'reasoning',
  /** a tool_use issued by the assistant. */
  TOOL_CALL: 'tool_call',
  /** a tool_result returned to the assistant. */
  TOOL_RESULT: 'tool_result',
  /** token / cost usage snapshot. */
  USAGE: 'usage',
  /** terminal or out-of-band error. */
  ERROR: 'error',
} as const;
export type AgentEventKind =
  (typeof AGENT_EVENT_KIND)[keyof typeof AGENT_EVENT_KIND];

/**
 * One streamed agent-message-log event. Produced by the observer per native SDK
 * message and handed to an {@link AgentMessageSink}. `seq` is assigned by
 * the observer, monotonic from 0 within a single activity attempt — it is
 * the idempotency key (paired with the invocation id) for at-least-once
 * writes, NOT the global read cursor (that is the DB autoincrement column).
 */
export interface AgentLogEvent {
  seq: number;
  kind: AgentEventKind;
  /** 'assistant' | 'user' | 'system' when meaningful; null otherwise. */
  role: string | null;
  /** Truncated text for message/reasoning events (cap TURN_TEXT_CAP_BYTES). */
  textContent: string | null;
  textTruncatedAt: number | null;
  /** Correlation + naming for tool_call / tool_result events. */
  toolUseId: string | null;
  toolName: string | null;
  /** Structured body: tool input/output, usage figures, etc. (trimmed). */
  payload: unknown;
  payloadTruncatedAt: number | null;
  spanId: string;
  parentSpanId: string;
}

/**
 * Side-effect boundary for streaming agent-message-log events out of the observer
 * during a run. Defined here (leaf package) so `agent-runtime` stays free
 * of any persistence dependency; the prisma-backed implementation lives in
 * the workflow layer. `append` buffers; `flush` drains (called on terminal
 * messages and on the heartbeat tick).
 */
export interface AgentMessageSink {
  append(event: AgentLogEvent): void;
  flush(): Promise<void>;
}

// Record-shaped trace types removed with the trace tier; the data model
// is now Task → TaskEvent (stage + status + cost) + AgentMessageLog.

// ── Span helpers ───────────────────────────────────────────

/**
 * Produces a 16-hex-character span id (OTel span_id shape).
 * Uses Web Crypto randomUUID, drops dashes, takes 16 chars.
 */
export function generateSpanId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

/**
 * Produces a 32-hex-character trace id (OTel trace_id shape).
 */
export function generateTraceId(): string {
  return (
    crypto.randomUUID().replace(/-/g, '') +
    crypto.randomUUID().replace(/-/g, '').slice(0, 0)
  ).slice(0, 32);
}

/**
 * Deterministic 32-hex (OTel trace_id shape) trace id for a task: the
 * first 32 hex chars of SHA-256(taskId). Stable across the task's stages
 * and agent runs without storing a column or coordinating writes, so every
 * message-log row of one task shares a trace and the task→stage→activity→
 * tool hierarchy is reconstructable from the DB.
 *
 * Uses Web Crypto (`crypto.subtle`) — available both in Node and in the
 * Temporal workflow sandbox — so this leaf module stays free of any
 * `node:crypto` import that would break the workflow bundle. Matches
 * Postgres `substring(encode(digest(task_id,'sha256'),'hex') for 32)` used
 * by the backfill migration.
 */
export async function traceIdForTask(taskId: string): Promise<string> {
  const bytes = new TextEncoder().encode(taskId);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

/**
 * Truncate a string to at most `capBytes` UTF-8 bytes. Returns the
 * original if under cap. Second return is the original byte size
 * when truncation happened; null otherwise.
 */
export function truncateToBytes(
  input: string,
  capBytes: number
): { text: string; truncatedAt: number | null } {
  const encoded = new TextEncoder().encode(input);
  if (encoded.length <= capBytes) return { text: input, truncatedAt: null };
  const truncated = new TextDecoder('utf-8', { fatal: false }).decode(
    encoded.slice(0, capBytes)
  );
  return { text: truncated, truncatedAt: encoded.length };
}
