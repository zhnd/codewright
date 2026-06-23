import type { MiniStageStatus } from '@/components/common/mini-track';
import { TASK_FILTERS } from './constants';
import type { ApiListTask, TaskListRow, TaskListStatusFilter } from './types';

// Server stage keys (uppercase, canonical order) → MiniTrack segment keys.
const STAGE_KEY_TO_MINI: Record<string, string> = {
  ANALYSIS: 'analyze',
  REPRODUCE: 'reproduce',
  IMPLEMENT: 'implement',
  FILTER: 'filter',
  CRITIC: 'critic',
  PR: 'pr',
};

// Server stage status → MiniTrack segment status.
const STAGE_STATUS_TO_MINI: Record<string, MiniStageStatus> = {
  PENDING: 'pending',
  RUNNING: 'running',
  AWAITING: 'awaiting',
  COMPLETED: 'done',
  FAILED: 'failed',
  REJECTED: 'failed',
  SKIPPED: 'skipped',
};

/** Fold the server stage array into the keyed record MiniTrack renders. */
function buildStageRecord(
  stages: ApiListTask['stages']
): Record<string, MiniStageStatus> {
  const out: Record<string, MiniStageStatus> = {};
  for (const s of stages ?? []) {
    const key = STAGE_KEY_TO_MINI[s.key];
    if (key) out[key] = STAGE_STATUS_TO_MINI[s.status] ?? 'pending';
  }
  return out;
}

/** Map a GraphQL list task into the display row the table renders. */
export function toListRow(t: ApiListTask): TaskListRow {
  return {
    id: t.id,
    type: t.type,
    status: t.status,
    currentStageKey: t.currentStageKey ?? null,
    currentStage: t.currentStageKey ? t.currentStageKey.toLowerCase() : null,
    stages: buildStageRecord(t.stages),
    awaiting: t.awaiting ?? null,
    totalCostUsd: t.totalCostUsd ?? null,
    durationMs: t.durationMs ?? null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt ?? t.createdAt,
    project: t.project ?? null,
  };
}

/**
 * Display status for a list row. The server's `status` is the raw
 * lifecycle enum (no AWAITING_REVIEW); a task paused on a human-review
 * gate stays RUNNING with a non-null `awaiting`. Surface that as
 * AWAITING_REVIEW so the filter, counts, and chip reflect it.
 */
export function effectiveStatus(t: TaskListRow): string {
  return t.awaiting ? 'AWAITING_REVIEW' : t.status;
}

/** Tally tasks by status filter, including the implicit `all` bucket. */
export function countByStatus(
  tasks: TaskListRow[]
): Record<TaskListStatusFilter, number> {
  return TASK_FILTERS.reduce<Record<TaskListStatusFilter, number>>(
    (acc, f) => {
      acc[f.key] =
        f.key === 'all'
          ? tasks.length
          : tasks.filter((t) => effectiveStatus(t) === f.key).length;
      return acc;
    },
    {
      all: 0,
      AWAITING_REVIEW: 0,
      RUNNING: 0,
      PENDING: 0,
      COMPLETED: 0,
      FAILED: 0,
    }
  );
}

export function filterTasks(
  tasks: TaskListRow[],
  status: TaskListStatusFilter,
  query = ''
): TaskListRow[] {
  const normalized = query.trim().toLowerCase();
  const byStatus =
    status === 'all'
      ? tasks
      : tasks.filter((t) => effectiveStatus(t) === status);
  if (!normalized) return byStatus;

  return byStatus.filter((t) => {
    const haystack = [t.id, t.type, t.status, t.currentStage, t.project?.name]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalized);
  });
}

export function formatDuration(ms: number | null): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export function formatCost(usd: number | null): string {
  return usd != null ? `$${usd.toFixed(2)}` : '—';
}

export function humanizeTaskType(type: string): string {
  return type.toLowerCase().replace(/_/g, ' ');
}
