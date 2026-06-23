import { Prisma, prisma } from '@codewright/database';
import type { AgentLogEvent, AgentMessageSink } from '@codewright/domain';
import { log } from '../logger.js';

/**
 * Flush after this many buffered events (or on the heartbeat tick / at
 * activity end, whichever comes first). Batches keep write amplification
 * down under tool-storms; the server's micro-batched fan-out smooths the
 * read side.
 */
const DEFAULT_FLUSH_EVERY_N = 8;

export interface PrismaMessageSink extends AgentMessageSink {
  /** Highest seq successfully flushed (−1 if none) — carried in the
   *  heartbeat for diagnostics. */
  highWaterMark(): number;
}

export interface PrismaMessageSinkOptions {
  /** Denormalized onto each row for the NOTIFY trigger + subscription. */
  taskId: string;
  /** Per-task trace id (stable across stages/runs) for OTel-shaped
   *  trace reconstruction. Constant for every row of this run. */
  traceId: string;
  /** The STAGE TaskEvent these messages belong to (FK anchor). */
  taskEventId: string;
  /** Temporal activityId — idempotency key (with seq) + retry-rewrite key. */
  activityId: string;
  flushEveryN?: number;
}

/**
 * Prisma-backed {@link AgentMessageSink}. Buffers streamed agent message
 * log events and writes them in batched `createMany` calls during the run.
 *
 * Best-effort: a failed flush re-buffers the batch and logs a warning
 * rather than killing the agent — the final reconcile in
 * `persistAgentInvocationActivity` backfills any gap. Idempotent via the
 * `(agentInvocationId, seq)` unique constraint + `skipDuplicates`.
 *
 * Drains are serialized on a single promise chain so concurrent
 * threshold-flushes and the heartbeat/terminal flush never interleave.
 */
export function createPrismaMessageSink(
  opts: PrismaMessageSinkOptions
): PrismaMessageSink {
  const flushEveryN = opts.flushEveryN ?? DEFAULT_FLUSH_EVERY_N;
  const buffer: AgentLogEvent[] = [];
  let chain: Promise<void> = Promise.resolve();
  let highWater = -1;

  const drain = async (): Promise<void> => {
    if (buffer.length === 0) return;
    const batch = buffer.splice(0, buffer.length);
    try {
      await prisma.agentMessageLog.createMany({
        data: batch.map((e) => ({
          taskId: opts.taskId,
          traceId: opts.traceId,
          taskEventId: opts.taskEventId,
          activityId: opts.activityId,
          seq: e.seq,
          kind: e.kind,
          role: e.role,
          textContent: e.textContent,
          textTruncatedAt: e.textTruncatedAt,
          toolUseId: e.toolUseId,
          toolName: e.toolName,
          payload:
            e.payload == null
              ? Prisma.DbNull
              : (e.payload as Prisma.InputJsonValue),
          payloadTruncatedAt: e.payloadTruncatedAt,
          spanId: e.spanId,
          parentSpanId: e.parentSpanId,
        })),
        skipDuplicates: true,
      });
      for (const e of batch) highWater = Math.max(highWater, e.seq);
    } catch (err) {
      // Re-buffer for the next attempt; dedupe is guaranteed by the
      // unique constraint so a partial-write retry is safe.
      buffer.unshift(...batch);
      log.warn(
        { err, activityId: opts.activityId, size: batch.length },
        'agent message sink flush failed; will retry on next flush'
      );
    }
  };

  const schedule = (): Promise<void> => {
    chain = chain.then(drain);
    return chain;
  };

  return {
    append(event) {
      buffer.push(event);
      if (buffer.length >= flushEveryN) void schedule();
    },
    flush() {
      return schedule();
    },
    highWaterMark() {
      return highWater;
    },
  };
}
