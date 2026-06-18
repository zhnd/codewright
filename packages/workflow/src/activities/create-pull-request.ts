import { prisma } from '@codewright/database';
import type { PullRequestResult } from '@codewright/domain';
import { log } from '../logger.js';
import { gitClientFor } from '../utils/git-context.js';

export async function createPullRequestActivity(
  projectId: string,
  head: string,
  base: string,
  title: string,
  body: string
): Promise<PullRequestResult> {
  log.info({ projectId, head, base }, 'Creating pull request');

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
  });
  const client = gitClientFor(project);
  const result = await client.createPullRequest({ head, base, title, body });

  log.info(
    { prUrl: result.url, prNumber: result.number, provider: client.provider },
    'Pull request created'
  );
  return result;
}
