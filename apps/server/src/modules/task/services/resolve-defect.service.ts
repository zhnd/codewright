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

export interface ResolveDefectArgs {
  projectId: string;
  defectDescription: string;
  /** Optional caller-pinned base branch (e.g. from the Tapd trigger dialog). */
  baseBranch?: string;
  /** Tapd bug id the task originated from — stored on Task.input for audit. */
  tapdBugId?: string;
  /** Tapd workspace_id paired with tapdBugId. */
  tapdWorkspaceId?: string;
}

export class ResolveDefectService {
  constructor(private prisma: PrismaClient) {}

  async execute(query: TaskQuery, user: User | null, args: ResolveDefectArgs) {
    if (!user) {
      throw new UnauthorizedError();
    }

    const project = await this.prisma.project.findFirst({
      where: { id: args.projectId, userId: user.id },
    });

    if (!project) {
      throw new NotFoundError('Project', args.projectId);
    }

    // Credentials are not checked here — public repos can be analyzed without a token.
    // Push and PR creation activities will check for credentials when they need them.

    const taskInput: Prisma.InputJsonObject = {
      defectDescription: args.defectDescription,
      ...(args.baseBranch ? { baseBranch: args.baseBranch } : {}),
      ...(args.tapdBugId ? { tapdBugId: args.tapdBugId } : {}),
      ...(args.tapdWorkspaceId
        ? { tapdWorkspaceId: args.tapdWorkspaceId }
        : {}),
    };

    const triggerSource = args.tapdBugId ? 'tapd' : 'manual';

    const task = await this.prisma.task.create({
      ...query,
      data: {
        type: 'RESOLVE_DEFECT',
        status: 'PENDING',
        input: taskInput,
        triggerSource,
        userId: user.id,
        projectId: project.id,
      },
    });

    return startTaskWorkflow({
      prisma: this.prisma,
      query,
      taskId: task.id,
      logFields: { taskType: 'RESOLVE_DEFECT' },
      start: (client) =>
        client.workflow.start('resolveDefectWorkflow', {
          taskQueue: TASK_QUEUE,
          workflowId: `resolve-defect-${task.id}`,
          args: [
            {
              taskId: task.id,
              projectId: project.id,
              repositoryUrl: project.repositoryUrl,
              defectDescription: args.defectDescription,
              userId: user.id,
              ...(args.baseBranch ? { baseBranch: args.baseBranch } : {}),
            },
          ],
        }),
    });
  }
}
