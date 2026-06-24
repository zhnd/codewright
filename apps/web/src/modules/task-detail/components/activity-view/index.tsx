'use client';

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import type { StageTimingView } from '@/modules/tasks/types';
import { TAB_CONTENT_WIDTH, TAB_SCROLL_PADDING } from '../../constants';
import { StageNav } from './components/stage-nav';
import { ItemRow } from './components/stream-item';
import { useService } from './use-service';

/** Workflows with a fixed multi-stage pipeline always show the rail, even
 *  before later stages have produced events. Single-stage workflows
 *  (analyze-repository) render the stream full-width. */
const MULTI_STAGE_WORKFLOWS = new Set(['RESOLVE_DEFECT']);

interface ActivityViewProps {
  taskId: string;
  /** From the control plane — drives live subscription + "working" cue. */
  isRunning: boolean;
  /** Task workflow type — decides whether the stage rail is shown. */
  workflow: string;
  /** Stage attempts (eventId/stageKey/attemptNumber/status) for the rail. */
  stages: StageTimingView[];
}

export function ActivityView({
  taskId,
  isRunning,
  workflow,
  stages,
}: ActivityViewProps) {
  const {
    rail,
    selectedEventId,
    selectEvent,
    selectedItems,
    selectedMeta,
    loading,
    hasMore,
    loadMore,
    hasRows,
  } = useService({ taskId, isRunning, stages });

  // Show the rail for fixed multi-stage pipelines (resolve-defect) from the
  // start — so the stages are visible before later ones run — or once the
  // data itself proves it's multi-stage / multi-round.
  const showRail =
    MULTI_STAGE_WORKFLOWS.has(workflow) ||
    rail.length > 1 ||
    rail.some((s) => s.rounds.length > 1);

  const stream = (
    <div className="flex min-h-0 flex-1 flex-col">
      {showRail && selectedMeta && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border-faint px-4 py-2 sm:px-6 lg:px-8">
          <span className="text-[13px] font-semibold text-foreground">
            {selectedMeta.label}
          </span>
          {selectedMeta.roundCount > 1 && (
            <span className="rounded-sm bg-surface-2 px-1.5 py-px font-mono text-[10px] text-foreground-muted">
              round {selectedMeta.attemptNumber}
            </span>
          )}
          {selectedMeta.stepCount > 0 && (
            <span className="ml-auto font-mono text-[10.5px] text-foreground-subtle">
              {selectedMeta.stepCount} steps
            </span>
          )}
        </div>
      )}

      <Conversation className="min-h-0 flex-1">
        <ConversationContent
          className={`${TAB_CONTENT_WIDTH} ${TAB_SCROLL_PADDING} gap-3`}
        >
          {hasMore && (
            <button
              type="button"
              onClick={loadMore}
              className="self-start rounded-sm border border-border-faint px-2.5 py-1 text-[11px] text-foreground-muted hover:bg-surface-2"
            >
              Load earlier
            </button>
          )}
          {selectedItems.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
          {selectedItems.length === 0 && !loading && (
            <div className="py-12 text-center text-[12px] text-foreground-subtle">
              {!hasRows && isRunning
                ? 'Waiting for the agent to start…'
                : 'No agent activity for this stage.'}
            </div>
          )}
          {isRunning && selectedItems.length > 0 && (
            <div className="flex items-center gap-2 text-[11px] text-foreground-subtle">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--accent)]" />
              Agent working…
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showRail ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[240px_1fr]">
          {/* Left rail: stages / rounds */}
          <div className="max-h-56 overflow-y-auto border-b border-border-faint bg-surface-cream/30 p-3 lg:max-h-none lg:border-r lg:border-b-0">
            <div className="flex items-center gap-1.5 px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
              <span className="inline-block h-1 w-1 rounded-full bg-foreground-faint" />
              Stages
            </div>
            <StageNav
              rail={rail}
              selectedEventId={selectedEventId}
              onSelect={selectEvent}
            />
          </div>
          {stream}
        </div>
      ) : (
        stream
      )}
    </div>
  );
}
