import { Chip } from '@/components/common/chip';
import { Markdown } from '@/components/common/markdown';
import { formatDuration } from '@/utils/format';
import { TAB_CONTENT_WIDTH, TAB_SCROLL_PADDING } from '../../../constants';
import type { StageData, TaskDetail } from '../../../types';
import { latestOutput } from '../../stage-body/libs';
import {
  Section,
  StageFailure,
  StageHeader,
  StageRunning,
  StageStatsContext,
} from '../../stage-body/parts';

interface AnalysisResultShape {
  summary?: unknown;
  techStack?: unknown;
  patterns?: unknown;
  structure?: unknown;
  recommendations?: unknown;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
    : [];
}

interface AnalyzeRepositoryViewProps {
  detail: TaskDetail;
  analyzeStage: StageData;
}

/**
 * Single-stage analyze-repository overview. Renders the AnalysisResult
 * payload (`packages/domain/src/agent-outputs/analysis-result.ts`) folded
 * out of the analyze stage's latest attempt. No pipeline rail — this
 * workflow only emits one stage (ANALYSIS).
 */
export function AnalyzeRepositoryView({
  detail,
  analyzeStage,
}: AnalyzeRepositoryViewProps) {
  const status = analyzeStage.status;
  const latest = analyzeStage.attempts.at(-1);
  // `done` is the StageStatus shown for COMPLETED on the wire; see
  // normalizeStatus in task-detail/use-service.ts.
  const isCompleted = status === 'done';

  // Per-stage agent stats strip (model + tokens + cost + duration), shown
  // under the heading via the shared StageHeader.
  const analyzeDurationMs = analyzeStage.attempts.reduce(
    (acc, a) => acc + (a.durationMs ?? 0),
    0
  );
  const stageCost = detail.stageStats.analyze;
  const stripValue = stageCost
    ? {
        ...stageCost,
        duration:
          analyzeDurationMs > 0 ? formatDuration(analyzeDurationMs) : null,
      }
    : null;

  const stageData = analyzeStage
    ? {
        analyze: analyzeStage,
        // Other keys unused but required by latestOutput's StageDataMap type;
        // pass empty stand-ins.
        reproduce: { status: 'pending' as const, attempts: [] },
        implement: { status: 'pending' as const, attempts: [] },
        filter: { status: 'pending' as const, attempts: [] },
        critic: { status: 'pending' as const, attempts: [] },
        hitl: { status: 'pending' as const, attempts: [] },
        pr: { status: 'pending' as const, attempts: [] },
      }
    : null;

  const analysis = (
    isCompleted && stageData ? latestOutput(stageData, 'analyze') : null
  ) as AnalysisResultShape | null;

  const summary = analysis ? asString(analysis.summary) : '';
  const techStack = analysis ? asStringArray(analysis.techStack) : [];
  const patterns = analysis ? asStringArray(analysis.patterns) : [];
  const structure = analysis ? asString(analysis.structure) : '';
  const recommendations = analysis
    ? asStringArray(analysis.recommendations)
    : [];

  const hasAny =
    summary ||
    techStack.length > 0 ||
    patterns.length > 0 ||
    structure ||
    recommendations.length > 0;

  const placeholderMessage =
    status === 'pending'
      ? 'Waiting to start.'
      : status === 'awaiting'
        ? 'Awaiting human review.'
        : status === 'skipped'
          ? 'Skipped.'
          : null;

  // Running / failed reuse the shared stage-state components so this
  // single-stage view matches the multi-stage resolve-defect Overview.
  let content: React.ReactNode;
  if (status === 'running') {
    content = (
      <StageRunning stage="analyze" attempt={latest?.attemptNumber ?? 1} />
    );
  } else if (status === 'failed') {
    content = (
      <StageFailure
        stage="analyze"
        error={latest?.error ?? null}
        endedAt={latest?.endedAt ?? null}
        attemptCount={analyzeStage.attempts.length}
      />
    );
  } else {
    content = (
      <>
        <StageHeader
          title="Repository analysis"
          chips={
            techStack.length > 0
              ? [
                  <Chip key="ts" mono>
                    {techStack.length} stack item
                    {techStack.length > 1 ? 's' : ''}
                  </Chip>,
                ]
              : undefined
          }
        />

        {placeholderMessage && (
          <div className="rounded-md border border-border-faint bg-surface-2 px-4 py-6 text-[13px] text-foreground-muted">
            {placeholderMessage}
          </div>
        )}

        {isCompleted && !hasAny && (
          <div className="rounded-md border border-border-faint bg-surface-2 px-4 py-6 text-[13px] text-foreground-muted">
            The agent returned an empty analysis. Check the Activity tab for the
            agent's raw output.
          </div>
        )}

        {summary && (
          <Section label="Summary">
            <Markdown>{summary}</Markdown>
          </Section>
        )}

        {techStack.length > 0 && (
          <Section label="Tech stack">
            <div className="flex flex-wrap gap-x-3.5 gap-y-1.5">
              {techStack.map((t) => (
                <Chip key={t} dot="var(--ok)" mono>
                  {t}
                </Chip>
              ))}
            </div>
          </Section>
        )}

        {structure && (
          <Section label="Structure">
            <Markdown className="text-[13.5px]">{structure}</Markdown>
          </Section>
        )}

        {patterns.length > 0 && (
          <Section label="Patterns">
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {patterns.map((p) => (
                <li
                  key={p}
                  className="rounded-sm border border-border-faint bg-surface-2 px-2.5 py-1.5 text-[13px] text-foreground-muted"
                >
                  {p}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {recommendations.length > 0 && (
          <Section label="Recommendations">
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {recommendations.map((r) => (
                <li
                  key={r}
                  className="rounded-sm border border-border-faint bg-surface-cream/40 px-3 py-2 text-[13.5px] leading-relaxed text-foreground"
                >
                  <Markdown>{r}</Markdown>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </>
    );
  }

  return (
    <StageStatsContext.Provider value={stripValue}>
      <div className={`min-h-0 flex-1 overflow-y-auto ${TAB_SCROLL_PADDING}`}>
        <div className={`${TAB_CONTENT_WIDTH} pb-12`}>{content}</div>
      </div>
    </StageStatsContext.Provider>
  );
}
