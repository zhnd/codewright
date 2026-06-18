import type {
  CriticReview,
  DefectAnalysis,
  ResolutionResult,
} from '@codewright/domain';

/**
 * Hard rules for "safe to auto-merge without human review". All must
 * hold. Deliberately conservative — the cost of a false auto-approve
 * (shipping a bug) is far greater than the cost of a human clicking
 * approve on a trivial change.
 *
 * The env flag CODEWRIGHT_AUTO_APPROVE_TRIVIAL must also be 'true' — off by
 * default for safety.
 */

/** Max diff size (additions + deletions) allowed for auto-approve. */
const MAX_DIFF_LINES = 20;

/**
 * Pre-sampling budget hint. For trivial changes (docs / i18n / string
 * literals), Best-of-N diversity produces effectively identical patches
 * across samples — token cost grows N× for no quality gain. Drop to a
 * single sample for this class; the auto-approve gate later can still
 * reject and hand off to HITL, but even then we avoid 2 wasted samples.
 *
 * This is orthogonal to isAutoApprovable(): N=1 runs regardless of
 * whether the final patch qualifies for auto-approve.
 */
export function recommendedSampleCount(
  analysis: DefectAnalysis,
  defaultN: number
): number {
  if (analysis.riskClass === 'trivial') return 1;
  return defaultN;
}

/** File extensions/patterns where auto-approve is permissible. */
const TRIVIAL_FILE_PATTERNS: Array<(path: string) => boolean> = [
  (p) => p.endsWith('.md'),
  (p) => p.endsWith('.txt'),
  (p) => p.endsWith('.mdx'),
  // i18n dictionaries (common paths)
  (p) => /\/locales?\//i.test(p),
  (p) => /\/i18n\//i.test(p),
  (p) => p.endsWith('.po'),
];

/** Paths that can never be auto-approved even if everything else is OK. */
const NEVER_AUTO_APPROVE_PATTERNS: Array<(path: string) => boolean> = [
  (p) => /\.env($|\.)/.test(p),
  (p) => p.includes('/migrations/'),
  (p) => /(^|\/)test[s]?\//.test(p),
  (p) => /\.test\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs)$/.test(p),
  (p) => /\.spec\.(ts|tsx|js|jsx|mjs|cjs|py)$/.test(p),
];

export interface AutoApproveDecision {
  autoApprove: boolean;
  /** Why not auto-approved, if false. Used for observability. */
  reason?: string;
}

/**
 * Pre-implement gate: skip the analyze-stage HITL when the LLM self-
 * classified the defect as `trivial` AND the operator opted in via env.
 *
 * This is a thinner check than `isAutoApprovable` (which runs post-
 * implement and inspects critic + diff). Here we only have the
 * analysis output to go on; the conservative late gate still stands
 * for the HITL-final review.
 */
export function shouldAutoApproveAnalysis(
  analysis: DefectAnalysis,
  envFlag: string | undefined
): AutoApproveDecision {
  if (envFlag !== 'true') {
    return {
      autoApprove: false,
      reason: 'CODEWRIGHT_AUTO_APPROVE_TRIVIAL not set to true',
    };
  }
  if (analysis.riskClass !== 'trivial') {
    return {
      autoApprove: false,
      reason: `riskClass is '${analysis.riskClass}', only 'trivial' qualifies`,
    };
  }
  if (analysis.scopeDeclaration.length === 0) {
    return {
      autoApprove: false,
      reason: 'no scopeDeclaration — skipping is unsafe without a fence',
    };
  }
  return { autoApprove: true };
}

export function isAutoApprovable(
  analysis: DefectAnalysis,
  resolution: ResolutionResult,
  criticReview: CriticReview,
  envFlag: string | undefined
): AutoApproveDecision {
  if (envFlag !== 'true') {
    return {
      autoApprove: false,
      reason: 'CODEWRIGHT_AUTO_APPROVE_TRIVIAL not set to true',
    };
  }
  if (analysis.riskClass !== 'trivial') {
    return {
      autoApprove: false,
      reason: `riskClass is '${analysis.riskClass}', only 'trivial' qualifies`,
    };
  }
  if (!criticReview.approve) {
    return { autoApprove: false, reason: 'critic did not approve' };
  }
  if (criticReview.scopeAssessment !== 'clean') {
    return {
      autoApprove: false,
      reason: `critic scopeAssessment is '${criticReview.scopeAssessment}'`,
    };
  }
  // No blocking or warning concerns — only pure 'info' (or none).
  const nonInfo = criticReview.concerns.filter((c) => c.severity !== 'info');
  if (nonInfo.length > 0) {
    return {
      autoApprove: false,
      reason: `critic raised ${nonInfo.length} non-info concern(s)`,
    };
  }

  const totalLines = resolution.diff.reduce(
    (sum, d) => sum + d.additions + d.deletions,
    0
  );
  if (totalLines > MAX_DIFF_LINES) {
    return {
      autoApprove: false,
      reason: `diff is ${totalLines} lines (max ${MAX_DIFF_LINES} for auto-approve)`,
    };
  }

  for (const file of resolution.filesChanged) {
    if (NEVER_AUTO_APPROVE_PATTERNS.some((p) => p(file))) {
      return {
        autoApprove: false,
        reason: `file '${file}' is in the never-auto-approve list (tests / env / migrations)`,
      };
    }
    if (!TRIVIAL_FILE_PATTERNS.some((p) => p(file))) {
      return {
        autoApprove: false,
        reason: `file '${file}' is not a trivial-file-pattern match (docs / i18n only)`,
      };
    }
  }

  return { autoApprove: true };
}
