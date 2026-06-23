import {
  DEFAULT_STAGES,
  type StageStatus,
  StageTrack,
} from '@/components/common/stage-track';
import { TAB_CONTENT_WIDTH, TAB_SCROLL_PADDING } from '../../../constants';
import type {
  StageDataMap,
  StageKey,
  StageStatusMap,
  TaskDetail,
} from '../../../types';
import { StageBody } from '../../stage-body';
import { StageStatsContext } from '../../stage-body/parts';

interface ResolveDefectViewProps {
  detail: TaskDetail;
  stages: StageStatusMap;
  stageData: StageDataMap;
  selectedStage: StageKey;
  setSelectedStage: (key: StageKey) => void;
  timings: Partial<Record<string, string>>;
  submitReview: (lane: string, feedback: string) => void;
  reviewing: boolean;
  hitlWaited: string | null;
}

/**
 * Multi-stage defect-resolution overview: pipeline rail + StageBody.
 * Extracted from task-detail/index.tsx so per-task-type views can replace
 * the overview content without forking the whole shell.
 */
export function ResolveDefectView({
  detail,
  stages,
  stageData,
  selectedStage,
  setSelectedStage,
  timings,
  submitReview,
  reviewing,
  hitlWaited,
}: ResolveDefectViewProps) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[244px_1fr]">
      <div className="max-h-64 overflow-y-auto border-b border-border-faint bg-surface-cream/30 p-3 lg:max-h-none lg:border-r lg:border-b-0">
        <div className="flex items-center gap-1.5 px-2.5 pb-3 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
          <span className="inline-block h-1 w-1 rounded-full bg-foreground-faint" />
          Pipeline
        </div>
        <StageTrack
          stages={stages as Partial<Record<string, StageStatus>>}
          currentStage={selectedStage}
          onSelect={(k) => setSelectedStage(k as StageKey)}
          list={DEFAULT_STAGES}
          timings={timings}
          retries={Object.fromEntries(
            (Object.keys(stageData) as StageKey[]).map((k) => [
              k,
              Math.max(0, stageData[k].attempts.length - 1),
            ])
          )}
        />
      </div>

      <div className={`overflow-y-auto ${TAB_SCROLL_PADDING}`}>
        <div className={`${TAB_CONTENT_WIDTH} pb-12`}>
          <StageStatsContext.Provider
            value={(() => {
              // The synthetic HITL stage has no events — show critic's cost.
              const key = selectedStage === 'hitl' ? 'critic' : selectedStage;
              const cost = detail.stageStats[key];
              return cost
                ? { ...cost, duration: timings[selectedStage] ?? null }
                : null;
            })()}
          >
            <StageBody
              stage={selectedStage}
              status={stages[selectedStage]}
              stageData={stageData}
              detail={detail}
              onReview={submitReview}
              reviewing={reviewing}
              hitlWaited={hitlWaited}
            />
          </StageStatsContext.Provider>
        </div>
      </div>
    </div>
  );
}
