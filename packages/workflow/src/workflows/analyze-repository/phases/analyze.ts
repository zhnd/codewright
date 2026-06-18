import type { AnalyzeRepositoryInput } from '@codewright/domain';
import type { PhaseContext } from '../index.js';
import { main, sandboxAgent } from '../proxies.js';
import { buildAnalyzeStageInput } from '../transformer.js';

/**
 * Single-stage analysis: open ANALYSIS, run the agent, close with the
 * full analysis output. No HITL gate, no retry loop.
 */
export async function runAnalyze(
  ctx: PhaseContext,
  input: AnalyzeRepositoryInput
): Promise<void> {
  const { startedStage } = await main.updateTaskActivity({
    taskId: ctx.taskId,
    startStage: {
      stageKey: 'ANALYSIS',
      input: buildAnalyzeStageInput({ input }),
    },
  });
  const eventId = startedStage!.eventId;

  const out = await sandboxAgent.analyzeCodeActivity(ctx.sandboxState);
  await main.persistAgentInvocationActivity({
    taskEventId: eventId,
    capturedTrace: out.capturedTrace,
    errorText: out.errorText,
  });
  if (out.status !== 'SUCCESS' || !out.result) {
    await main.updateTaskActivity({
      taskId: ctx.taskId,
      updateStage: {
        eventId,
        status: 'FAILED',
        error: out.errorText ?? 'analyzeCode failed',
      },
    });
    throw new Error(out.errorText ?? 'analyzeCode failed');
  }

  await main.updateTaskActivity({
    taskId: ctx.taskId,
    updateStage: { eventId, status: 'COMPLETED', output: out.result },
  });
}
