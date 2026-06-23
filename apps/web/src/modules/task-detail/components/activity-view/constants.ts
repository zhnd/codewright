// Display names for DB stage keys (uppercase) in the Activity rail.
export const STAGE_DISPLAY: Record<string, string> = {
  ANALYSIS: 'Analysis',
  REPRODUCE: 'Reproduction',
  IMPLEMENT: 'Implementation',
  FILTER: 'Filter',
  CRITIC: 'Critic',
  PR: 'Pull request',
};

/** Human label for a DB stage key, falling back to Title Case. */
export function stageLabel(stageKey: string): string {
  return (
    STAGE_DISPLAY[stageKey] ??
    stageKey.charAt(0).toUpperCase() + stageKey.slice(1).toLowerCase()
  );
}

/** Visual status bucket for the rail dot, from a TaskEvent status. */
export type DotStatus =
  | 'running'
  | 'awaiting'
  | 'done'
  | 'failed'
  | 'skipped'
  | 'pending';

export function dotStatus(eventStatus: string): DotStatus {
  switch (eventStatus.toUpperCase()) {
    case 'RUNNING':
      return 'running';
    case 'AWAITING':
      return 'awaiting';
    case 'COMPLETED':
      return 'done';
    case 'REJECTED':
    case 'FAILED':
      return 'failed';
    case 'SKIPPED':
      return 'skipped';
    default:
      return 'pending';
  }
}
