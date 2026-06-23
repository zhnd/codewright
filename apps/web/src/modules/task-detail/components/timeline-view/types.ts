import type { StageTimingView } from '@/modules/tasks/types';

export type StageKey =
  | 'analyze'
  | 'reproduce'
  | 'implement'
  | 'filter'
  | 'critic'
  | 'pr';

export interface StageMeta {
  key: StageKey;
  label: string;
}

export interface TimelineSegment {
  stage: StageKey;
  attempt: number;
  status: 'done' | 'rejected' | 'failed' | 'awaiting' | 'running';
  /** Seconds from the earliest stage start. */
  t0: number;
  /** Seconds from the earliest stage start. */
  t1: number;
  label?: string;
  /** Absolute wall-clock start (ISO), for the tooltip. */
  startedAt: string;
  /** Whether the segment is still open (no endedAt) — drives live ticking. */
  open: boolean;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  model: string | null;
  error: string | null;
}

export interface BreakdownRow {
  stage: StageKey;
  /** Sum of attempt durations in milliseconds. */
  duration: number;
  /** Stage duration as a percent of wall time (0–100, integer). */
  percent: number;
  /** Number of attempts the stage ran. */
  attempts: number;
  /** Status of the stage's latest attempt — drives the bar color. */
  status: TimelineSegment['status'];
}

export interface TimelineViewProps {
  stageTimings: StageTimingView[];
  /**
   * Jump to a stage in the Overview tab when its Gantt segment is clicked.
   * The parent wires this to `setSelectedStage` + `setTab('overview')`.
   */
  onSelectStage?: (stage: StageKey) => void;
}
