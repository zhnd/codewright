import type { AwaitingItem, DecisionItem, InboxTask } from './types';

const INBOX_RECENT_LIMIT = 12;

function deriveTitle(t: InboxTask): string {
  if (t.type === 'RESOLVE_DEFECT') {
    return `Defect resolution · ${t.id.slice(-4)}`;
  }
  return `${t.type.toLowerCase().replace(/_/g, ' ')} · ${t.id.slice(-4)}`;
}

export function formatRelative(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function minutesSince(iso: string, now: number): number {
  return Math.floor(Math.max(0, now - new Date(iso).getTime()) / 60000);
}

/** Build the full Awaiting Review queue, oldest first. */
export function buildAwaitingItems(
  tasks: InboxTask[],
  now: number
): AwaitingItem[] {
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
      waitedMinutes: minutesSince(t.updatedAt, now),
      branch: `codewright/${t.id.slice(-8)}`,
    }));
}

/**
 * Build the recent-decisions feed. Server doesn't expose review-decided
 * events on the dashboard query, so we approximate with non-awaiting,
 * non-pending tasks that recently transitioned (completed / failed /
 * running with the awaiting cleared). Good enough for the inbox UI;
 * upgrade later when the GraphQL exposes a proper decisions stream.
 */
export function buildDecisions(tasks: InboxTask[]): DecisionItem[] {
  return tasks
    .filter(
      (t) =>
        (t.status === 'COMPLETED' ||
          t.status === 'FAILED' ||
          t.status === 'RUNNING') &&
        t.awaiting == null
    )
    .slice()
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
    .slice(0, INBOX_RECENT_LIMIT)
    .map((t) => ({
      taskId: t.id,
      projectName: t.project?.name ?? '—',
      stage: t.currentStageKey?.toLowerCase() ?? 'hitl',
      decision:
        t.status === 'COMPLETED'
          ? 'approved · merged'
          : t.status === 'FAILED'
            ? 'failed'
            : 'resumed',
      time: new Date(t.updatedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    }));
}

/** Aggregate inbox stats: total awaiting, oldest wait, decisions today. */
export function summarizeInbox(tasks: InboxTask[], now: number) {
  const awaiting = buildAwaitingItems(tasks, now);
  const oldest = awaiting[0];
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const decisionsToday = tasks.filter(
    (t) =>
      t.awaiting == null &&
      (t.status === 'COMPLETED' || t.status === 'FAILED') &&
      new Date(t.updatedAt).getTime() >= dayAgo
  ).length;

  return {
    awaitingCount: awaiting.length,
    oldestWait: oldest?.waited ?? '—',
    oldestId: oldest?.id ?? null,
    decisionsToday,
  };
}
