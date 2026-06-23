import type { StageStatus } from '@/components/common/stage-track';

export type { TaskDetail, TimelineEvent } from '@/modules/tasks/types';

export type StageKey =
  | 'analyze'
  | 'reproduce'
  | 'implement'
  | 'filter'
  | 'critic'
  | 'hitl'
  | 'pr';

export type DetailTab = 'overview' | 'input' | 'activity' | 'timeline';

export type StageStatusMap = Record<StageKey, StageStatus>;

// Per-stage data folded from server task_event rows.

export interface ReviewView {
  action: string;
  feedback: string | null;
  decidedBy: string | null;
  decidedAt: string;
}

export interface AttemptView {
  attemptNumber: number;
  status: string;
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  /** HITL review for this attempt, null when none. */
  review: ReviewView | null;
}

export interface StageData {
  status: StageStatus;
  attempts: AttemptView[];
}

export type StageDataMap = Record<StageKey, StageData>;
