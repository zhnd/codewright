import type { Prisma, PrismaClient } from '@codewright/database';
import { createTemporalClient } from '@codewright/workflow';
import type { User } from 'better-auth';
import {
  AppError,
  NotFoundError,
  UnauthorizedError,
} from '../../../infrastructure/errors/app-error.js';

interface TaskQuery {
  include?: Prisma.TaskInclude;
  select?: Prisma.TaskSelect;
}

/**
 * Records the human review action as a REVIEW event row matching the
 * currently AWAITING stage attempt, then signals the workflow to resume.
 *
 * Writing the row before signaling means the UI sees the new entry
 * immediately via the pg_notify trigger; the workflow processes the
 * signal on its next tick and updates the STAGE row to COMPLETED or
 * REJECTED.
 */
export class ReviewTaskService {
  constructor(private prisma: PrismaClient) {}

  async execute(
    query: TaskQuery,
    taskId: string,
    action: string,
    feedback: string | null | undefined,
    user: User | null
  ) {
    if (!user) {
      throw new UnauthorizedError();
    }

    const task = await this.prisma.task.findFirst({
      where: { id: taskId, userId: user.id },
    });

    if (!task) {
      throw new NotFoundError('Task', taskId);
    }

    if (!task.workflowId) {
      throw new AppError('Task has no associated workflow', 'NO_WORKFLOW', 400);
    }

    const awaiting = await this.prisma.taskEvent.findFirst({
      where: { taskId, kind: 'STAGE', status: 'AWAITING' },
      orderBy: { startedAt: 'desc' },
      select: { stageKey: true, attemptNumber: true },
    });
    if (!awaiting) {
      throw new AppError(
        'Task has no stage awaiting review',
        'INVALID_STATE',
        400
      );
    }

    const now = new Date();
    await this.prisma.taskEvent.create({
      data: {
        taskId,
        kind: 'REVIEW',
        stageKey: awaiting.stageKey,
        attemptNumber: awaiting.attemptNumber,
        status: 'COMPLETED',
        output: {
          action,
          feedback: feedback ?? null,
        } as Prisma.InputJsonValue,
        decidedBy: user.id,
        endedAt: now,
        durationMs: 0,
      },
    });

    const client = await createTemporalClient();
    const handle = client.workflow.getHandle(task.workflowId);
    await handle.signal('reviewDecision', {
      decisionType: 'binary',
      action: action as 'approve' | 'reject',
      feedback: feedback ?? undefined,
    });

    return this.prisma.task.findUniqueOrThrow({
      ...query,
      where: { id: taskId },
    });
  }
}
