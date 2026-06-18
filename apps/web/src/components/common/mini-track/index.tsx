import { cn } from '@/utils/cn';

export type MiniStageStatus =
  | 'pending'
  | 'running'
  | 'awaiting'
  | 'done'
  | 'auto'
  | 'failed'
  | 'skipped';

const STAGES = [
  'analyze',
  'reproduce',
  'implement',
  'filter',
  'critic',
  'hitl',
  'pr',
] as const;

/**
 * Compact horizontal bar of 7 segments, one per pipeline stage. Used in
 * the task table to show at-a-glance progress.
 */
export function MiniTrack({
  stages,
}: {
  stages: Partial<Record<(typeof STAGES)[number], MiniStageStatus>>;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {STAGES.map((key) => {
        const st: MiniStageStatus = stages[key] ?? 'pending';
        const cls =
          st === 'done' || st === 'auto'
            ? 'sv-done'
            : st === 'running'
              ? 'sv-running'
              : st === 'awaiting'
                ? 'sv-awaiting'
                : st === 'failed'
                  ? 'sv-failed'
                  : st === 'skipped'
                    ? 'sv-skipped'
                    : 'sv-pending';
        return (
          <div
            key={key}
            title={`${key} — ${st}`}
            className={cn(
              'h-0.75 w-4 rounded-[1px]',
              cls,
              (st === 'running' || st === 'awaiting') && 'codewright-pulse'
            )}
          />
        );
      })}
    </div>
  );
}
