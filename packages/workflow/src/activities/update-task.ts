import { Prisma, prisma } from '@codewright/database';
import {
  isStageEventTerminal,
  isTaskTerminal,
  type TaskEventStatus,
  type TaskStageKey,
  type TaskStatus,
} from '@codewright/domain';
import { log } from '../logger.js';

export interface UpdateTaskInput {
  taskId: string;
  /** Optional task-level update (status / error). */
  task?: {
    status?: TaskStatus;
    error?: string;
  };
  /** Optional: insert a new STAGE event in RUNNING. */
  startStage?: {
    stageKey: TaskStageKey;
    /** Self-contained inputs for this attempt (feedback, oracle, ...). */
    input?: unknown;
  };
  /** Optional: mutate an existing STAGE event. */
  updateStage?: {
    eventId: string;
    status: TaskEventStatus;
    output?: unknown;
    error?: string;
  };
}

export interface UpdateTaskResult {
  /** Present when `startStage` was supplied. */
  startedStage?: { eventId: string; attemptNumber: number };
}

/**
 * Unified writer for task + stage event state. All three optional pieces
 * (`task`, `startStage`, `updateStage`) execute inside one prisma
 * transaction so we never get a half-applied transition.
 *
 * Lifecycle stamps are automatic:
 *   - First Task → RUNNING stamps `Task.startedAt`
 *   - First Task → terminal stamps `Task.completedAt`
 *   - Stage → terminal stamps `TaskEvent.endedAt` + `durationMs`
 *
 * The pg_notify triggers on `task` / `task_event` fire on UPDATE/INSERT,
 * so the GraphQL subscription picks up the new state without explicit
 * publishing.
 *
 * `startStage` computes `attemptNumber` from `MAX(attemptNumber)+1` for
 * the same `(taskId, stageKey, kind=STAGE)` — single place that bumps the
 * counter, so workflow retries naturally produce 1, 2, 3.
 */
export async function updateTaskActivity(
  input: UpdateTaskInput
): Promise<UpdateTaskResult> {
  const { taskId, task, startStage, updateStage } = input;
  log.info(
    {
      taskId,
      hasTask: !!task,
      startStage: startStage?.stageKey,
      updateStageStatus: updateStage?.status,
    },
    'Task transition'
  );

  return prisma.$transaction(async (tx) => {
    const result: UpdateTaskResult = {};

    if (startStage) {
      const last = await tx.taskEvent.findFirst({
        where: { taskId, kind: 'STAGE', stageKey: startStage.stageKey },
        orderBy: { attemptNumber: 'desc' },
        select: { attemptNumber: true },
      });
      const attemptNumber = (last?.attemptNumber ?? 0) + 1;
      const row = await tx.taskEvent.create({
        data: {
          taskId,
          kind: 'STAGE',
          stageKey: startStage.stageKey,
          attemptNumber,
          status: 'RUNNING',
          input:
            startStage.input !== undefined
              ? (startStage.input as Prisma.InputJsonValue)
              : Prisma.DbNull,
        },
        select: { id: true, attemptNumber: true },
      });
      result.startedStage = {
        eventId: row.id,
        attemptNumber: row.attemptNumber,
      };
    }

    if (updateStage) {
      const data: Prisma.TaskEventUpdateInput = { status: updateStage.status };
      if (updateStage.output !== undefined) {
        data.output = updateStage.output as Prisma.InputJsonValue;
      }
      if (updateStage.error !== undefined) {
        data.error = updateStage.error;
      }
      if (isStageEventTerminal(updateStage.status)) {
        const existing = await tx.taskEvent.findUniqueOrThrow({
          where: { id: updateStage.eventId },
          select: { startedAt: true },
        });
        const endedAt = new Date();
        data.endedAt = endedAt;
        data.durationMs = endedAt.getTime() - existing.startedAt.getTime();
      }
      await tx.taskEvent.update({
        where: { id: updateStage.eventId },
        data,
      });
    }

    if (task) {
      const data: Prisma.TaskUpdateInput = {};
      if (task.status !== undefined) data.status = task.status;
      if (task.error !== undefined) data.error = task.error;

      if (task.status !== undefined) {
        const current = await tx.task.findUniqueOrThrow({
          where: { id: taskId },
          select: { startedAt: true, completedAt: true },
        });
        if (task.status === 'RUNNING' && current.startedAt === null) {
          data.startedAt = new Date();
        }
        if (isTaskTerminal(task.status) && current.completedAt === null) {
          data.completedAt = new Date();
        }
      }

      if (Object.keys(data).length > 0) {
        await tx.task.update({ where: { id: taskId }, data });
      }
    }

    return result;
  });
}
