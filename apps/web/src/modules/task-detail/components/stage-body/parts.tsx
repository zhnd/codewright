import { RotateCcw } from 'lucide-react';
import { createContext, useContext } from 'react';
import type { StageCostView } from '@/modules/tasks/types';
import { formatCostUsd, formatTokens } from '@/utils/format';
import { STAGE_LABELS } from '../../constants';
import type { StageKey } from '../../types';
import { FailurePanel } from '../failure-panel';

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

function StageStats() {
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

/**
 * Empty-state message for stages that haven't run yet (`pending`) or
 * were skipped because an earlier stage failed (`skipped`).
 */
export function StagePlaceholder({
  stage,
  reason,
}: {
  stage: StageKey;
  reason: 'pending' | 'skipped';
}) {
  return (
    <div className="py-10 text-center text-foreground-subtle">
      <div className="text-[13px]">
        {STAGE_LABELS[stage]}{' '}
        {reason === 'pending'
          ? "hasn't started yet."
          : 'was skipped because an earlier stage failed.'}
      </div>
    </div>
  );
}

/**
 * Stage-body header: heading + optional chip row. The selected stage is
 * already named in the pipeline rail, so the body doesn't repeat it.
 */
export function StageHeader({
  title,
  chips,
}: {
  title: string;
  chips?: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <h2 className="m-0 text-[20px] font-semibold leading-[1.15] tracking-normal text-foreground">
        {title}
      </h2>
      <StageStats />
      {chips && <div className="mt-2.5 flex flex-wrap gap-3.5">{chips}</div>}
    </div>
  );
}

/**
 * Labeled section block within a stage body. Mono uppercase eyebrow +
 * children container with bottom margin.
 */
export function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-foreground-subtle">
        {label}
      </div>
      {children}
    </div>
  );
}

/**
 * In-progress state for a stage whose agents are still running. The
 * structured result only lands when the agent submits, so there is nothing
 * to render yet — point the user at the Activity tab for live output.
 */
export function StageRunning({
  stage,
  attempt = 1,
}: {
  stage: StageKey;
  attempt?: number;
}) {
  return (
    <div>
      <StageHeader
        title={STAGE_LABELS[stage]}
        chips={
          attempt > 1 ? (
            <span className="inline-flex items-center gap-1 rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-[color:var(--warn)]">
              <RotateCcw className="h-2.5 w-2.5" />
              retry · attempt {attempt}
            </span>
          ) : undefined
        }
      />
      <div className="flex items-center gap-2.5 rounded-md border border-border-faint bg-surface-2 px-4 py-5 text-[13px] text-foreground-muted">
        <span className="relative flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[color:var(--accent)]">
          <span
            className="block h-2 w-2 animate-spin rounded-full border-[1.5px] border-white/35"
            style={{ borderTopColor: 'white' }}
          />
        </span>
        {STAGE_LABELS[stage]} is running…
      </div>
      <div className="mt-2 text-[11.5px] text-foreground-subtle">
        Live progress streams in the Activity tab.
      </div>
    </div>
  );
}

/**
 * Terminal failure state for an execution stage. Surfaces the stage's own
 * error (the agent/exec error string), distinct from the task-level
 * FailurePanel in the hero. Review-stage rejections are NOT routed here —
 * they keep their own bodies (which render the rejection + concerns).
 */
export function StageFailure({
  stage,
  error,
  endedAt,
  attemptCount = 1,
}: {
  stage: StageKey;
  error: string | null;
  endedAt: string | null;
  attemptCount?: number;
}) {
  const label = STAGE_LABELS[stage];
  return (
    <div>
      <StageHeader title={label} />
      <FailurePanel
        title={
          attemptCount > 1 ? `Failed after ${attemptCount} attempts` : 'Failed'
        }
        message={
          error ??
          'The stage failed without a recorded error message. Check the Activity tab for the agent’s raw output.'
        }
        occurredAt={endedAt}
      />
    </div>
  );
}

/**
 * Slim banner shown above a succeeded/awaiting stage body when it took more
 * than one attempt, so a recovered retry is visible in the Overview.
 */
export function RetryNotice({ attempt }: { attempt: number }) {
  return (
    <div className="mb-4 inline-flex items-center gap-1.5 rounded-sm border border-border-faint bg-surface-2 px-2 py-1 font-mono text-[11px] text-foreground-muted">
      <RotateCcw className="h-2.75 w-2.75 text-[color:var(--warn)]" />
      Retried · succeeded on attempt {attempt}
    </div>
  );
}
