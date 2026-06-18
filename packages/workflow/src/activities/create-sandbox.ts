import { prisma } from '@codewright/database';
import { defaultBotIdentity } from '@codewright/githost';
import { createSandbox, type SandboxState } from '@codewright/sandbox';
import { log } from '../logger.js';
import { gitClientFor } from '../utils/git-context.js';
import { npmrcFor } from '../utils/project-secrets.js';

export interface CreateSandboxActivityOptions {
  /** Override the container image. When set, bypasses the repo cache. */
  image?: string;
  projectId?: string;
  branch?: string;
  /** Check out this exact commit after fetch/clone (e.g. SWE-bench base_commit). */
  commit?: string;
  newBranch?: string;
}

export async function createSandboxActivity(
  repoUrl: string,
  options: CreateSandboxActivityOptions = {}
): Promise<SandboxState> {
  log.info({ repoUrl, branch: options.branch }, 'Creating sandbox');

  const project = options.projectId
    ? await prisma.project.findUniqueOrThrow({
        where: { id: options.projectId },
      })
    : null;
  const client = project?.encryptedCredentials ? gitClientFor(project) : null;

  const gitProvider = client?.provider ?? 'github';
  const gitToken = client?.token;
  const gitUser = client?.botIdentity ?? defaultBotIdentity('github');
  const npmrc = project ? (npmrcFor(project) ?? undefined) : undefined;

  const sandbox = await createSandbox({
    provider: 'docker',
    source: {
      repo: repoUrl,
      token: gitToken,
      provider: gitProvider,
      branch: options.branch,
      commit: options.commit,
      newBranch: options.newBranch,
    },
    gitUser,
    gitToken,
    gitProvider,
    npmrc,
    docker: {
      image: options.image,
    },
  });
  const state = sandbox.getState();
  log.info({ containerId: state.containerId }, 'Sandbox created');
  return state;
}
