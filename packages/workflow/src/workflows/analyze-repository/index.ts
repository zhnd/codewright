import type { AnalyzeRepositoryInput, TaskStatus } from '@codewright/domain';
import type { SandboxState } from '@codewright/sandbox';
import { CancellationScope, isCancellation } from '@temporalio/workflow';
import { runAnalyze } from './phases/analyze.js';
import { main, sandboxInfra } from './proxies.js';

// ── Phase context ────────────────────────────────────────────────────

export interface PhaseContext {
  taskId: string;
  sandboxState: SandboxState;
}

// ── Workflow ─────────────────────────────────────────────────────────
//
// Owns: sandbox lifecycle, terminal task status, phase sequencing.
// Same try/catch/finally shape as resolve-defect for consistency.

export async function analyzeRepositoryWorkflow(
  input: AnalyzeRepositoryInput
): Promise<void> {
  await main.updateTaskActivity({
    taskId: input.taskId,
    task: { status: 'RUNNING' },
  });

  let sandboxState: SandboxState | undefined;
  try {
    sandboxState = await sandboxInfra.createSandboxActivity(
      input.repositoryUrl,
      { projectId: input.projectId }
    );

    const ctx: PhaseContext = { taskId: input.taskId, sandboxState };

    await runAnalyze(ctx, input);

    await main.updateTaskActivity({
      taskId: input.taskId,
      task: { status: 'COMPLETED' },
    });
  } catch (err) {
    const cancelled = isCancellation(err);
    const status: TaskStatus = cancelled ? 'CANCELLED' : 'FAILED';
    const errorText = cancelled
      ? 'Cancelled by user'
      : err instanceof Error
        ? err.message
        : String(err);

    await CancellationScope.nonCancellable(() =>
      main.updateTaskActivity({
        taskId: input.taskId,
        task: { status, error: errorText },
      })
    );
  } finally {
    // Non-cancellable so a cancel arriving during shutdown can't leak
    // the sandbox container (Temporal-standard cleanup pattern).
    await CancellationScope.nonCancellable(async () => {
      if (sandboxState) {
        await sandboxInfra.destroySandboxActivity(sandboxState);
      }
    });
  }
}
