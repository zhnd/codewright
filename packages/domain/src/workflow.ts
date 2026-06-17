import type {
  FileChange,
  FileDiff,
  FilterCheckResult,
} from './agent-outputs/resolution-result';

export interface AnalyzeRepositoryInput {
  taskId: string;
  projectId: string;
  repositoryUrl: string;
}

export interface ResolveDefectInput {
  taskId: string;
  projectId: string;
  repositoryUrl: string;
  defectDescription: string;
  /**
   * User who initiated the task. Threaded through so HumanReview rows
   * can be attributed to the reviewer without a round-trip to the
   * auth layer.
   */
  userId?: string;
  /**
   * Caller-chosen base branch. When set, the workflow checks out this
   * branch before sample 1 instead of letting the sandbox / agent pick
   * the repo default. Used by the Tapd-triggered flow (and any other
   * caller that wants to target a release branch).
   */
  baseBranch?: string;
  /**
   * Caller-pinned base commit SHA. When set, the sandbox checks out this
   * exact commit. Used by the SWE-bench eval harness, where every instance
   * is pinned to a `base_commit`.
   */
  baseCommit?: string;
}

/**
 * One candidate from the Best-of-N IMPLEMENT loop. Produced by the
 * workflow (scope check + filter), not directly by any LLM — so it is
 * a plain interface, not a zod schema.
 */
export interface CandidatePatch {
  sampleId: number;
  branch: string;
  commitSha: string;
  diff: FileDiff[];
  changes: FileChange[];
  filesChanged: string[];
  scopeClean: boolean;
  scopeViolations: string[];
  oracleCheck?: FilterCheckResult;
  regressionCheck?: FilterCheckResult;
  buildCheck?: FilterCheckResult;
  lintCheck?: FilterCheckResult;
  bootCheck?: FilterCheckResult;
  previewUrl?: string;
  overallPassed: boolean;
}

export interface PullRequestResult {
  url: string;
  number: number;
}

/**
 * HITL decision as it flows through the Temporal `reviewSignal`.
 * `decisionType` selects the action vocabulary — binary for the legacy
 * approve/reject gate, ternary for future request-changes flows. Both
 * variants carry optional reviewer feedback.
 */
export type ReviewDecision =
  | {
      decisionType: 'binary';
      action: 'approve' | 'reject';
      feedback?: string;
    }
  | {
      decisionType: 'ternary';
      action: 'approve' | 'request-changes' | 'reject';
      feedback?: string;
    };
