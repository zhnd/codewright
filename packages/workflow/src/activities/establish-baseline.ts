import type { ReproductionOracle } from '@codewright/domain';
import { connectSandbox, type SandboxState } from '@codewright/sandbox';
import { log } from '../logger.js';
import { detectTestRunner } from '../utils/test-runner-detect.js';

export interface EstablishBaselineInput {
  state: SandboxState;
  /**
   * The reproduction oracle, evaluated on the post-REPRODUCE / pre-IMPLEMENT
   * tree (base source + committed reproduction test, NO fix yet).
   */
  oracle: ReproductionOracle;
}

/**
 * Execution baseline for FAIL_TO_PASS verification, captured ONCE per
 * task on the unpatched tree. Lets the per-candidate FILTER prove a real
 * fail→pass delta instead of trusting the reproduce agent's self-reported
 * `confirmedFailing`.
 */
export interface BaselineSnapshot {
  /**
   * True when the reproduction oracle FAILS on the unpatched base — i.e.
   * it genuinely detects the bug. When `false`, the oracle is a fake /
   * no-op (it passes even without a fix) and must NOT be trusted as proof
   * that a later patch fixed anything. `null` = could not be evaluated.
   */
  oracleFailsOnBase: boolean | null;
  /** Whether the project's regression suite passes on the unpatched base. */
  baseRegressionPassed: boolean | null;
}

/**
 * Run the reproduction oracle (and, for context, the regression suite)
 * on the unpatched base tree. Trusts execution, not agent assertions:
 * a valid oracle MUST fail here, otherwise it proves nothing downstream.
 */
export async function establishBaselineActivity(
  input: EstablishBaselineInput
): Promise<BaselineSnapshot> {
  const { state, oracle } = input;
  const sandbox = await connectSandbox(state);

  let oracleFailsOnBase: boolean | null = null;
  if (oracle.mode !== 'none' && oracle.runCommand) {
    try {
      const r = await sandbox.exec(oracle.runCommand, { timeoutMs: 300_000 });
      // A genuine reproduction FAILS on the unpatched base.
      oracleFailsOnBase = !r.success;
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'baseline oracle run errored; treating as unverifiable'
      );
      oracleFailsOnBase = null;
    }
  }

  let baseRegressionPassed: boolean | null = null;
  const runner = await detectTestRunner(sandbox);
  if (runner.hasTestInfra && runner.testCommand) {
    try {
      const r = await sandbox.exec(runner.testCommand, { timeoutMs: 600_000 });
      baseRegressionPassed = r.success;
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'baseline regression run errored'
      );
      baseRegressionPassed = null;
    }
  }

  log.info(
    { oracleFailsOnBase, baseRegressionPassed, mode: oracle.mode },
    'Execution baseline established'
  );
  return { oracleFailsOnBase, baseRegressionPassed };
}
