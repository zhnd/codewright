import type { PrismaClient } from '@codewright/database';
import {
  CANONICAL_STAGE_ORDER,
  type TaskEventKind,
  type TaskEventStatus,
  type TaskStageKey,
} from '@codewright/domain';

// Per-field batch loaders for the derived stage view exposed on Task.
// Each public load function takes a batch of taskIds (DataLoader-style)
// and returns one result per id in the same order, so a list query like
// `tasks { currentStageKey awaiting }` produces O(1) Prisma queries
// regardless of result count.
//
// "Loader" follows the GraphQL ecosystem convention; with @pothos/plugin-
// dataloader these functions plug straight into `t.loadable({ load })`.

// ── Shapes (exported, schema needs them for objectRef<>) ─────────────

export interface ReviewShape {
  action: string;
  feedback: string | null;
  decidedBy: string | null;
  decidedAt: Date;
}

export interface AttemptShape {
  attemptNumber: number;
  status: TaskEventStatus;
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: Date;
  endedAt: Date | null;
  durationMs: number | null;
  /** HITL review for this attempt, null when none. */
  review: ReviewShape | null;
}

export interface StageViewShape {
  key: TaskStageKey;
  status: TaskEventStatus | 'PENDING';
  attempts: AttemptShape[];
}

export interface AwaitingShape {
  stageKey: TaskStageKey;
  attemptNumber: number;
}

// ── Module-private fold helpers ─────────────────────────────────────

interface RawEvent {
  kind: TaskEventKind;
  stageKey: TaskStageKey;
  attemptNumber: number;
  status: TaskEventStatus;
  input: unknown;
  output: unknown;
  error: string | null;
  decidedBy: string | null;
  startedAt: Date;
  endedAt: Date | null;
  durationMs: number | null;
}

/**
 * Group raw task_event rows by stage, pair STAGE rows with their REVIEW
 * row by attemptNumber, and emit one StageView per canonical pipeline
 * stage (missing stages get an empty PENDING placeholder).
 */
function foldEventsToStages(events: RawEvent[]): StageViewShape[] {
  const buckets = new Map<TaskStageKey, RawEvent[]>();
  for (const e of events) {
    const bucket = buckets.get(e.stageKey);
    if (bucket) bucket.push(e);
    else buckets.set(e.stageKey, [e]);
  }

  return CANONICAL_STAGE_ORDER.map((key) => {
    const rows = buckets.get(key) ?? [];
    const reviewByAttempt = new Map<number, ReviewShape>();
    for (const r of rows) {
      if (r.kind !== 'REVIEW') continue;
      const out = (r.output ?? {}) as { action?: string; feedback?: string };
      reviewByAttempt.set(r.attemptNumber, {
        action: out.action ?? 'unknown',
        feedback: out.feedback ?? null,
        decidedBy: r.decidedBy,
        decidedAt: r.startedAt,
      });
    }
    const attempts: AttemptShape[] = rows
      .filter((r) => r.kind === 'STAGE')
      .map((r) => ({
        attemptNumber: r.attemptNumber,
        status: r.status,
        input: r.input,
        output: r.output,
        error: r.error,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        durationMs: r.durationMs,
        review: reviewByAttempt.get(r.attemptNumber) ?? null,
      }));
    const status: TaskEventStatus | 'PENDING' =
      attempts.at(-1)?.status ?? 'PENDING';
    return { key, status, attempts };
  });
}

/** First stage with status ∈ {AWAITING, RUNNING}; else most-recent terminal. */
function pickFocalStage(events: RawEvent[]): TaskStageKey | null {
  const latestPerStage = new Map<TaskStageKey, RawEvent>();
  for (const e of events) {
    const cur = latestPerStage.get(e.stageKey);
    if (!cur || e.attemptNumber > cur.attemptNumber) {
      latestPerStage.set(e.stageKey, e);
    }
  }
  for (const key of CANONICAL_STAGE_ORDER) {
    const e = latestPerStage.get(key);
    if (!e) continue;
    if (e.status === 'AWAITING' || e.status === 'RUNNING') return key;
  }
  let last: { key: TaskStageKey; ts: Date } | null = null;
  for (const [key, e] of latestPerStage.entries()) {
    if (!last || e.startedAt > last.ts) {
      last = { key, ts: e.startedAt };
    }
  }
  return last?.key ?? null;
}

/** Group rows by their `taskId` field. */
function groupByTaskId<T extends { taskId: string }>(
  rows: T[]
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const arr = out.get(r.taskId);
    if (arr) arr.push(r);
    else out.set(r.taskId, [r]);
  }
  return out;
}

// ── Batch loaders (plug into t.loadable({ load })) ──────────────────
//
// Each takes an ordered list of taskIds and MUST return an array of the
// same length where index i corresponds to taskIds[i]. Pothos's dataloader
// plugin enforces this contract; missing keys should map to a sentinel
// value (empty array / null) so the resolver returns gracefully.

/** Stages with attempts + reviews per stage, batched by taskId. */
export async function loadStageView(
  taskIds: readonly string[],
  prisma: PrismaClient
): Promise<StageViewShape[][]> {
  const events = await prisma.taskEvent.findMany({
    where: { taskId: { in: [...taskIds] } },
    orderBy: [
      { taskId: 'asc' },
      { stageKey: 'asc' },
      { attemptNumber: 'asc' },
      { kind: 'asc' },
    ],
  });
  const byTask = groupByTaskId(events);
  return taskIds.map((id) => foldEventsToStages(byTask.get(id) ?? []));
}

/** Focal stage key (or null), batched by taskId. */
export async function loadCurrentStageKey(
  taskIds: readonly string[],
  prisma: PrismaClient
): Promise<(TaskStageKey | null)[]> {
  const events = await prisma.taskEvent.findMany({
    where: { taskId: { in: [...taskIds] }, kind: 'STAGE' },
    orderBy: [{ taskId: 'asc' }, { stageKey: 'asc' }, { attemptNumber: 'asc' }],
  });
  const byTask = groupByTaskId(events);
  return taskIds.map((id) => pickFocalStage(byTask.get(id) ?? []));
}

/** Sum of STAGE-event agent cost per task (0 when none), batched by taskId. */
export async function loadTotalCost(
  taskIds: readonly string[],
  prisma: PrismaClient
): Promise<number[]> {
  const grouped = await prisma.taskEvent.groupBy({
    by: ['taskId'],
    where: { taskId: { in: [...taskIds] }, kind: 'STAGE' },
    _sum: { costUsd: true },
  });
  const byTask = new Map(grouped.map((g) => [g.taskId, g._sum.costUsd ?? 0]));
  return taskIds.map((id) => byTask.get(id) ?? 0);
}

/** Awaiting gate descriptor (or null), batched by taskId. */
export async function loadAwaiting(
  taskIds: readonly string[],
  prisma: PrismaClient
): Promise<(AwaitingShape | null)[]> {
  const events = await prisma.taskEvent.findMany({
    where: {
      taskId: { in: [...taskIds] },
      kind: 'STAGE',
      status: 'AWAITING',
    },
    orderBy: { startedAt: 'desc' },
    select: { taskId: true, stageKey: true, attemptNumber: true },
  });
  // First match per taskId wins (rows already sorted desc by startedAt).
  const byTask = new Map<string, AwaitingShape>();
  for (const e of events) {
    if (!byTask.has(e.taskId)) {
      byTask.set(e.taskId, {
        stageKey: e.stageKey,
        attemptNumber: e.attemptNumber,
      });
    }
  }
  return taskIds.map((id) => byTask.get(id) ?? null);
}
