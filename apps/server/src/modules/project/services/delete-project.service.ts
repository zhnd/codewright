import type { PrismaClient } from '@codewright/database';
import type { User } from 'better-auth';
import {
  NotFoundError,
  UnauthorizedError,
} from '../../../infrastructure/errors/app-error.js';

export class DeleteProjectService {
  constructor(private prisma: PrismaClient) {}

  async execute(projectId: string, user: User | null): Promise<boolean> {
    if (!user) {
      throw new UnauthorizedError();
    }

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId: user.id },
    });

    if (!project) {
      throw new NotFoundError('Project', projectId);
    }

    await this.prisma.project.delete({ where: { id: projectId } });
    return true;
  }
}
