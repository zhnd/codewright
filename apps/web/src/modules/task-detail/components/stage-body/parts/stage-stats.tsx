import { createContext, useContext } from 'react';
import type { StageCostView } from '@/modules/tasks/types';
import { formatCostUsd, formatTokens } from '@/utils/format';

/**
 * Per-stage agent stats (model + tokens + cost) plus the stage's wall time,
 * surfaced as a strip under each stage heading. Provided by the per-task-type
 * view (it knows the selected stage) and consumed by `StageHeader`, so every
 * stage body shows it without threading the data through each one.
 */
export interface StageStripData extends StageCostView {
  /** Pre-formatted stage duration (matches the pipeline rail), or null. */
  duration: string | null;
}

export const StageStatsContext = createContext<StageStripData | null>(null);

export function StageStats() {
  const data = useContext(StageStatsContext);
  if (!data) return null;
  const { model, inputTokens, outputTokens, costUsd, duration } = data;

  const parts: { key: string; node: React.ReactNode }[] = [];
  if (model)
    parts.push({
      key: 'm',
      node: <span className="text-foreground-muted">{model}</span>,
    });
  if (inputTokens > 0 || outputTokens > 0)
    parts.push({
      key: 't',
      node: (
        <span>
          {formatTokens(inputTokens)} in / {formatTokens(outputTokens)} out
        </span>
      ),
    });
  if (costUsd > 0)
    parts.push({ key: 'c', node: <span>{formatCostUsd(costUsd)}</span> });
  if (duration) parts.push({ key: 'd', node: <span>{duration}</span> });
  if (parts.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[10.5px] tabular-nums text-foreground-subtle">
      {parts.map((p, i) => (
        <span key={p.key} className="inline-flex items-center gap-2">
          {i > 0 && <span className="text-foreground-faint">·</span>}
          {p.node}
        </span>
      ))}
    </div>
  );
}
