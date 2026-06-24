'use client';

import { BreakdownPanel } from './components/breakdown-panel';
import { GanttPanel } from './components/gantt-panel';
import type { TimelineViewProps } from './types';
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
