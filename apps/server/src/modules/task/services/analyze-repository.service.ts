import type { Prisma, PrismaClient } from '@codewright/database';
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

export class AnalyzeRepositoryService {
  constructor(private prisma: PrismaClient) {}

  async execute(query: TaskQuery, projectId: string, user: User | null) {
    if (!user) {
      throw new UnauthorizedError();
    }

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId: user.id },
    });

    if (!project) {
      throw new NotFoundError('Project', projectId);
    }

    const task = await this.prisma.task.create({
      ...query,
      data: {
        type: 'ANALYZE_REPOSITORY',
        status: 'PENDING',
        input: { repositoryUrl: project.repositoryUrl },
        userId: user.id,
        projectId: project.id,
      },
    });

    let workflowId: string;
    try {
      const client = await createTemporalClient();
      const handle = await client.workflow.start('analyzeRepositoryWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId: `analyze-${task.id}`,
        args: [
          {
            taskId: task.id,
            projectId: project.id,
            repositoryUrl: project.repositoryUrl,
          },
        ],
      });
      workflowId = handle.workflowId;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(
        { err, taskId: task.id, taskType: 'ANALYZE_REPOSITORY' },
        'workflow start failed'
      );
      await this.prisma.task.update({
        where: { id: task.id },
        data: {
          status: 'FAILED',
          error: `Failed to start workflow: ${message}`,
        },
      });
      throw new AppError(
        'Could not start workflow — please retry shortly.',
        'WORKFLOW_START_FAILED',
        503
      );
    }

    return this.prisma.task.update({
      ...query,
      where: { id: task.id },
      data: { workflowId },
    });
  }
}
