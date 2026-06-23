import type {
  CriticReview,
  ResolutionResult,
  ReviewDecision,
} from '@codewright/domain';
import {
  type AttemptMemo,
  memoFromAttempt,
} from '../../../utils/retry-feedback.js';
import type { FilterCandidateResult } from './selection.js';

// Memo builders — workflow internal state → Reflexion-style retry feedback.

export function memoFromFilterFailure(args: {
  attemptNum: number;
  result: ResolutionResult;
  filterResult: FilterCandidateResult;
}): AttemptMemo {
  return memoFromAttempt({
    attemptNum: args.attemptNum,
    resolution: {
      summary: args.result.summary,
      filesChanged: args.result.filesChanged,
      diff: args.result.diff,
    },
    failureSummary: args.filterResult.failureSummary,
    failedChecks: [
      args.filterResult.oracleCheck,
      args.filterResult.regressionCheck,
      args.filterResult.buildCheck,
      args.filterResult.lintCheck,
      args.filterResult.bootCheck,
    ]
      .filter((c): c is NonNullable<typeof c> => c !== undefined)
      .filter((c) => !c.passed)
      .map((c) => ({ name: c.name, output: c.output })),
  });
}

export function memoFromCriticRejection(args: {
  attemptNum: number;
  result: ResolutionResult;
  criticReview: CriticReview;
}): AttemptMemo {
  const r = args.criticReview;
  return memoFromAttempt({
    attemptNum: args.attemptNum,
    resolution: {
      summary: args.result.summary,
      filesChanged: args.result.filesChanged,
      diff: args.result.diff,
    },
    failureSummary: `Critic rejected (scope: ${r.scopeAssessment}, score: ${r.score.toFixed(2)})`,
    failedChecks: r.concerns
      .filter((c) => c.severity !== 'info')
      .map((c) => ({
        name: `critic/${c.severity}`,
        output: `${c.description}${c.suggestion ? `\nSuggestion: ${c.suggestion}` : ''}${c.file ? ` [${c.file}]` : ''}`,
      })),
  });
}

export function memoFromHitlRejection(args: {
  attemptNum: number;
  resolution: ResolutionResult;
  decision: ReviewDecision;
}): AttemptMemo {
  return memoFromAttempt({
    attemptNum: args.attemptNum,
    resolution: {
      summary: args.resolution.summary,
      filesChanged: args.resolution.filesChanged,
      diff: args.resolution.diff,
    },
    failureSummary: `Rejected by reviewer: ${args.decision.feedback ?? '(no comment)'}`,
  });
}
