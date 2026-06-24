import type {
  CriticReview,
  ReproductionOracle,
  ResolutionResult,
} from '@codewright/domain';
import { deriveTestVerdict, type FilterCandidateResult } from './selection.js';

// Output builders — activity results → stage event output shapes (read by
// the web's stage bodies), plus the per-sample summary shapes.

/** Map filter activity result into a stable per-check record. */
export function buildFilterChecksRecord(
  r: FilterCandidateResult
): Record<string, NonNullable<FilterCandidateResult['oracleCheck']>> {
  const out: Record<
    string,
    NonNullable<FilterCandidateResult['oracleCheck']>
  > = {};
  if (r.oracleCheck) out.oracle = r.oracleCheck;
  if (r.regressionCheck) out.regression = r.regressionCheck;
  if (r.buildCheck) out.build = r.buildCheck;
  if (r.lintCheck) out.lint = r.lintCheck;
  if (r.bootCheck) out.boot = r.bootCheck;
  return out;
}

// ── Per-sample summary shapes ───────────────────────────────────────

export interface SampleSummary {
  sampleId: number;
  summary: string;
  filesChanged: string[];
  additionsCount: number;
  deletionsCount: number;
}

export function buildSampleSummary(args: {
  sampleId: number;
  result: ResolutionResult;
}): SampleSummary {
  return {
    sampleId: args.sampleId,
    summary: args.result.summary,
    filesChanged: args.result.filesChanged,
    additionsCount: args.result.diff.reduce((s, d) => s + d.additions, 0),
    deletionsCount: args.result.diff.reduce((s, d) => s + d.deletions, 0),
  };
}

export interface FilterCheckEntry {
  sampleId: number;
  passed: boolean;
  oracle: FilterCandidateResult['oracleCheck'];
  regression: FilterCandidateResult['regressionCheck'];
  build: FilterCandidateResult['buildCheck'];
  lint: FilterCandidateResult['lintCheck'];
  boot: FilterCandidateResult['bootCheck'];
  /** Verified FAIL_TO_PASS delta (oracle failed on base AND passes here). */
  oracleVerified?: boolean;
  /**
   * Whether this candidate is execution-eligible to enter the selection
   * pool — the regression-trap signal. `false` here means the candidate
   * was dropped on test evidence (e.g. it regressed), not on critic.
   */
  eligible: boolean;
}

export function buildFilterCheckEntry(args: {
  sampleId: number;
  filterResult: FilterCandidateResult;
}): FilterCheckEntry {
  const r = args.filterResult;
  const verdict = deriveTestVerdict(r);
  const eligible = verdict.hasExecutableSignal
    ? verdict.executionEligible
    : r.overallPassed;
  return {
    sampleId: args.sampleId,
    passed: r.overallPassed,
    oracle: r.oracleCheck,
    regression: r.regressionCheck,
    build: r.buildCheck,
    lint: r.lintCheck,
    boot: r.bootCheck,
    oracleVerified: r.oracleVerified,
    eligible,
  };
}

export interface CriticReviewEntry {
  sampleId: number;
  review: CriticReview;
}

// ── CRITIC stage output (auto-approve / HITL flavors) ───────────────
//
// IMPORTANT: top-level fields (`resolution`, `criticReview`, ...) are
// what the web's HitlBody reads — keep them at the root, not nested
// under `selected`. The web also wants the per-sample `reviews` list
// for the "review history" panel.

export function buildAutoApprovedCriticOutput(args: {
  reviews: CriticReviewEntry[];
  resolution: ResolutionResult;
  criticReview: CriticReview;
  filterResult: FilterCandidateResult;
}): unknown {
  return {
    reviews: args.reviews,
    resolution: args.resolution,
    criticReview: args.criticReview,
    filterChecks: buildFilterChecksRecord(args.filterResult),
    previewUrl: args.filterResult.previewUrl,
    autoApproved: true,
  };
}

export function buildHitlCriticOutput(args: {
  reviews: CriticReviewEntry[];
  resolution: ResolutionResult;
  criticReview: CriticReview;
  filterResult: FilterCandidateResult;
  oracle: ReproductionOracle | null;
}): unknown {
  return {
    reviews: args.reviews,
    resolution: args.resolution,
    diff: args.resolution.diff,
    changes: args.resolution.changes,
    reviewNotes: args.resolution.reviewNotes,
    testsPassed: args.resolution.testsPassed,
    testOutput: args.resolution.testOutput,
    previewUrl: args.filterResult.previewUrl,
    reproductionOracle: args.oracle ?? undefined,
    criticReview: args.criticReview,
    filterChecks: {
      oracle: args.filterResult.oracleCheck,
      regression: args.filterResult.regressionCheck,
      build: args.filterResult.buildCheck,
      lint: args.filterResult.lintCheck,
      boot: args.filterResult.bootCheck,
    },
  };
}

/** Wraps the selected resolution with reproduction + filter context for return. */
export function buildFinalResolution(args: {
  resolution: ResolutionResult;
  oracle: ReproductionOracle | null;
  filterResult: FilterCandidateResult;
  autoApproved: boolean;
}): ResolutionResult {
  return {
    ...args.resolution,
    reproductionOracle: args.oracle ?? undefined,
    previewUrl: args.filterResult.previewUrl,
    filterChecks: buildFilterChecksRecord(args.filterResult),
    autoApproved: args.autoApproved,
  };
}
