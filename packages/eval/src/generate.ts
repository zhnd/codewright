import { prisma } from '@torin/database';
import { createTemporalClient, TASK_QUEUE } from '@torin/workflow';
import { repoUrl, type SweInstance } from './dataset.js';
import { extractModelPatch } from './extract-patch.js';

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export interface GenResult {
  instanceId: string;
  taskId: string;
  status: string;
  /** Source-only unified diff, or null if none was produced. */
  modelPatch: string | null;
}

/**
 * Generate a patch for one SWE-bench instance: create the task, start the
 * resolveDefect workflow pinned to `base_commit`, auto-approve every HITL
 * gate (headless equivalent of the web "approve"), wait for terminal, then
 * extract the source patch from the CRITIC output.
 *
 * Note: the PR/push stage fails for read-only SWE-bench repos (task ends
 * FAILED) — that's expected and harmless; the patch is read from CRITIC.
 */
export async function generateForInstance(opts: {
  instance: SweInstance;
  projectId: string;
  userId: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}): Promise<GenResult> {
  const { instance, projectId, userId } = opts;
  const pollIntervalMs = opts.pollIntervalMs ?? 5_000;
  const timeoutMs = opts.timeoutMs ?? 60 * 60_000;

  const task = await prisma.task.create({
    data: {
      type: 'RESOLVE_DEFECT',
      status: 'PENDING',
      input: {
        defectDescription: instance.problemStatement,
        sweBenchInstance: instance.instanceId,
      },
      triggerSource: 'eval',
      userId,
      projectId,
    },
  });

  const client = await createTemporalClient();
  const handle = await client.workflow.start('resolveDefectWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId: `resolve-defect-${task.id}`,
    args: [
      {
        taskId: task.id,
        projectId,
        repositoryUrl: repoUrl(instance.repo),
        defectDescription: instance.problemStatement,
        userId,
        baseCommit: instance.baseCommit,
      },
    ],
  });
  await prisma.task.update({
    where: { id: task.id },
    data: { workflowId: handle.workflowId },
  });

  const approved = new Set<string>();
  const start = Date.now();
  let status = 'PENDING';
  while (Date.now() - start < timeoutMs) {
    const t = await prisma.task.findUnique({
      where: { id: task.id },
      select: { status: true },
    });
    status = t?.status ?? 'UNKNOWN';
    if (TERMINAL.has(status)) break;

    const awaiting = await prisma.taskEvent.findFirst({
      where: { taskId: task.id, kind: 'STAGE', status: 'AWAITING' },
      orderBy: { startedAt: 'desc' },
      select: { stageKey: true, attemptNumber: true },
    });
    if (awaiting) {
      const key = `${awaiting.stageKey}#${awaiting.attemptNumber}`;
      if (!approved.has(key)) {
        await handle.signal('reviewDecision', {
          decisionType: 'binary',
          action: 'approve',
        });
        approved.add(key);
      }
    }
    await sleep(pollIntervalMs);
  }

  const modelPatch = await extractModelPatch(task.id);
  return {
    instanceId: instance.instanceId,
    taskId: task.id,
    status,
    modelPatch,
  };
}
