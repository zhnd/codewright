'use client';

import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { StageTimingView } from '@/modules/tasks/types';
import { activeTime, deriveSegments, perStageSummary, wallTime } from './libs';
import type { StageKey, TimelineSegment } from './types';

export interface HoverState {
  seg: TimelineSegment;
  /** Cursor position relative to the Gantt panel container. */
  x: number;
  y: number;
}

/**
 * Timeline state: derives segments + summary metrics, drives a live clock
 * for still-running segments, and tracks hover (for the tooltip and the
 * Gantt↔breakdown highlight sync). Pure rendering stays in `index.tsx`.
 */
export function useTimeline(stageTimings: StageTimingView[]) {
  // Live clock only ticks while a segment is still open, so finished tasks
  // never re-render on a timer.
  const hasOpen = stageTimings.some((t) => !t.endedAt);
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!hasOpen) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasOpen]);

  const segments = useMemo(
    () => deriveSegments(stageTimings, nowTick),
    [stageTimings, nowTick]
  );
  const wallMs = useMemo(() => wallTime(segments), [segments]);
  const activeMs = useMemo(() => activeTime(segments), [segments]);
  const perStage = useMemo(
    () => perStageSummary(segments, wallMs),
    [segments, wallMs]
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [hoveredStage, setHoveredStage] = useState<StageKey | null>(null);

  const onSegmentMove = useCallback(
    (seg: TimelineSegment, e: ReactMouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setHover({ seg, x: e.clientX - rect.left, y: e.clientY - rect.top });
      setHoveredStage(seg.stage);
    },
    []
  );
  const onLeave = useCallback(() => {
    setHover(null);
    setHoveredStage(null);
  }, []);

  return {
    segments,
    wallMs,
    activeMs,
    perStage,
    containerRef,
    hover,
    hoveredStage,
    setHoveredStage,
    onSegmentMove,
    onLeave,
  };
}
