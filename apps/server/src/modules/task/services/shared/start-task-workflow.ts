import type { Prisma, PrismaClient } from '@codewright/database';
import { createTemporalClient } from '@codewright/workflow';
import { AppError } from '../../../../infrastructure/errors/app-error.js';
import { log } from '../../../../logger.js';

type TemporalClient = Awaited<ReturnType<typeof createTemporalClient>>;

interface TaskQuery {
  include?: Prisma.TaskInclude;
  select?: Prisma.TaskSelect;
}

interface StartTaskWorkflowOptions {
  prisma: PrismaClient;
  /** Pothos query, spread into the final Prisma update for N+1 optimization. */
  query: TaskQuery;
  /** The (already-created, PENDING) task whose workflow we're starting. */
  taskId: string;
  /** Builds + starts the workflow against a fresh client; returns the handle. */
  start: (client: TemporalClient) => Promise<{ workflowId: string }>;
  /** Extra fields merged into the failure log line. */
  logFields?: Record<string, unknown>;
  /** Log message emitted on start failure. */
  logMessage?: string;
  /** Prefix for the persisted `Task.error` string. */
  taskErrorPrefix?: string;
  /** User-facing message thrown as `AppError` on failure. */
  userErrorMessage?: string;
}

/**
 * Start a Temporal workflow for a freshly-created task and persist its
 * workflow id, marking the task FAILED if the start throws. This start +
 * failure-write dance was duplicated verbatim across resolve-defect,
 * analyze-repository and retry-task; the only differences are the workflow
 * start call itself and the failure wording, both injected here.
 */
export async function startTaskWorkflow({
  prisma,
  query,
  taskId,
  start,
  logFields = {},
  logMessage = 'workflow start failed',
  taskErrorPrefix = 'Failed to start workflow',
  userErrorMessage = 'Could not start workflow — please retry shortly.',
}: StartTaskWorkflowOptions) {
  let workflowId: string;
  try {
    const client = await createTemporalClient();
    const handle = await start(client);
    workflowId = handle.workflowId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, taskId, ...logFields }, logMessage);
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'FAILED',
        error: `${taskErrorPrefix}: ${message}`,
      },
    });
    throw new AppError(userErrorMessage, 'WORKFLOW_START_FAILED', 503);
  }

  return prisma.task.update({
    ...query,
    where: { id: taskId },
    data: { workflowId },
  });
}
