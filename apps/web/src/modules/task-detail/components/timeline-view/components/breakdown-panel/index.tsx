import { StageTag } from '@/components/common/stage-tag';
import { formatDuration } from '@/utils/format';
import { STATUS_COLOR } from '../../constants';
import type { BreakdownRow, StageKey } from '../../types';

export function BreakdownPanel({
  rows,
  hoveredStage,
  setHoveredStage,
  onSelectStage,
}: {
  rows: BreakdownRow[];
  hoveredStage: StageKey | null;
  setHoveredStage: (stage: StageKey | null) => void;
  onSelectStage?: (stage: StageKey) => void;
}) {
  if (rows.length === 0) {
    return (
      <div>
        <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-foreground-subtle">
          Per-stage breakdown
        </div>
        <div className="rounded-md border border-border bg-surface px-4 py-8 text-center text-[12px] text-foreground-muted">
          No stage durations recorded yet.
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-foreground-subtle">
        Per-stage breakdown
      </div>
      <div className="rounded-md border border-border bg-surface">
        {rows.map((r, i) => (
          <button
            key={r.stage}
            type="button"
            aria-label={`${r.stage} — ${formatDuration(r.duration)}, ${r.percent}% of wall time, ${r.attempts} attempt${r.attempts > 1 ? 's' : ''}`}
            onMouseEnter={() => setHoveredStage(r.stage)}
            onMouseLeave={() => setHoveredStage(null)}
            onClick={() => onSelectStage?.(r.stage)}
            className={`flex w-full items-center gap-4 bg-transparent px-4 py-3 text-left transition-colors ${
              onSelectStage ? 'cursor-pointer' : ''
            } ${i < rows.length - 1 ? 'border-b border-border' : ''} ${
              hoveredStage === r.stage ? 'bg-surface-inset' : ''
            }`}
          >
            <div className="flex w-37.5 shrink-0 items-center gap-2.5">
              <StageTag stage={r.stage} />
            </div>
            <div className="flex-1">
              {/* Bar width is the stage's true share of wall time, so the
                  unfilled remainder reads as idle/wait between stages. */}
              <div className="h-2.25 overflow-hidden rounded-[2px] bg-surface-inset">
                <div
                  className="h-full"
                  style={{
                    width: `${r.percent}%`,
                    background: STATUS_COLOR[r.status],
                    transition: 'width 160ms ease-out',
                  }}
                />
              </div>
            </div>
            <span className="w-18 text-right font-mono text-[12.5px] tabular-nums">
              {formatDuration(r.duration)}
            </span>
            <span className="w-11 text-right font-mono text-[12px] tabular-nums text-foreground-muted">
              {r.percent}%
            </span>
            <span
              className={`w-7.5 text-right font-mono text-[12px] tabular-nums ${
                r.attempts > 1
                  ? 'text-[color:var(--warn)]'
                  : 'text-foreground-subtle'
              }`}
            >
              ×{r.attempts}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
