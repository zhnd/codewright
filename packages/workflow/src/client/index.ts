import { Client, Connection } from '@temporalio/client';

// Re-export so external callers (server / CLI) can still do
// `import { TASK_QUEUE } from '@codewright/workflow'`. The actual definitions
// live in ../task-queues.ts so workflows can import them without pulling
// in @temporalio/client (which is disallowed in the workflow sandbox).
export { SANDBOX_TASK_QUEUE, TASK_QUEUE } from '../task-queues.js';

export async function createTemporalClient(): Promise<Client> {
  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
  });
  return new Client({ connection });
}
