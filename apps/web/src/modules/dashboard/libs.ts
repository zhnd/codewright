import type { AwaitingReviewRow } from './components/awaiting-review-table';
import type { ActivityRow } from './components/recent-activity';
import { ACTIVITY_LIMIT, SEVEN_DAYS_MS, STATUS_EVENT } from './constants';
import type { DashboardTask } from './types';

/** Derive a display title from a Task row. */
export function deriveTitle(task: DashboardTask): string {
  if (task.type === 'RESOLVE_DEFECT') {
    return `Defect resolution · ${task.id.slice(-4)}`;
  }
  return `${task.type.toLowerCase().replace(/_/g, ' ')} · ${task.id.slice(-4)}`;
}

/** Format an ISO timestamp as a relative-to-now string (e.g., "5m ago"). */
export function formatRelative(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** HH:MM:SS clock-style formatter used in the activity feed. */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/**
 * Build the awaiting-review table rows. A task is "awaiting review" when
 * its `awaiting` field is non-null (server-derived from any STAGE event
 * in AWAITING status). Sorted oldest-first so stale reviews bubble up.
 */
export function buildAwaitingRows(
  tasks: DashboardTask[],
  now: number
): AwaitingReviewRow[] {
  return tasks
    .filter((t) => t.awaiting != null)
    .slice()
    .sort(
      (a, b) =>
        new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
    )
    .map((t) => ({
      id: t.id,
      title: deriveTitle(t),
      projectName: t.project?.name ?? '—',
      stage: t.awaiting?.stageKey?.toLowerCase() ?? 'hitl',
      risk: 'medium',
      waited: formatRelative(t.updatedAt, now),
      branch: `codewright/${t.id.slice(-8)}`,
    }));
}

/** Top-N most recently updated tasks, mapped to activity rows. */
export function buildActivityRows(tasks: DashboardTask[]): ActivityRow[] {
  return tasks
    .slice()
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
    .slice(0, ACTIVITY_LIMIT)
    .map((t) => ({
      time: formatClock(t.updatedAt),
      taskId: t.id,
      projectName: t.project?.name ?? '—',
      stage: t.currentStageKey?.toLowerCase() ?? 'analyze',
      event:
        STATUS_EVENT[t.status as keyof typeof STATUS_EVENT] ??
        t.status.toLowerCase(),
    }));
}

/** Distribution of tasks across the canonical stage pipeline. */
export interface StageDistributionRow {
  key: string;
  label: string;
  count: number;
  percent: number;
}

const STAGE_LABELS: Record<string, string> = {
  ANALYSIS: 'Analyze',
  REPRODUCE: 'Reproduce',
  IMPLEMENT: 'Implement',
  FILTER: 'Filter',
  CRITIC: 'Critic',
  PR: 'PR',
};
const STAGE_ORDER = [
  'ANALYSIS',
  'REPRODUCE',
  'IMPLEMENT',
  'FILTER',
  'CRITIC',
  'PR',
];

/** Group active tasks by their currentStageKey for the stage panel. */
export function buildStageDistribution(
  tasks: DashboardTask[]
): StageDistributionRow[] {
  const active = tasks.filter(
    (t) => t.status === 'RUNNING' || t.status === 'PENDING'
  );
  const counts = new Map<string, number>();
  for (const t of active) {
    const k = (t.currentStageKey ?? 'ANALYSIS').toUpperCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const total = active.length || 1;
  return STAGE_ORDER.map((key) => ({
    key,
    label: STAGE_LABELS[key] ?? key,
    count: counts.get(key) ?? 0,
    percent: Math.round(((counts.get(key) ?? 0) / total) * 100),
  }));
}

/** Project-level activity rollup for the project-mix panel. */
export interface ProjectActivityRow {
  id: string;
  name: string;
  total: number;
  active: number;
  awaiting: number;
}

export function buildProjectActivity(
  tasks: DashboardTask[]
): ProjectActivityRow[] {
  const map = new Map<string, ProjectActivityRow>();
  for (const t of tasks) {
    if (!t.project) continue;
    const existing = map.get(t.project.id) ?? {
      id: t.project.id,
      name: t.project.name,
      total: 0,
      active: 0,
      awaiting: 0,
    };
    existing.total++;
    if (t.status === 'RUNNING' || t.status === 'PENDING') existing.active++;
    if (t.awaiting != null) existing.awaiting++;
    map.set(t.project.id, existing);
  }
  return Array.from(map.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
}

/**
 * Aggregate dashboard summary numbers in one pass.
 * Pure: takes tasks + a `now` clock so callers can be deterministic.
 */
export function summarize(tasks: DashboardTask[], now: number) {
  const awaiting = tasks.filter((t) => t.awaiting != null);
  const active = tasks.filter(
    (t) => t.status === 'RUNNING' || t.status === 'PENDING'
  );
  const completed = tasks.filter((t) => t.status === 'COMPLETED');
  const failed = tasks.filter((t) => t.status === 'FAILED');

  const sevenDaysAgo = now - SEVEN_DAYS_MS;
  const recentTasks = tasks.filter(
    (t) => new Date(t.updatedAt).getTime() >= sevenDaysAgo
  );
  const recentOutcomes = recentTasks.filter(
    (t) => t.status === 'COMPLETED' || t.status === 'FAILED'
  );
  const successRate =
    recentOutcomes.length > 0
      ? Math.round(
          (recentOutcomes.filter((t) => t.status === 'COMPLETED').length /
            recentOutcomes.length) *
            100
        )
      : null;

  const runningCount = active.filter((t) => t.status === 'RUNNING').length;
  const queuedCount = active.filter((t) => t.status === 'PENDING').length;

  return {
    awaitingCount: awaiting.length,
    activeCount: active.length,
    runningCount,
    queuedCount,
    completedCount: completed.length,
    failedCount: failed.length,
    weeklyCost: 0,
    recentTaskCount: recentTasks.length,
    recentOutcomeCount: recentOutcomes.length,
    successRate,
  };
}
