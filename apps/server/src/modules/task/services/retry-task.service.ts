import type { Prisma, PrismaClient, TaskType } from '@codewright/database';
import { createTemporalClient, TASK_QUEUE } from '@codewright/workflow';
import type { User } from 'better-auth';
import {
  AppError,
  NotFoundError,
  UnauthorizedError,
} from '../../../infrastructure/errors/app-error.js';
import { log } from '../../../logger.js';

interface TaskQuery {
  include?: Prisma.TaskInclude;
  select?: Prisma.TaskSelect;
}

/**
 * Retry a failed task by spawning a fresh task row with the same input
 * and starting a new workflow. The original task is left in place as
 * the failure audit trail — never mutated.
 *
 * Why a new task rather than resetting the original to PENDING:
 *  - workflow IDs are derived from task ID (`resolve-defect-{id}`) and
 *    must be unique, so reuse forces a new ID anyway
 *  - the original's events / agent invocations are useful as the "what
 *    went wrong" history; nuking them defeats observability
 *  - users intuitively understand "retry = new attempt", which we want
 *    to surface as a separate row in their task list
 */
export class RetryTaskService {
  constructor(private prisma: PrismaClient) {}

  async execute(query: TaskQuery, taskId: string, user: User | null) {
    if (!user) {
      throw new UnauthorizedError();
    }

    const original = await this.prisma.task.findFirst({
      where: { id: taskId, userId: user.id },
      include: { project: true },
    });

    if (!original) {
      throw new NotFoundError('Task', taskId);
    }

    if (original.status !== 'FAILED' && original.status !== 'CANCELLED') {
      throw new AppError(
        `Task is ${original.status.toLowerCase()}; only failed/cancelled tasks can be retried`,
        'INVALID_STATE',
        400
      );
    }

    const project = original.project;
    if (!project) {
      throw new AppError(
        'Original task has no project; cannot retry',
        'INVALID_STATE',
        400
      );
    }

    const newTask = await this.prisma.task.create({
      ...query,
      data: {
        type: original.type,
        status: 'PENDING',
        input: original.input as Prisma.InputJsonValue,
        triggerSource: 'retry',
        userId: user.id,
        projectId: project.id,
      },
    });

    let workflowId: string;
    try {
      const client = await createTemporalClient();
      const handle = await this.startWorkflow(
        client,
        newTask.id,
        original.type,
        original.input,
        project,
        user.id
      );
      workflowId = handle.workflowId;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(
        { err, taskId: newTask.id, retryOf: taskId },
        'workflow start failed during retry'
      );
      await this.prisma.task.update({
        where: { id: newTask.id },
        data: {
          status: 'FAILED',
          error: `Failed to start retry workflow: ${message}`,
        },
      });
      throw new AppError(
        'Could not start retry workflow — please try again shortly.',
        'WORKFLOW_START_FAILED',
        503
      );
    }

    return this.prisma.task.update({
      ...query,
      where: { id: newTask.id },
      data: { workflowId },
    });
  }

  private async startWorkflow(
    client: Awaited<ReturnType<typeof createTemporalClient>>,
    newTaskId: string,
    type: TaskType,
    input: Prisma.JsonValue,
    project: { id: string; repositoryUrl: string },
    userId: string
  ) {
    if (type === 'RESOLVE_DEFECT') {
      const inp = input as { defectDescription?: string };
      return client.workflow.start('resolveDefectWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId: `resolve-defect-${newTaskId}`,
        args: [
          {
            taskId: newTaskId,
            projectId: project.id,
            repositoryUrl: project.repositoryUrl,
            defectDescription: inp.defectDescription ?? '',
            userId,
          },
        ],
      });
    }
    if (type === 'ANALYZE_REPOSITORY') {
      return client.workflow.start('analyzeRepositoryWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId: `analyze-${newTaskId}`,
        args: [
          {
            taskId: newTaskId,
            projectId: project.id,
            repositoryUrl: project.repositoryUrl,
          },
        ],
      });
    }
    throw new AppError(`Unsupported task type: ${type}`, 'INVALID_STATE', 400);
  }
}
