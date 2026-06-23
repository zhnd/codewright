'use client';

import { ChevronRightIcon } from 'lucide-react';
import { cn } from '@/utils/cn';
import { type DotStatus, dotStatus } from '../../constants';
import type { RailStage } from '../../types';

interface StageNavProps {
  rail: RailStage[];
  selectedEventId: string | null;
  onSelect: (eventId: string) => void;
}

/**
 * Left rail for Activity: vertical list of stages; a stage with >1 round
 * expands (when it holds the selection) into round sub-rows. Mirrors the
 * Overview pipeline rail's visual language.
 */
export function StageNav({ rail, selectedEventId, onSelect }: StageNavProps) {
  // The stage that owns the current selection is auto-expanded.
  const selectedStageKey = rail.find((s) =>
    s.rounds.some((r) => r.eventId === selectedEventId)
  )?.stageKey;

  return (
    <ol className="m-0 list-none space-y-0.5 p-0">
      {rail.map((stage) => {
        const multi = stage.rounds.length > 1;
        const expanded = multi && stage.stageKey === selectedStageKey;
        const latest = stage.rounds.at(-1);
        const selectedHere = stage.stageKey === selectedStageKey;
        const totalSteps = stage.rounds.reduce((n, r) => n + r.stepCount, 0);

        return (
          <li key={stage.stageKey}>
            <button
              type="button"
              onClick={() => latest && onSelect(latest.eventId)}
              className={cn(
                'flex w-full cursor-pointer items-center gap-2.5 rounded-sm border-none px-2 py-1.5 text-left transition-colors',
                selectedHere
                  ? 'bg-surface-2'
                  : 'bg-transparent hover:bg-surface-2'
              )}
            >
              <Dot status={dotStatus(stage.status)} />
              <span
                className={cn(
                  'flex-1 truncate text-[12.5px]',
                  selectedHere
                    ? 'font-semibold text-foreground'
                    : 'font-medium text-foreground'
                )}
              >
                {stage.label}
              </span>
              {multi ? (
                <span className="font-mono text-[10px] text-foreground-subtle">
                  {stage.rounds.length} rounds
                </span>
              ) : (
                totalSteps > 0 && (
                  <span className="font-mono text-[10px] text-foreground-subtle">
                    {totalSteps}
                  </span>
                )
              )}
              {multi && (
                <ChevronRightIcon
                  className={cn(
                    'size-3.5 text-foreground-faint transition-transform',
                    expanded && 'rotate-90'
                  )}
                />
              )}
            </button>

            {expanded && (
              <ol className="m-0 mt-0.5 list-none space-y-0.5 p-0 pl-5">
                {stage.rounds.map((r) => {
                  const sel = r.eventId === selectedEventId;
                  return (
                    <li key={r.eventId}>
                      <button
                        type="button"
                        onClick={() => onSelect(r.eventId)}
                        className={cn(
                          'flex w-full cursor-pointer items-center gap-2 rounded-sm border-none px-2 py-1 text-left transition-colors',
                          sel
                            ? 'bg-surface-2'
                            : 'bg-transparent hover:bg-surface-2'
                        )}
                      >
                        <Dot status={dotStatus(r.status)} small />
                        <span
                          className={cn(
                            'flex-1 text-[11.5px]',
                            sel
                              ? 'font-medium text-foreground'
                              : 'text-foreground-muted'
                          )}
                        >
                          round {r.attemptNumber}
                        </span>
                        {r.stepCount > 0 && (
                          <span className="font-mono text-[10px] text-foreground-subtle">
                            {r.stepCount}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Dot({ status, small }: { status: DotStatus; small?: boolean }) {
  const size = small ? 'h-2 w-2' : 'h-2.5 w-2.5';
  if (status === 'done')
    return <span className={cn(size, 'shrink-0 rounded-full bg-foreground')} />;
  if (status === 'failed')
    return (
      <span
        className={cn(size, 'shrink-0 rounded-full bg-[color:var(--danger)]')}
      />
    );
  if (status === 'running')
    return (
      <span
        className={cn(
          size,
          'shrink-0 animate-pulse rounded-full bg-[color:var(--accent)]'
        )}
      />
    );
  if (status === 'awaiting')
    return (
      <span
        className={cn(
          size,
          'shrink-0 animate-pulse rounded-full bg-[color:var(--accent)]'
        )}
      />
    );
  // skipped / pending
  return (
    <span
      className={cn(size, 'shrink-0 rounded-full border border-border-strong')}
    />
  );
}
