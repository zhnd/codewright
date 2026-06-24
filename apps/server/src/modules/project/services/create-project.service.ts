import type { AuthProvider, Prisma, PrismaClient } from '@codewright/database';
import { encrypt, getEncryptionKey } from '@codewright/shared';
import type { User } from 'better-auth';
import { UnauthorizedError } from '../../../infrastructure/errors/app-error.js';
import type { CreateProjectInput } from '../dto/create-project.input.js';
import { assertRepoUrlMatchesProvider } from './shared/repo-url.js';

interface ProjectQuery {
  include?: Prisma.ProjectInclude;
  select?: Prisma.ProjectSelect;
}

export class CreateProjectService {
  constructor(private prisma: PrismaClient) {}

  async execute(
    query: ProjectQuery,
    input: typeof CreateProjectInput.$inferInput,
    user: User | null
  ) {
    if (!user) {
      throw new UnauthorizedError();
    }

    const authProvider: AuthProvider = input.authProvider ?? 'GITHUB';

    assertRepoUrlMatchesProvider(input.repositoryUrl, authProvider);

    const data: Prisma.ProjectCreateInput = {
      name: input.name,
      repositoryUrl: input.repositoryUrl,
      authProvider,
      user: { connect: { id: user.id } },
      ...(input.previewCommand ? { previewCommand: input.previewCommand } : {}),
      ...(input.previewPort != null ? { previewPort: input.previewPort } : {}),
      ...(input.previewReadyPattern
        ? { previewReadyPattern: input.previewReadyPattern }
        : {}),
    };

    if (input.credentials) {
      data.authMethod = 'TOKEN';
      data.encryptedCredentials = encrypt(
        input.credentials,
        getEncryptionKey()
      );
    }

    if (input.npmrc) {
      data.workflowConfig = {
        secrets: { npmrc: encrypt(input.npmrc, getEncryptionKey()) },
      };
    }

    return this.prisma.project.create({ ...query, data });
  }
}
