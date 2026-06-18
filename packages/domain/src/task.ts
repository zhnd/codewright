// ── Task / TaskEvent vocabulary ──────────────────────────
//
// Types are re-exported from @codewright/database (Prisma-generated enums are
// the single source of truth). This file owns the *business semantics* —
// terminal-status sets, predicates, canonical pipeline order — that
// Prisma can't infer from the schema alone.
//
// `@codewright/domain` depends on `@codewright/database` for **type-only** imports.
// Type imports compile away, so consumers (web, server, workflow) don't
// pull in any runtime database code.

export type {
  TaskEventKind,
  TaskEventStatus,
  TaskStageKey,
  TaskStatus,
} from '@codewright/database';

import type {
  TaskEventStatus,
  TaskStageKey,
  TaskStatus,
} from '@codewright/database';

export const CANONICAL_STAGE_ORDER: TaskStageKey[] = [
  'ANALYSIS',
  'REPRODUCE',
  'IMPLEMENT',
  'FILTER',
  'CRITIC',
  'PR',
];

export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export const TERMINAL_STAGE_EVENT_STATUSES: readonly TaskEventStatus[] = [
  'COMPLETED',
  'REJECTED',
  'FAILED',
  'SKIPPED',
] as const;

export function isTaskTerminal(status: TaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.includes(status);
}

export function isStageEventTerminal(status: TaskEventStatus): boolean {
  return TERMINAL_STAGE_EVENT_STATUSES.includes(status);
}

// ── Legacy task-stage / status types (used by web rendering) ─────────
//
// These predate the new TaskEvent model. Web's StageTrack still consumes
// the lowercase forms; keep them until web migrates to the uppercase
// TaskStageKey + TaskEventStatus directly.

export type TaskStage =
  | 'analysis'
  | 'plan'
  | 'reproduce'
  | 'implement'
  | 'filter'
  | 'critic'
  | 'test'
  | 'pr';

export type StageStatus =
  | 'pending'
  | 'running'
  | 'awaiting'
  | 'completed'
  | 'failed'
  | 'skipped';

export type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'blocked'
  | 'needs_review'
  | 'completed'
  | 'failed';

export type TaskBadge = 'path_deviation' | 'needs_review' | 'failed';

export const TASK_STAGES: TaskStage[] = [
  'analysis',
  'plan',
  'reproduce',
  'implement',
  'filter',
  'critic',
  'test',
  'pr',
];

// ── Observability types ─────────────────────────────────

export interface ObservedEvent {
  stage: string;
  event: string;
  level: 'info' | 'warn' | 'error';
  agent?: string;
  tool?: string;
  details?: string;
  timestamp: string;
}

export interface AgentCost {
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  model: string;
}

export interface AgentObservation {
  events: ObservedEvent[];
  cost: AgentCost | null;
}
