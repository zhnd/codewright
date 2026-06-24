import type { Prisma, PrismaClient } from '@codewright/database';
import { TASK_QUEUE } from '@codewright/workflow';
import type { User } from 'better-auth';
import {
  NotFoundError,
  UnauthorizedError,
} from '../../../infrastructure/errors/app-error.js';
import { startTaskWorkflow } from './shared/start-task-workflow.js';

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

    return startTaskWorkflow({
      prisma: this.prisma,
      query,
      taskId: task.id,
      logFields: { taskType: 'ANALYZE_REPOSITORY' },
      start: (client) =>
        client.workflow.start('analyzeRepositoryWorkflow', {
          taskQueue: TASK_QUEUE,
          workflowId: `analyze-${task.id}`,
          args: [
            {
              taskId: task.id,
              projectId: project.id,
              repositoryUrl: project.repositoryUrl,
            },
          ],
        }),
    });
  }
}
