// Shared stage-body building blocks, split by concern:
//   stage-stats   — the agent stats strip + its context
//   stage-header  — the heading (StageHeader) and labeled Section block
//   stage-states  — pending / running / failure / retry states
export { Section, StageHeader } from './stage-header';
export {
  RetryNotice,
  StageFailure,
  StagePlaceholder,
  StageRunning,
} from './stage-states';
export { StageStatsContext, type StageStripData } from './stage-stats';
