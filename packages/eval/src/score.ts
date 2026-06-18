import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// sb-cli lives in the uv-managed venv prepared by scripts/setup.sh.
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SB_CLI = join(PKG_ROOT, '.venv', 'bin', 'sb-cli');

/**
 * Submit predictions to the SWE-bench cloud (sb-cli) and wait for the
 * scored report. Returns true on success. No local Docker / dataset —
 * scoring runs on SWE-bench's hosted infra.
 */
export function scoreWithSbCli(
  predictionsPath: string,
  runId: string
): boolean {
  if (!existsSync(SB_CLI)) {
    console.log(
      '\n⚠️  sb-cli venv not found. Run:  pnpm --filter @codewright/eval setup'
    );
    return false;
  }
  if (!process.env.SWEBENCH_API_KEY) {
    console.log('\n⚠️  SWEBENCH_API_KEY not set — skipping cloud scoring.');
    console.log(
      '   Get a free key:  pnpm --filter @codewright/eval gen-key <your-email>'
    );
    console.log(
      `   Then score:      pnpm --filter @codewright/eval score ${predictionsPath}`
    );
    return false;
  }
  console.log(`\nSubmitting to SWE-bench cloud (run_id=${runId})…`);
  const r = spawnSync(
    SB_CLI,
    [
      'submit',
      'swe-bench_verified',
      'test',
      '--predictions_path',
      predictionsPath,
      '--run_id',
      runId,
    ],
    { stdio: 'inherit', env: process.env }
  );
  return r.status === 0;
}
