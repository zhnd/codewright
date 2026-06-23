import { RotateCcw } from 'lucide-react';
import { cn } from '@/utils/cn';
import { DEFAULT_STAGES } from './constants';
import type { StageStatus, StageTrackProps } from './types';

export { DEFAULT_STAGES } from './constants';
export type { StageItem, StageStatus, StageTrackProps } from './types';

/**
 * Vertical stage track. Each row is a dot + label + time. The connecting
 * line between dots is positioned by `calc()` against the dot column so
 * it stays mathematically centered no matter the row height.
 *
 * Geometry contract (kept stable so the line offset stays correct):
 *   - row button: `px-2 py-1.5` (8px horizontal padding)
 *   - dot is the first flex child with intrinsic size `h-3 w-3` (12px)
 *   → dot center sits at 8 + 6 = 14px from row left.
 *   - 1px line lives at left = 14 - 0.5 = 13.5px.
 *   - vertically: line spans from `50% + 6px` (dot bottom) to
 *     `-50% + 6px` (next dot top), assuming siblings have equal height.
 */
export function StageTrack({
  stages,
  currentStage,
  onSelect,
  list = DEFAULT_STAGES,
  timings = {},
  retries = {},
}: StageTrackProps) {
  return (
    <ol className="m-0 list-none p-0">
      {list.map((s, i) => {
        const st = stages[s.key] ?? 'pending';
        const selected = currentStage === s.key;
        const isLast = i === list.length - 1;
        const lineColor =
          st === 'done' || st === 'auto'
            ? 'var(--foreground)'
            : st === 'failed'
              ? 'var(--danger)'
              : 'var(--border)';
        return (
          <li key={s.key} className="relative">
            <button
              type="button"
              onClick={() => onSelect?.(s.key)}
              className={cn(
                'flex w-full cursor-pointer items-center gap-3 rounded-sm border-none px-2 py-1.5 text-left transition-colors',
                selected ? 'bg-surface-2' : 'bg-transparent hover:bg-surface-2'
              )}
            >
              <span className="relative z-10 flex shrink-0 items-center justify-center">
                <StageDot status={st} />
              </span>
              <span
                className={cn(
                  'flex-1 truncate text-[13px]',
                  selected ? 'font-semibold' : 'font-medium',
                  st === 'pending'
                    ? 'text-foreground-subtle'
                    : 'text-foreground'
                )}
              >
                {s.label}
              </span>
              {(retries[s.key] ?? 0) > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 font-mono text-[10px] text-[color:var(--warn)]"
                  title={`Retried ${retries[s.key]}×`}
                >
                  <RotateCcw className="h-2.5 w-2.5" />
                  {retries[s.key]}
                </span>
              )}
              <span className="font-mono text-[10.5px] text-foreground-subtle">
                {timings[s.key] ?? ''}
              </span>
            </button>
            {!isLast && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute w-px"
                style={{
                  left: '13.5px',
                  top: 'calc(50% + 6px)',
                  bottom: 'calc(6px - 50%)',
                  background: lineColor,
                  opacity:
                    st === 'done' || st === 'auto' || st === 'failed'
                      ? 1
                      : 0.85,
                }}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function StageDot({ status }: { status: StageStatus }) {
  const base = 'flex h-3 w-3 shrink-0 items-center justify-center rounded-full';
  if (status === 'done' || status === 'auto')
    return (
      <div className={cn(base, 'bg-foreground')}>
        <Check size={7} />
      </div>
    );
  if (status === 'failed')
    return (
      <div className={cn(base, 'bg-[color:var(--danger)]')}>
        <Cross size={6} />
      </div>
    );
  if (status === 'running')
    return (
      <div className={cn(base, 'relative bg-[color:var(--accent)]')}>
        <span
          className="block h-1.75 w-1.75 animate-spin rounded-full border-[1.5px] border-white/35"
          style={{ borderTopColor: 'white' }}
        />
      </div>
    );
  if (status === 'awaiting')
    return (
      <div className={cn(base, 'relative bg-[color:var(--accent)]')}>
        <span className="block h-0.75 w-0.75 rounded-full bg-white" />
        <span className="codewright-ping absolute -inset-px rounded-full bg-[color:var(--accent)] opacity-[0.35]" />
      </div>
    );
  if (status === 'skipped')
    return (
      <div
        className={cn(
          base,
          'border border-dashed border-border-strong bg-transparent'
        )}
      />
    );
  return (
    <div className={cn(base, 'border border-border-strong bg-transparent')} />
  );
}

function Check({ size = 8 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      role="img"
      aria-hidden="true"
    >
      <path
        d="M2 6.5L5 9L10 3.5"
        stroke="var(--background)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Cross({ size = 7 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 8 8"
      fill="none"
      role="img"
      aria-hidden="true"
    >
      <path
        d="M1 1L7 7M7 1L1 7"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
