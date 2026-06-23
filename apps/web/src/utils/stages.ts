import { CANONICAL_STAGE_ORDER, type TaskStageKey } from '@codewright/domain';

/**
 * Web-side stage keys — the lowercase alphabet the UI renders. Mirrors the
 * DB `TaskStageKey` set (ANALYSIS → analyze, …); the synthetic `hitl` stage
 * has no DB key and is owned by the views that surface it.
 */
export type WebStageKey =
  | 'analyze'
  | 'reproduce'
  | 'implement'
  | 'filter'
  | 'critic'
  | 'pr';

/**
 * DB stage key (uppercase `TaskStageKey`) → web stage key (lowercase). The
 * single source for this mapping; previously duplicated as `SERVER_TO_WEB_STAGE`
 * (tasks/transform), `mapStageKey` (timeline-view), and `STAGE_KEY_TO_MINI`
 * (tasks/libs).
 */
const DB_TO_WEB_STAGE: Record<TaskStageKey, WebStageKey> = {
  ANALYSIS: 'analyze',
  REPRODUCE: 'reproduce',
  IMPLEMENT: 'implement',
  FILTER: 'filter',
  CRITIC: 'critic',
  PR: 'pr',
};

/** Map a DB stage key (any case) to its web stage key, or null if unknown. */
export function dbStageToWebStage(key: string): WebStageKey | null {
  return DB_TO_WEB_STAGE[key.toUpperCase() as TaskStageKey] ?? null;
}

/** Canonical web stage keys in pipeline order. */
export const WEB_STAGE_ORDER: WebStageKey[] = CANONICAL_STAGE_ORDER.map(
  (k) => DB_TO_WEB_STAGE[k]
);
