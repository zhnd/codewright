'use client';

import { StageTag } from '@/components/common/stage-tag';
import { SegmentTooltip } from './components/segment-tooltip';
import {
  GANTT_LEFT_GUTTER,
  GANTT_ROW_HEIGHT,
  GANTT_SEGMENT_HEIGHT,
  GANTT_TOP_PAD,
  GANTT_VIEWBOX_WIDTH,
  STAGE_LIST,
  STATUS_COLOR,
} from './constants';
import {
  formatClockFromSeconds,
  formatDuration,
  pickTickInterval,
  xAt,
} from './libs';
import type {
  BreakdownRow,
  StageKey,
  TimelineSegment,
  TimelineViewProps,
} from './types';
import { useTimeline } from './use-service';

/**
 * Timeline tab body — pipeline Gantt + per-stage breakdown bars. Sourced
 * from `task.events` (STAGE-kind), so it tracks any stage that ran —
 * including ones without agent invocations (FILTER, PR). The hero owns the
 * headline totals (duration/cost/tokens) and the Overview rail owns
 * per-stage status, so this view stays focused on sequencing + timing.
 *
 * Hovering a segment reveals its timing + agent cost; clicking jumps to
 * that stage in Overview (via `onSelectStage`). Running segments tick live
 * off the `useTimeline` clock. Empty-state short-circuits the SVG to avoid
 * the divide-by-zero misalignment when there is no data yet.
 */
export function TimelineView({
  stageTimings,
  onSelectStage,
}: TimelineViewProps) {
  const t = useTimeline(stageTimings);

  return (
    <div className="flex flex-col gap-5 pb-12">
      <GanttPanel
        segments={t.segments}
        wallSeconds={Math.ceil(t.wallMs / 1000)}
        wallMs={t.wallMs}
        activeMs={t.activeMs}
        containerRef={t.containerRef}
        hover={t.hover}
        hoveredStage={t.hoveredStage}
        onSegmentMove={t.onSegmentMove}
        onLeave={t.onLeave}
        onSelectStage={onSelectStage}
      />

      <BreakdownPanel
        rows={t.perStage}
        hoveredStage={t.hoveredStage}
        setHoveredStage={t.setHoveredStage}
        onSelectStage={onSelectStage}
      />
    </div>
  );
}

// ── Gantt ────────────────────────────────────────────────────────────

interface GanttPanelProps {
  segments: TimelineSegment[];
  wallSeconds: number;
  wallMs: number;
  activeMs: number;
  containerRef: ReturnType<typeof useTimeline>['containerRef'];
  hover: ReturnType<typeof useTimeline>['hover'];
  hoveredStage: StageKey | null;
  onSegmentMove: ReturnType<typeof useTimeline>['onSegmentMove'];
  onLeave: ReturnType<typeof useTimeline>['onLeave'];
  onSelectStage?: (stage: StageKey) => void;
}

function GanttPanel({
  segments,
  wallSeconds,
  wallMs,
  activeMs,
  containerRef,
  hover,
  hoveredStage,
  onSegmentMove,
  onLeave,
  onSelectStage,
}: GanttPanelProps) {
  if (segments.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <span className="text-[13px] font-semibold">Pipeline timeline</span>
          <span className="flex-1" />
          <Legend />
        </div>
        <div className="px-6 py-12 text-center text-[12.5px] text-foreground-muted">
          No timeline segments recorded yet.
        </div>
      </div>
    );
  }

  const height = GANTT_TOP_PAD + STAGE_LIST.length * GANTT_ROW_HEIGHT + 12;

  // Pick a tick interval that yields roughly TICK_TARGET ticks across
  // the wall time, snapping to the nearest "nice" duration. We
  // deliberately do NOT append an extra tick at exactly wallSeconds —
  // the "Wall time" metric below shows the precise end value, and the
  // chart's right edge always renders at wallSeconds regardless of tick
  // placement.
  const tickInterval = pickTickInterval(wallSeconds);
  const ticks: number[] = [];
  for (let t = 0; t <= wallSeconds; t += tickInterval) ticks.push(t);

  const idleMs = Math.max(0, wallMs - activeMs);

  return (
    <div
      className="relative rounded-md border border-border bg-surface"
      ref={containerRef}
    >
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="text-[13px] font-semibold">Pipeline timeline</span>
        <span className="text-[11.5px] text-foreground-subtle">
          {segments.length} segments
        </span>
        <span className="flex-1" />
        <Legend />
      </div>

      <SummaryStrip wallMs={wallMs} activeMs={activeMs} idleMs={idleMs} />

      <div className="overflow-x-auto p-4">
        <svg
          viewBox={`0 0 ${GANTT_VIEWBOX_WIDTH} ${height}`}
          width="100%"
          height={height}
          style={{ display: 'block' }}
          role="img"
          aria-label={`Pipeline timeline — ${segments.length} segments over ${formatDuration(wallMs)} wall time`}
        >
          <defs>
            <pattern
              id="awaiting-stripe"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(-45)"
            >
              <rect width="3" height="6" fill="white" opacity="0.4" />
            </pattern>
          </defs>
          {/* Tick marks. First/last labels use start/end anchors so they
              don't bleed back into the row-label gutter. */}
          {ticks.map((t, idx) => {
            const x = xAt(t, wallSeconds);
            const anchor =
              idx === 0 ? 'start' : idx === ticks.length - 1 ? 'end' : 'middle';
            return (
              <g key={`t-${t}`}>
                <line
                  x1={x}
                  x2={x}
                  y1={GANTT_TOP_PAD - 6}
                  y2={height - 8}
                  stroke="var(--border)"
                  strokeDasharray={t === 0 || t === wallSeconds ? '' : '2 3'}
                />
                <text
                  x={x}
                  y={GANTT_TOP_PAD - 12}
                  textAnchor={anchor}
                  fill="var(--foreground-subtle)"
                  fontFamily="var(--font-mono)"
                  fontSize="10.5"
                >
                  {formatClockFromSeconds(t)}
                </text>
              </g>
            );
          })}
          {/* Rows. Non-hovered rows dim when a stage is hovered so the
              focused stage reads at a glance. */}
          {STAGE_LIST.map((s, i) => {
            const y = GANTT_TOP_PAD + i * GANTT_ROW_HEIGHT;
            const dim = hoveredStage != null && hoveredStage !== s.key;
            return (
              <g key={s.key} opacity={dim ? 0.35 : 1}>
                <text
                  x={0}
                  y={y + GANTT_SEGMENT_HEIGHT / 2 + 4}
                  fill="var(--foreground)"
                  fontFamily="var(--font-sans)"
                  fontSize="11.5"
                >
                  {s.label}
                </text>
                <line
                  x1={GANTT_LEFT_GUTTER}
                  x2={GANTT_VIEWBOX_WIDTH}
                  y1={y + GANTT_SEGMENT_HEIGHT / 2}
                  y2={y + GANTT_SEGMENT_HEIGHT / 2}
                  stroke="var(--border)"
                  opacity={0.5}
                />
                {segments
                  .filter((seg) => seg.stage === s.key)
                  .map((seg, j) => (
                    <Segment
                      // biome-ignore lint/suspicious/noArrayIndexKey: segments are positionally stable per render
                      key={`${s.key}-${j}`}
                      seg={seg}
                      y={y}
                      wallSeconds={wallSeconds}
                      onMove={onSegmentMove}
                      onLeave={onLeave}
                      onSelect={onSelectStage}
                    />
                  ))}
              </g>
            );
          })}
        </svg>
      </div>

      {hover && <SegmentTooltip hover={hover} />}
    </div>
  );
}

function Segment({
  seg,
  y,
  wallSeconds,
  onMove,
  onLeave,
  onSelect,
}: {
  seg: TimelineSegment;
  y: number;
  wallSeconds: number;
  onMove: GanttPanelProps['onSegmentMove'];
  onLeave: GanttPanelProps['onLeave'];
  onSelect?: (stage: StageKey) => void;
}) {
  const x = xAt(seg.t0, wallSeconds);
  const width = Math.max(xAt(seg.t1, wallSeconds) - x, 14);
  const fill = STATUS_COLOR[seg.status];
  const showLabel = width > 70 && seg.label;
  const interactive = !!onSelect;
  const label = `${seg.stage} attempt ${seg.attempt} — ${seg.status}, ${formatDuration((seg.t1 - seg.t0) * 1000)}`;

  return (
    // biome-ignore lint/a11y/useSemanticElements: SVG <g> has no semantic button equivalent; role+keyboard handler is the accessible pattern
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      style={{ cursor: interactive ? 'pointer' : 'default' }}
      onMouseMove={(e) => onMove(seg, e)}
      onMouseLeave={onLeave}
      onClick={() => onSelect?.(seg.stage)}
      onKeyDown={(e) => {
        if (onSelect && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect(seg.stage);
        }
      }}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={GANTT_SEGMENT_HEIGHT}
        rx={3}
        fill={fill}
        opacity={seg.status === 'awaiting' ? 0.75 : 1}
      />
      {seg.status === 'awaiting' && (
        <rect
          x={x}
          y={y}
          width={width}
          height={GANTT_SEGMENT_HEIGHT}
          rx={3}
          fill="url(#awaiting-stripe)"
          opacity={0.35}
          pointerEvents="none"
        />
      )}
      {showLabel && (
        <text
          x={x + 8}
          y={y + GANTT_SEGMENT_HEIGHT / 2 + 3.5}
          fill="var(--background)"
          fontFamily="var(--font-mono)"
          fontSize="10.5"
          fontWeight="500"
          pointerEvents="none"
        >
          {seg.attempt > 1 ? `#${seg.attempt} · ${seg.label}` : seg.label}
        </text>
      )}
    </g>
  );
}

function SummaryStrip({
  wallMs,
  activeMs,
  idleMs,
}: {
  wallMs: number;
  activeMs: number;
  idleMs: number;
}) {
  const cells: { label: string; value: string }[] = [
    { label: 'Wall time', value: formatDuration(wallMs) },
    { label: 'Active', value: formatDuration(activeMs) },
    { label: 'Idle', value: formatDuration(idleMs) },
  ];
  return (
    <div className="flex items-stretch gap-0 border-b border-border-faint px-4 py-2">
      {cells.map((c, i) => (
        <div
          key={c.label}
          className={`flex flex-col gap-0.5 pr-5 ${i > 0 ? 'border-l border-border-faint pl-5' : ''}`}
        >
          <span className="text-[10px] uppercase tracking-[0.04em] text-foreground-subtle">
            {c.label}
          </span>
          <span className="font-mono text-[12.5px] tabular-nums text-foreground">
            {c.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function Legend() {
  // Solid swatches read from STATUS_COLOR so the legend never drifts from
  // the bars. Awaiting layers a white stripe over its base for the
  // striped-bar treatment used in the Gantt.
  const entries: { label: string; style: React.CSSProperties }[] = [
    { label: 'Done', style: { background: STATUS_COLOR.done } },
    { label: 'Running', style: { background: STATUS_COLOR.running } },
    {
      label: 'Awaiting',
      style: {
        background: `repeating-linear-gradient(-45deg, transparent 0 3px, rgba(255,255,255,0.5) 3px 6px), ${STATUS_COLOR.awaiting}`,
      },
    },
    { label: 'Rejected', style: { background: STATUS_COLOR.rejected } },
    { label: 'Failed', style: { background: STATUS_COLOR.failed } },
  ];
  return (
    <div className="flex items-center gap-3 text-[11px]">
      {entries.map((e) => (
        <span key={e.label} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={e.style} />
          <span className="text-foreground-muted">{e.label}</span>
        </span>
      ))}
    </div>
  );
}

// ── Breakdown ────────────────────────────────────────────────────────

function BreakdownPanel({
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
