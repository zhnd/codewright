import { type Prisma, prisma } from '@codewright/database';
import type { AgentInvocationTrace } from '@codewright/domain';
import { Context } from '@temporalio/activity';
import { log } from '../logger.js';

export interface PersistAgentInvocationInput {
  /** STAGE-kind TaskEvent the agent invocation belongs to. */
  taskEventId: string;
  /** Trace captured by the observer during the agent's run. Status is
   *  whatever the observer last saw; the workflow can pass `errorText`
   *  to override on the catch path. */
  capturedTrace: AgentInvocationTrace;
  /** When the activity wrapper caught a thrown error, the workflow can
   *  pass it through here so the row reflects the outer failure rather
   *  than the SDK-reported state. */
  errorText?: string;
}

export interface PersistAgentInvocationResult {
  agentInvocationId: string;
}

/**
 * Phase 1 trace persistence. Writes one AgentInvocation + its
 * AgentTurn[] + ToolCall[] in a single Prisma transaction.
 *
 * **Idempotency** (decision C3 in the plan): the row's primary key is
 * Temporal's `activityId`, which is stable across retries within the
 * same scheduled activity. On retry the upsert short-circuits and the
 * `skipDuplicates: true` on child rows handles partial-write races. The
 * `(agentInvocationId, turnIndex)` and `(agentInvocationId, toolUseId)`
 * unique constraints in the schema are the ultimate safety net.
 *
 * Phase 1 captures metadata only — `textContent` and `tool_call.input/
 * output` are typically null/empty placeholder. The full message text +
 * tool I/O bodies arrive in Phase 2 with the raw-message stream.
 */
export async function persistAgentInvocationActivity(
  input: PersistAgentInvocationInput
): Promise<PersistAgentInvocationResult> {
  const activityId = Context.current().info.activityId;
  const { taskEventId, capturedTrace, errorText } = input;

  log.info(
    {
      taskEventId,
      activityId,
      agentName: capturedTrace.agentName,
      turnCount: capturedTrace.turns.length,
      toolCount: capturedTrace.toolCalls.length,
      status: capturedTrace.status,
    },
    'Persisting agent invocation trace'
  );

  return prisma.$transaction(async (tx) => {
    const inv = await tx.agentInvocation.upsert({
      where: { id: activityId },
      create: {
        id: activityId,
        taskEventId,
        agentName: capturedTrace.agentName,
        model: capturedTrace.model,
        status: capturedTrace.status,
        errorText: errorText ?? capturedTrace.errorText,
        spanId: capturedTrace.spanId,
        parentSpanId: capturedTrace.parentSpanId,
        startedAt: new Date(capturedTrace.startedAt),
        endedAt: capturedTrace.endedAt ? new Date(capturedTrace.endedAt) : null,
        durationMs: capturedTrace.durationMs,
        totalCostUsd: capturedTrace.totalCostUsd,
        inputTokens: capturedTrace.inputTokens,
        outputTokens: capturedTrace.outputTokens,
      },
      // Retry path: row already exists, no-op.
      update: {},
    });

    if (capturedTrace.turns.length > 0) {
      await tx.agentTurn.createMany({
        data: capturedTrace.turns.map((t) => ({
          agentInvocationId: inv.id,
          turnIndex: t.turnIndex,
          role: t.role,
          textContent: t.textContent,
          textTruncatedAt: t.textTruncatedAt,
          toolUseCount: t.toolUseCount,
          inputTokens: t.inputTokens,
          outputTokens: t.outputTokens,
          startedAt: new Date(t.startedAt),
        })),
        skipDuplicates: true,
      });
    }

    if (capturedTrace.toolCalls.length > 0) {
      // Resolve the freshly-created (or already-present) turn rows so
      // we can attach each tool call to its parent turn by turnIndex.
      const turnRows = await tx.agentTurn.findMany({
        where: { agentInvocationId: inv.id },
        select: { id: true, turnIndex: true },
      });
      const turnIdByIndex = new Map(turnRows.map((r) => [r.turnIndex, r.id]));

      await tx.toolCall.createMany({
        data: capturedTrace.toolCalls.map((tc) => ({
          agentInvocationId: inv.id,
          agentTurnId:
            tc.agentTurnIndex != null
              ? (turnIdByIndex.get(tc.agentTurnIndex) ?? null)
              : null,
          toolUseId: tc.toolUseId,
          name: tc.name,
          // Phase 1 doesn't capture tool input bodies; placeholder empty
          // object satisfies the NOT NULL Json column. Phase 2 raw-msg
          // pipeline will backfill real content.
          input: tc.input == null ? {} : (tc.input as Prisma.InputJsonValue),
          output: tc.output,
          outputTruncatedAt: tc.outputTruncatedAt,
          success: tc.success,
          errorText: tc.errorText,
          spanId: tc.spanId,
          parentSpanId: tc.parentSpanId,
          startedAt: new Date(tc.startedAt),
          endedAt: tc.endedAt ? new Date(tc.endedAt) : null,
          durationMs: tc.durationMs,
        })),
        skipDuplicates: true,
      });
    }

    return { agentInvocationId: inv.id };
  });
}
