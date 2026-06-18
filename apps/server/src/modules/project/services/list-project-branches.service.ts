import type { PrismaClient } from '@codewright/database';
import { createGitClient, mapAuthProvider } from '@codewright/githost';
import { decrypt, getEncryptionKey } from '@codewright/shared';
import type { User } from 'better-auth';
import {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../../infrastructure/errors/app-error.js';
import { log } from '../../../logger.js';

/**
 * Read the project's git host for the list of branch names. Used by
 * the Tapd trigger dialog (and any future "pick a branch" UI). Mirrors
 * the encryption + provider mapping that `@codewright/workflow`'s
 * `gitClientFor` does at activity time — kept inline here so the
 * server doesn't have to depend on workflow internals.
 */
export class ListProjectBranchesService {
  constructor(private prisma: PrismaClient) {}

  async execute(projectId: string, user: User | null): Promise<string[]> {
    if (!user) throw new UnauthorizedError();

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId: user.id },
    });
    if (!project) throw new NotFoundError('Project', projectId);

    if (!project.encryptedCredentials) {
      throw new ValidationError(
        'Project has no credentials configured — add a token in project settings before listing branches.'
      );
    }

    const client = createGitClient({
      provider: mapAuthProvider(project.authProvider),
      repositoryUrl: project.repositoryUrl,
      token: decrypt(project.encryptedCredentials, getEncryptionKey()),
    });

    try {
      return await client.listBranches();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(
        { err, projectId, provider: project.authProvider },
        'list branches failed'
      );
      throw new AppError(
        `Could not list branches: ${message}`,
        'GIT_HOST_ERROR',
        502
      );
    }
  }
}
