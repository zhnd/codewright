import type { StageStatus } from '@/components/common/stage-track';
import type { StageDataMap, StageKey, TaskDetail } from '../../types';
import { AnalyzeBody } from './analyze-body';
import { CriticBody } from './critic-body';
import { FilterBody } from './filter-body';
import { HitlBody } from './hitl-body';
import { ImplementBody } from './implement-body';
import { latestOutput } from './libs';
import {
  RetryNotice,
  StageFailure,
  StagePlaceholder,
  StageRunning,
} from './parts';
import { PrBody } from './pr-body';
import { ReproduceBody } from './reproduce-body';

export interface StageBodyProps {
  stage: StageKey;
  status: StageStatus;
  stageData: StageDataMap;
  detail: TaskDetail;
  onReview: (lane: string, feedback: string) => void;
  reviewing: boolean;
  hitlWaited: string | null;
}

/**
 * Stage-body dispatcher: routes the currently-selected stage to its
 * dedicated body renderer. Pending/skipped stages get a uniform empty
 * placeholder so each body can assume it has data to render.
 */
export function StageBody(p: StageBodyProps): React.ReactNode {
  if (p.status === 'pending')
    return <StagePlaceholder stage={p.stage} reason="pending" />;
  if (p.status === 'skipped')
    return <StagePlaceholder stage={p.stage} reason="skipped" />;

  const attempts = p.stageData[p.stage].attempts;
  const latest = attempts.at(-1);
  // Review-stage "rejected" normalizes to `failed` but carries a rich
  // review history (error is null) — keep its own body, don't route to the
  // generic execution-failure panel.
  const isReviewStage = p.stage === 'critic' || p.stage === 'hitl';

  if (p.status === 'running')
    return (
      <StageRunning stage={p.stage} attempt={latest?.attemptNumber ?? 1} />
    );

  if (p.status === 'failed' && !isReviewStage)
    return (
      <StageFailure
        stage={p.stage}
        error={latest?.error ?? null}
        endedAt={latest?.endedAt ?? null}
        attemptCount={attempts.length}
      />
    );

  // Succeeded / awaiting / auto (and review-stage rejections): render the
  // stage body, prefixed with a retry notice when it took >1 attempt.
  const retry =
    attempts.length > 1 ? (
      <RetryNotice attempt={latest?.attemptNumber ?? attempts.length} />
    ) : null;

  const body = ((): React.ReactNode => {
    switch (p.stage) {
      case 'analyze':
        return (
          <AnalyzeBody
            analysis={latestOutput(p.stageData, 'analyze')}
            status={p.status}
            onReview={p.onReview}
            reviewing={p.reviewing}
          />
        );
      case 'reproduce':
        return (
          <ReproduceBody oracle={latestOutput(p.stageData, 'reproduce')} />
        );
      case 'implement':
        return (
          <ImplementBody
            payload={
              (latestOutput(p.stageData, 'implement') ?? {}) as Record<
                string,
                unknown
              >
            }
          />
        );
      case 'filter':
        return (
          <FilterBody
            payload={
              (latestOutput(p.stageData, 'filter') ?? {}) as Record<
                string,
                unknown
              >
            }
          />
        );
      case 'critic':
        return (
          <CriticBody
            payload={
              (latestOutput(p.stageData, 'critic') ?? {}) as Record<
                string,
                unknown
              >
            }
          />
        );
      case 'hitl': {
        // HITL gate sits on the CRITIC stage's data (workflow puts the
        // AWAITING + output payload there). Review history is each
        // critic attempt's embedded review (drop attempts without one,
        // e.g. trivial auto-approve).
        const criticAttempts = p.stageData.critic.attempts;
        const history = criticAttempts
          .filter((a) => a.review != null)
          .map((a) => ({
            attemptNumber: a.attemptNumber,
            ...(a.review as NonNullable<typeof a.review>),
          }));
        return (
          <HitlBody
            payload={
              (latestOutput(p.stageData, 'critic') ?? {}) as Record<
                string,
                unknown
              >
            }
            status={p.status}
            onReview={p.onReview}
            reviewing={p.reviewing}
            waited={p.hitlWaited}
            history={history}
          />
        );
      }
      case 'pr':
        return (
          <PrBody pr={latestOutput(p.stageData, 'pr')} detail={p.detail} />
        );
    }
  })();

  return (
    <>
      {retry}
      {body}
    </>
  );
}
