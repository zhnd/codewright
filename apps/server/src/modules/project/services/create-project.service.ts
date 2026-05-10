import type { AuthProvider, Prisma, PrismaClient } from '@torin/database';
import { parseRepoUrl } from '@torin/githost';
import { encrypt, getEncryptionKey } from '@torin/shared';
import type { User } from 'better-auth';
import {
  UnauthorizedError,
  ValidationError,
} from '../../../infrastructure/errors/app-error.js';
import type { CreateProjectInput } from '../dto/create-project.input.js';

interface ProjectQuery {
  include?: Prisma.ProjectInclude;
  select?: Prisma.ProjectSelect;
}

const PROVIDER_TO_PRISMA: Record<'github' | 'cnb', AuthProvider> = {
  github: 'GITHUB',
  cnb: 'CNB',
};

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

    // Verify the URL host matches the selected provider so workflows don't
    // fail later with confusing 404s from the wrong API.
    let parsed: ReturnType<typeof parseRepoUrl>;
    try {
      parsed = parseRepoUrl(input.repositoryUrl);
    } catch (err) {
      throw new ValidationError(
        err instanceof Error ? err.message : 'Invalid repository URL'
      );
    }
    const expected = PROVIDER_TO_PRISMA[parsed.provider];
    if (expected !== authProvider) {
      throw new ValidationError(
        `Repository URL host (${parsed.host}) does not match selected authProvider (${authProvider})`
      );
    }

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
