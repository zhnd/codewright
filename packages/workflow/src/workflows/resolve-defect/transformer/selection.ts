import type {
  CriticReview,
  ResolutionResult,
  TestVerdict,
} from '@codewright/domain';
import type * as activities from '../../../activities/index.js';

// Candidate types + execution-driven selection helpers. Pure types only —
// zero @temporalio/* imports, trivially unit-testable.

export type FilterCandidateResult = Awaited<
  ReturnType<typeof activities.filterCandidateActivity>
>;

export interface Candidate {
  resolution: ResolutionResult;
  originalBranch: string;
  filterResult: FilterCandidateResult;
  criticReview: CriticReview;
}

/** Sum of additions + deletions across all files. */
export function diffSize(resolution: ResolutionResult): number {
  return resolution.diff.reduce((sum, d) => sum + d.additions + d.deletions, 0);
}

/**
 * Derive the execution-grounded {@link TestVerdict} for a candidate from
 * the raw FILTER check results. `null` = check not applicable.
 */
export function deriveTestVerdict(r: FilterCandidateResult): TestVerdict {
  // FAIL_TO_PASS: trust the VERIFIED fail→pass delta, not the raw oracle
  // pass. A no-op oracle that already passes on base yields `null` (no
  // trustworthy signal) — it must never be counted as proof of a fix.
  const oracle: boolean | null =
    r.oracleVerified === true
      ? true
      : r.oracleVerified === false
        ? false
        : r.oracleCheck && r.oracleCheck.passed === false
          ? false // oracle ran, patch still fails it → real negative
          : null; // no oracle, or passed-but-unverified → no trustworthy signal
  const regression = r.regressionCheck ? r.regressionCheck.passed : null;
  const build = r.buildCheck ? r.buildCheck.passed : null;
  const lint = r.lintCheck ? r.lintCheck.passed : null;
  const boot = r.bootCheck ? r.bootCheck.passed : null;
  // A signal is "executable" only when it is trustworthy: a verified (or
  // genuinely-failing) oracle, or a regression suite that actually ran.
  const hasExecutableSignal =
    oracle !== null || r.regressionCheck !== undefined;
  // A correctness gate is satisfied when it either did not run (null) or passed.
  const gateOk = (v: boolean | null) => v === null || v === true;
  // Build is ADVISORY, not a hard gate. The in-sandbox typecheck/build is too
  // environment-fragile on real repos (monorepo project refs, generated
  // clients, wrong root command) to reject an oracle-verified fix — it stays a
  // soft signal (correctnessScore + critic visibility); real CI is the backstop.
  const executionEligible =
    r.scopeClean && gateOk(oracle) && gateOk(regression);
  const correctnessScore =
    (oracle === true ? 1 : 0) +
    (regression === true ? 1 : 0) +
    (build === true ? 1 : 0);
  return {
    failToPassPassed: oracle,
    regressionPassed: regression,
    buildPassed: build,
    lintPassed: lint,
    bootPassed: boot,
    scopeClean: r.scopeClean,
    hasExecutableSignal,
    executionEligible,
    correctnessScore,
  };
}

/**
 * Execution-driven selection (SOTA #1 lever): rank candidates by real
 * test outcomes, NOT by the LLM critic. Order:
 *   1. correctness checks passed (oracle + regression + build) — desc
 *   2. soft signals (lint, boot) passed — desc
 *   3. critic score — desc (TIEBREAK ONLY)
 *   4. smaller diff
 * Caller has already verified `candidates.length > 0`.
 */
export function selectByExecution(candidates: Candidate[]): Candidate {
  const scored = candidates.map((c) => ({
    c,
    v: deriveTestVerdict(c.filterResult),
  }));
  scored.sort((a, b) => {
    if (b.v.correctnessScore !== a.v.correctnessScore) {
      return b.v.correctnessScore - a.v.correctnessScore;
    }
    const softA =
      (a.v.lintPassed === true ? 1 : 0) + (a.v.bootPassed === true ? 1 : 0);
    const softB =
      (b.v.lintPassed === true ? 1 : 0) + (b.v.bootPassed === true ? 1 : 0);
    if (softB !== softA) return softB - softA;
    const scoreDiff = b.c.criticReview.score - a.c.criticReview.score;
    if (Math.abs(scoreDiff) > 0.001) return scoreDiff;
    return diffSize(a.c.resolution) - diffSize(b.c.resolution);
  });
  return scored[0].c;
}
