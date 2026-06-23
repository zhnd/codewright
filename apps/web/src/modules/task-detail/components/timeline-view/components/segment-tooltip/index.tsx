import { STAGE_LIST, STATUS_COLOR } from '../../constants';
import {
  formatCostUsd,
  formatDuration,
  formatStartClock,
  formatTokens,
} from '../../libs';
import type { TimelineSegment } from '../../types';
import type { HoverState } from '../../use-service';

const STATUS_LABEL: Record<TimelineSegment['status'], string> = {
  done: 'Completed',
  rejected: 'Rejected',
  failed: 'Failed',
  awaiting: 'Awaiting review',
  running: 'Running',
};

const STAGE_LABEL = new Map(STAGE_LIST.map((s) => [s.key, s.label]));

/**
 * Hover card for a Gantt segment — anchored below-right of the cursor,
 * pointer-events disabled so it never steals the hover. Shows timing plus
 * the agent cost rollup when the stage ran agents (FILTER / PR carry none).
 */
export function SegmentTooltip({ hover }: { hover: HoverState }) {
  const { seg, x, y } = hover;
  const durationMs = (seg.t1 - seg.t0) * 1000;
  const tokens =
    (seg.inputTokens ?? 0) + (seg.outputTokens ?? 0) > 0
      ? (seg.inputTokens ?? 0) + (seg.outputTokens ?? 0)
      : null;

  return (
    <div
      className="pointer-events-none absolute z-10 w-max max-w-72 rounded-md border border-border bg-surface px-3 py-2 shadow-md"
      style={{ left: x, top: y, transform: 'translate(12px, 12px)' }}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
          style={{ background: STATUS_COLOR[seg.status] }}
        />
        <span className="text-[12px] font-semibold text-foreground">
          {STAGE_LABEL.get(seg.stage) ?? seg.stage}
        </span>
        {seg.attempt > 1 && (
          <span className="font-mono text-[10.5px] text-foreground-subtle">
            #{seg.attempt}
          </span>
        )}
        <span className="ml-auto text-[10.5px] text-foreground-muted">
          {STATUS_LABEL[seg.status]}
        </span>
      </div>

      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
        <dt className="text-foreground-subtle">Started</dt>
        <dd className="text-right font-mono tabular-nums text-foreground-muted">
          {formatStartClock(seg.startedAt)}
        </dd>
        <dt className="text-foreground-subtle">Duration</dt>
        <dd className="text-right font-mono tabular-nums text-foreground">
          {formatDuration(durationMs)}
          {seg.open ? '+' : ''}
        </dd>
        {seg.model && (
          <>
            <dt className="text-foreground-subtle">Model</dt>
            <dd className="truncate text-right font-mono text-foreground-muted">
              {seg.model}
            </dd>
          </>
        )}
        {tokens != null && (
          <>
            <dt className="text-foreground-subtle">Tokens</dt>
            <dd className="text-right font-mono tabular-nums text-foreground-muted">
              {formatTokens(tokens)}
            </dd>
          </>
        )}
        {seg.costUsd != null && seg.costUsd > 0 && (
          <>
            <dt className="text-foreground-subtle">Cost</dt>
            <dd className="text-right font-mono tabular-nums text-foreground-muted">
              {formatCostUsd(seg.costUsd)}
            </dd>
          </>
        )}
      </dl>

      {seg.error && (
        <p className="mt-1.5 max-w-64 border-t border-border-faint pt-1.5 text-[10.5px] leading-[1.4] text-[color:var(--danger)]">
          {seg.error}
        </p>
      )}
    </div>
  );
}
