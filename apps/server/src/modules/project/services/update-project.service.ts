import type { AuthProvider, Prisma, PrismaClient } from '@codewright/database';
import { encrypt, getEncryptionKey } from '@codewright/shared';
import type { User } from 'better-auth';
import {
  NotFoundError,
  UnauthorizedError,
} from '../../../infrastructure/errors/app-error.js';
import type { UpdateProjectInput } from '../dto/update-project.input.js';
import { assertRepoUrlMatchesProvider } from './shared/repo-url.js';

interface ProjectQuery {
  include?: Prisma.ProjectInclude;
  select?: Prisma.ProjectSelect;
}

export class UpdateProjectService {
  constructor(private prisma: PrismaClient) {}

  async execute(
    query: ProjectQuery,
    input: typeof UpdateProjectInput.$inferInput,
    user: User | null
  ) {
    if (!user) {
      throw new UnauthorizedError();
    }

    const project = await this.prisma.project.findFirst({
      where: { id: input.id, userId: user.id },
    });

    if (!project) {
      throw new NotFoundError('Project', input.id);
    }

    const data: Prisma.ProjectUpdateInput = {
      ...(input.name != null && { name: input.name }),
      ...(input.repositoryUrl != null && {
        repositoryUrl: input.repositoryUrl,
      }),
      ...(input.authProvider != null && { authProvider: input.authProvider }),
      ...(input.previewCommand !== undefined && {
        previewCommand: input.previewCommand,
      }),
      ...(input.previewPort !== undefined && {
        previewPort: input.previewPort,
      }),
      ...(input.previewReadyPattern !== undefined && {
        previewReadyPattern: input.previewReadyPattern,
      }),
    };

    // If either the URL or provider changes, re-validate they agree.
    const finalUrl = input.repositoryUrl ?? project.repositoryUrl;
    const finalProvider: AuthProvider =
      input.authProvider ?? project.authProvider;
    if (input.repositoryUrl != null || input.authProvider != null) {
      assertRepoUrlMatchesProvider(finalUrl, finalProvider);
    }

    if (input.credentials) {
      data.authMethod = 'TOKEN';
      data.encryptedCredentials = encrypt(
        input.credentials,
        getEncryptionKey()
      );
    }

    if (input.npmrc !== undefined && input.npmrc !== null) {
      const existing =
        (project.workflowConfig as {
          secrets?: Record<string, string>;
          [k: string]: unknown;
        } | null) ?? {};
      const nextSecrets: Record<string, string> = {
        ...(existing.secrets ?? {}),
      };
      if (input.npmrc === '') {
        delete nextSecrets.npmrc;
      } else {
        nextSecrets.npmrc = encrypt(input.npmrc, getEncryptionKey());
      }
      const { secrets: _omit, ...rest } = existing;
      void _omit;
      const merged: Record<string, unknown> = { ...rest };
      if (Object.keys(nextSecrets).length > 0) {
        merged.secrets = nextSecrets;
      }
      data.workflowConfig = merged as Prisma.InputJsonValue;
    }

    return this.prisma.project.update({
      ...query,
      where: { id: input.id },
      data,
    });
  }
}
