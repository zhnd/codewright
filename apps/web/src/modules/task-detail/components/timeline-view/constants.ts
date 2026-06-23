import type { StageKey, StageMeta, TimelineSegment } from './types';

// ── Stage metadata (Visual tab y-axis order) ────────────────

export const STAGE_LIST: StageMeta[] = [
  { key: 'analyze', label: 'Analysis' },
  { key: 'reproduce', label: 'Reproduction' },
  { key: 'implement', label: 'Implementation' },
  { key: 'filter', label: 'Filter' },
  { key: 'critic', label: 'Critic' },
  { key: 'pr', label: 'Pull request' },
];

export const STAGE_KEYS = new Set<StageKey>(STAGE_LIST.map((s) => s.key));

export const STATUS_COLOR: Record<TimelineSegment['status'], string> = {
  done: 'var(--ok)',
  rejected: 'var(--warn)',
  failed: 'var(--danger)',
  awaiting: 'var(--accent)',
  running: 'var(--accent)',
};

// ── Gantt layout (viewBox-space pixels) ─────────────────────

export const GANTT_ROW_HEIGHT = 32;
export const GANTT_LEFT_GUTTER = 140;
export const GANTT_TOP_PAD = 32;
export const GANTT_SEGMENT_HEIGHT = 18;
export const GANTT_VIEWBOX_WIDTH = 1000;

// ── Tick density tuning ─────────────────────────────────────

/** Approximate target number of axis ticks across the chart. */
export const TICK_TARGET = 7;

/** "Nice" tick intervals (in seconds) that pickTickInterval snaps to. */
export const TICK_CANDIDATES = [
  5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400,
];
