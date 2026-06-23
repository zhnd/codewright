// Data-shape transformers for the resolve-defect workflow, split by concern:
//   selection        — candidate types + execution-driven selection
//   input-builders   — workflow state → activity input shape
//   output-builders  — activity results → stage event output shapes
//   memos            — workflow state → Reflexion retry feedback
// Zero @temporalio/* imports — trivially unit-testable.

export {
  buildAnalyzeStageInput,
  buildImplementStageInput,
  buildPrStageInput,
  buildReproduceStageInput,
} from './input-builders.js';
export {
  memoFromCriticRejection,
  memoFromFilterFailure,
  memoFromHitlRejection,
} from './memos.js';
export {
  buildAutoApprovedCriticOutput,
  buildFilterCheckEntry,
  buildFilterChecksRecord,
  buildFinalResolution,
  buildHitlCriticOutput,
  buildSampleSummary,
  type CriticReviewEntry,
  type FilterCheckEntry,
  type SampleSummary,
} from './output-builders.js';
export {
  type Candidate,
  deriveTestVerdict,
  diffSize,
  type FilterCandidateResult,
  selectByExecution,
} from './selection.js';
