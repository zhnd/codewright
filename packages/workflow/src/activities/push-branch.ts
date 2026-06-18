import { prisma } from '@codewright/database';
import { connectSandbox, type SandboxState } from '@codewright/sandbox';
import { log } from '../logger.js';
import { gitClientFor } from '../utils/git-context.js';

export async function pushBranchActivity(
  state: SandboxState,
  branch: string,
  options: { projectId?: string } = {}
): Promise<void> {
  log.info({ branch }, 'Pushing branch');

  const project = options.projectId
    ? await prisma.project.findUnique({
        where: { id: options.projectId },
      })
    : null;
  const client = project?.encryptedCredentials ? gitClientFor(project) : null;

  const sandbox = await connectSandbox(state, {
    gitToken: client?.token,
    gitProvider: client?.provider ?? 'github',
  });
  const result = await sandbox.exec(`git push origin ${branch}`, {
    timeoutMs: 120_000,
  });
  if (!result.success) {
    throw new Error(
      `git push failed (${result.exitCode}): ${result.stderr || result.stdout}`
    );
  }
  log.info({ branch }, 'Branch pushed');
}
