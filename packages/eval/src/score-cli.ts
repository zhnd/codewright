/**
 * Re-score an existing predictions file via the SWE-bench cloud, without
 * regenerating.  Usage: pnpm --filter @torin/eval score [predictions.jsonl] [runId]
 */
import { scoreWithSbCli } from './score.js';

const path = process.argv[2] ?? 'predictions.jsonl';
const runId = process.argv[3] ?? `torin-${Date.now()}`;
process.exit(scoreWithSbCli(path, runId) ? 0 : 1);
