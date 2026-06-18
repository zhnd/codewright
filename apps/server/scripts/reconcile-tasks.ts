/**
 * Reconcile orphaned tasks against Temporal.
 *
 * The workflow is the sole writer of Task status: a graceful `cancel`
 * delivers a CancellationFailure that the workflow's catch branch turns
 * into CANCELLED. But a hard `terminate` (or a worker crash / host
 * restart) kills the workflow without running that branch, so the Task is
 * stranded at RUNNING forever and the dashboard keeps showing "executing".
 *
 * This is the manual janitor for that case: for every non-terminal Task,
 * ask Temporal for the real workflow status and flip the DB to a terminal
 * status when the workflow is no longer running. The Task UPDATE fires the
 * pg_notify trigger, so the dashboard refreshes on its own.
 *
 * Usage (from apps/server):
 *   pnpm reconcile-tasks          # dry run — prints what would change
 *   pnpm reconcile-tasks --apply  # write the changes
 *
 * Note: this does NOT tear down leaked sandbox containers a terminated
 * workflow left behind — remove those with `docker rm -f <name>`.
 */
import { prisma, type TaskStatus } from '@codewright/database';
import { createTemporalClient } from '@codewright/workflow';

const NON_TERMINAL: TaskStatus[] = ['PENDING', 'RUNNING'];
const apply = process.argv.includes('--apply');

async function main(): Promise<void> {
  const tasks = await prisma.task.findMany({
    where: { status: { in: NON_TERMINAL } },
    select: { id: true, status: true, workflowId: true },
  });
  console.log(`Found ${tasks.length} non-terminal task(s).`);
  if (tasks.length === 0) return;

  const client = await createTemporalClient();
  let changed = 0;

  for (const t of tasks) {
    if (!t.workflowId) {
      console.log(`${t.id}  ${t.status}  (no workflowId) → FAILED`);
      if (apply) {
        await prisma.task.update({
          where: { id: t.id },
          data: { status: 'FAILED', error: 'No workflow associated' },
        });
      }
      changed++;
      continue;
    }

    let wfStatus = 'UNKNOWN';
    try {
      const desc = await client.workflow.getHandle(t.workflowId).describe();
      wfStatus = desc.status.name;
    } catch (err) {
      wfStatus = `NOT_FOUND (${err instanceof Error ? err.message.slice(0, 60) : err})`;
    }

    if (wfStatus === 'RUNNING') {
      console.log(`${t.id}  ${t.status}  wf=RUNNING → leave alone`);
      continue;
    }

    // Workflow is gone/terminal but DB still says non-terminal → orphan.
    const newStatus: TaskStatus =
      wfStatus === 'COMPLETED'
        ? 'COMPLETED'
        : wfStatus === 'CANCELED'
          ? 'CANCELLED'
          : 'FAILED';
    console.log(
      `${t.id}  ${t.status}  wf=${wfStatus} → ${newStatus}${apply ? ' (applied)' : ' (dry-run)'}`
    );
    if (apply) {
      await prisma.task.update({
        where: { id: t.id },
        data: { status: newStatus, error: `Reconciled: workflow ${wfStatus}` },
      });
    }
    changed++;
  }

  console.log(
    apply
      ? `\nReconciled ${changed} task(s).`
      : `\n${changed} task(s) would change. Re-run with --apply to write.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
