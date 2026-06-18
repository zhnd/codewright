import { prisma } from '@codewright/database';
import type { FileChange } from '@codewright/domain';
import { log } from '../logger.js';
import { gitClientFor } from '../utils/git-context.js';

export async function addPrReviewCommentsActivity(
  projectId: string,
  pullNumber: number,
  changes: FileChange[]
): Promise<void> {
  log.info(
    { projectId, pullNumber, fileCount: changes.length },
    'Adding PR review comments'
  );

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
  });
  if (!project.encryptedCredentials) {
    log.warn('No credentials — skipping PR review comments');
    return;
  }

  const client = gitClientFor(project);
  await client.addReviewComments({ pullNumber, changes });
  log.info({ provider: client.provider }, 'PR review comments submitted');
}
