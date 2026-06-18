import { fileURLToPath } from 'node:url';
import { cleanupOrphanBuilders, pruneStaleImages } from '@codewright/sandbox';
import { SANDBOX_TASK_QUEUE, TASK_QUEUE } from '@codewright/workflow';
import * as activities from '@codewright/workflow/activities';
import { NativeConnection, Worker } from '@temporalio/worker';
import { log } from './logger.js';

const SANDBOX_CONCURRENCY = parseIntEnv('SANDBOX_CONCURRENCY', 4);
const MAIN_CONCURRENCY = parseIntEnv('WORKER_CONCURRENCY', 40);
const PRUNE_INTERVAL_MS = parseIntEnv(
  'CODEWRIGHT_IMAGE_PRUNE_INTERVAL_MS',
  24 * 60 * 60 * 1000
);

log.info(
  {
    databaseUrl: process.env.DATABASE_URL ? 'set' : 'NOT SET',
    temporalAddress: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233 (default)',
    activities: Object.keys(activities),
    mainConcurrency: MAIN_CONCURRENCY,
    sandboxConcurrency: SANDBOX_CONCURRENCY,
  },
  'Worker starting'
);

async function main() {
  // Clean up any builder containers left over from a previous crash before
  // opening for business — otherwise they'd slowly pile up.
  try {
    await cleanupOrphanBuilders();
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Orphan builder cleanup failed'
    );
  }

  const pruneTimer = setInterval(async () => {
    try {
      const result = await pruneStaleImages();
      if (result.deleted.length) {
        log.info({ deleted: result.deleted }, 'Pruned stale repo images');
      }
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Image prune failed'
      );
    }
  }, PRUNE_INTERVAL_MS);
  pruneTimer.unref();

  const connection = await NativeConnection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
  });

  // Main worker: workflows + lightweight activities (DB / GitHub API).
  const mainWorker = await Worker.create({
    connection,
    namespace: 'default',
    taskQueue: TASK_QUEUE,
    workflowsPath: fileURLToPath(
      import.meta.resolve('@codewright/workflow/workflows')
    ),
    activities,
    maxConcurrentActivityTaskExecutions: MAIN_CONCURRENCY,
    maxConcurrentWorkflowTaskExecutions: MAIN_CONCURRENCY,
  });

  // Sandbox worker: container-touching activities only. SANDBOX_CONCURRENCY
  // caps concurrent Docker work so the host stays healthy; overflow queues
  // at the Temporal server until a slot frees.
  const sandboxWorker = await Worker.create({
    connection,
    namespace: 'default',
    taskQueue: SANDBOX_TASK_QUEUE,
    activities,
    maxConcurrentActivityTaskExecutions: SANDBOX_CONCURRENCY,
  });

  log.info(
    {
      mainQueue: TASK_QUEUE,
      sandboxQueue: SANDBOX_TASK_QUEUE,
    },
    'Workers started, listening'
  );

  await Promise.all([mainWorker.run(), sandboxWorker.run()]);
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

main().catch((err) => {
  log.fatal({ err }, 'Worker failed to start');
  process.exit(1);
});
