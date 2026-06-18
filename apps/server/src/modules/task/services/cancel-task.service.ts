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
 * Sends a cancel signal to the workflow. Final status (CANCELLED + error)
 * is written by the workflow's cancellation branch via updateTaskActivity,
 * which fires the pg_notify trigger and pushes the new state to the
 * subscription. The service itself never mutates Task — workflow is the
 * sole writer of state.
 */
export class CancelTaskService {
  constructor(private prisma: PrismaClient) {}

  async execute(query: TaskQuery, taskId: string, user: User | null) {
    if (!user) {
      throw new UnauthorizedError();
    }

    const task = await this.prisma.task.findFirst({
      where: { id: taskId, userId: user.id },
    });

    if (!task) {
      throw new NotFoundError('Task', taskId);
    }

    if (
      task.status === 'COMPLETED' ||
      task.status === 'FAILED' ||
      task.status === 'CANCELLED'
    ) {
      throw new AppError(
        `Task is already ${task.status.toLowerCase()}`,
        'INVALID_STATE',
        400
      );
    }

    if (task.workflowId) {
      const client = await createTemporalClient();
      const handle = client.workflow.getHandle(task.workflowId);
      try {
        await handle.cancel();
      } catch {
        // Workflow may already be finished; nothing to do — workflow's
        // catch block (if it ran) has already set the terminal state.
      }
    }

    return this.prisma.task.findUniqueOrThrow({
      ...query,
      where: { id: taskId },
    });
  }
}
