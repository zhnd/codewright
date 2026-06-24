import type { StageStatus } from '@/components/common/stage-track';
import { formatDuration } from '@/utils/format';
import type { TimelineEvent } from './types';

/** Normalize backend stage status strings to internal `StageStatus`. */
export function normalizeStageStatus(s: string | undefined): StageStatus {
  if (!s) return 'pending';
  const lower = s.toLowerCase();
  if (lower === 'running') return 'running';
  if (lower === 'awaiting' || lower === 'awaiting_review') return 'awaiting';
  if (lower === 'done' || lower === 'completed' || lower === 'success')
    return 'done';
  if (lower === 'auto' || lower === 'auto_approved') return 'auto';
  if (lower === 'failed' || lower === 'error') return 'failed';
  if (lower === 'skipped') return 'skipped';
  return 'pending';
}

/** Map backend stage keys to the canonical 7-stage pipeline keys. */
export function normalizeStageKey(stage: string): string {
  if (stage === 'analysis') return 'analyze';
  if (stage === 'plan') return 'analyze';
  if (stage === 'test') return 'filter';
  return stage;
}

/** Aggregate per-stage durations from observed events for StageTrack timings. */
export function computeStageTimings(
  events: TimelineEvent[]
): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {};
  const byStage = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    const list = byStage.get(e.stage) ?? [];
    list.push(e);
    byStage.set(e.stage, list);
  }
  for (const [stage, list] of byStage.entries()) {
    if (list.length < 2) continue;
    const first = new Date(list[0].timestamp).getTime();
    const last = new Date(list[list.length - 1].timestamp).getTime();
    out[normalizeStageKey(stage)] = formatDuration(last - first);
  }
  return out;
}

/** "Waited · Xm Ys" string for HITL — null when not awaiting / no signal. */
export function computeHitlWaited(
  events: TimelineEvent[],
  isAwaiting: boolean
): string | null {
  if (!isAwaiting) return null;
  const anchor = events[events.length - 1];
  if (!anchor) return null;
  const elapsed = Date.now() - new Date(anchor.timestamp).getTime();
  if (elapsed < 1000) return null;
  return formatDuration(elapsed);
}
