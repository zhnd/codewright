import { prisma } from '@codewright/database';
import type {
  DefectAnalysis,
  FilterCheckResult,
  ReproductionOracle,
  ResolutionResult,
} from '@codewright/domain';
import { connectSandbox, type SandboxState } from '@codewright/sandbox';
import { decrypt, getEncryptionKey } from '@codewright/shared';
import { log } from '../logger.js';
import { bootVerify } from '../utils/boot-verify.js';
import { checkScope, formatScopeFeedback } from '../utils/scope-check.js';
import { detectTestRunner } from '../utils/test-runner-detect.js';
import type { BaselineSnapshot } from './establish-baseline.js';
import {
  joinOutput,
  regressionProducedVerdict,
  runBuildIfPossible,
  runCheck,
  runLintIfPossible,
  summarizeFailures,
  truncate,
} from './filter-candidate-checks.js';

export interface FilterCandidateInput {
  state: SandboxState;
  analysis: DefectAnalysis;
  oracle: ReproductionOracle | null;
  resolution: ResolutionResult;
  projectId: string;
  /**
   * Execution baseline from {@link establishBaselineActivity}, used to
   * verify a real FAIL_TO_PASS delta rather than trusting that the oracle
   * merely passes on the patched tree.
   */
  baseline?: BaselineSnapshot;
}

export interface FilterCandidateResult {
  scopeClean: boolean;
  scopeViolations: string[];
  unauthorizedLockfiles: string[];
  oracleCheck?: FilterCheckResult;
  /**
   * True iff the oracle FAILED on the unpatched base AND passes here — a
   * verified FAIL_TO_PASS delta. `false` = base failed but the patch
   * still fails it. `undefined` = unverifiable (no baseline, or the
   * oracle is untrustworthy because it already passed on base). Selection
   * trusts this, NOT raw `oracleCheck.passed`.
   */
  oracleVerified?: boolean;
  regressionCheck?: FilterCheckResult;
  buildCheck?: FilterCheckResult;
  lintCheck?: FilterCheckResult;
  bootCheck?: FilterCheckResult;
  previewUrl?: string;
  overallPassed: boolean;
  /** Feedback string to pass back into IMPLEMENT on failure. */
  failureSummary?: string;
}

/**
 * Apply every automated gate after IMPLEMENT produces a candidate patch:
 *   1. Scope + lockfile mechanical check (fast-fail)
 *   2. Reproduction oracle, if any
 *   3. Regression test suite, if detected
 *   4. Build / typecheck
 *   5. Lint
 *   6. Boot verification for web projects with Project.previewCommand set
 *
 * Records a structured FilterCandidateResult that drives the workflow's
 * accept/retry decision.
 */
export async function filterCandidateActivity(
  input: FilterCandidateInput
): Promise<FilterCandidateResult> {
  const { state, analysis, oracle, resolution, projectId } = input;
  log.info({ filesChanged: resolution.filesChanged.length }, 'Filter starting');

  const scope = checkScope(resolution.filesChanged, analysis.scopeDeclaration, {
    reproTestFile:
      oracle?.mode === 'test-framework' || oracle?.mode === 'verify-script'
        ? oracle.filePath
        : undefined,
  });

  if (!scope.clean) {
    const summary = formatScopeFeedback(scope);
    log.warn(
      { outOfScope: scope.outOfScope, lockfiles: scope.unauthorizedLockfiles },
      'Scope violation'
    );
    return {
      scopeClean: false,
      scopeViolations: scope.outOfScope,
      unauthorizedLockfiles: scope.unauthorizedLockfiles,
      overallPassed: false,
      failureSummary: summary,
    };
  }

  const sandbox = await connectSandbox(state);

  // 2. Oracle
  let oracleCheck: FilterCheckResult | undefined;
  if (oracle && oracle.mode !== 'none' && oracle.runCommand) {
    oracleCheck = await runCheck('oracle', oracle.runCommand, () =>
      sandbox.exec(oracle.runCommand, { timeoutMs: 300_000 })
    );
  }

  // Verify a real FAIL_TO_PASS delta: only trust the oracle as proof of
  // a fix when it FAILED on the unpatched base (established once per task)
  // AND passes here. Otherwise it is unverifiable — a no-op oracle that
  // passes on base proves nothing.
  const oracleVerified =
    oracleCheck !== undefined && input.baseline?.oracleFailsOnBase === true
      ? oracleCheck.passed
      : undefined;

  // 3. Regression — baseline-differential. Only RUN it when the suite was
  // GREEN on the unpatched base (established once per task): then a failure
  // here is a real regression the patch introduced → trustworthy gate. If the
  // suite wasn't green on base (env-flaky, pre-existing failures, or couldn't
  // even start — common on big real repos), re-running it proves nothing AND
  // burns the full timeout, so we skip it entirely → no signal (non-gating).
  // Even when we do run it, a "couldn't run" result is dropped to no-signal.
  const runner = await detectTestRunner(sandbox);
  let regressionCheck: FilterCheckResult | undefined;
  if (
    runner.hasTestInfra &&
    runner.testCommand &&
    input.baseline?.baseRegressionPassed === true
  ) {
    const start = Date.now();
    const r = await sandbox.exec(runner.testCommand, { timeoutMs: 600_000 });
    const output = truncate(joinOutput(r.stdout, r.stderr));
    if (regressionProducedVerdict(r.exitCode, joinOutput(r.stdout, r.stderr))) {
      regressionCheck = {
        name: 'regression',
        passed: r.success,
        durationMs: Date.now() - start,
        output,
      };
    } else {
      log.warn(
        { testCommand: runner.testCommand, output: output.slice(-600) },
        'Regression suite could not run (env/collection error) — treating as no signal, not a failure'
      );
    }
  } else if (runner.hasTestInfra && runner.testCommand) {
    log.info(
      { baseRegressionPassed: input.baseline?.baseRegressionPassed },
      'Skipping regression: suite was not green on the unpatched base — a failure would not be attributable to the patch'
    );
  }

  // 4. Build / typecheck — best-effort; pnpm build / tsc / cargo check / go build
  const buildCheck = await runBuildIfPossible(sandbox);

  // 5. Lint — best-effort
  const lintCheck = await runLintIfPossible(sandbox);

  // 6. Boot verify for web projects with preview config
  let bootCheck: FilterCheckResult | undefined;
  let previewUrl: string | undefined;
  if (analysis.hasWebUI) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });
    const previewCommand = project?.previewCommand;
    const previewPort = project?.previewPort;
    if (previewCommand && previewPort) {
      const env = project?.encryptedCredentials
        ? {
            CODEWRIGHT_GIT_TOKEN: decrypt(
              project.encryptedCredentials,
              getEncryptionKey()
            ),
          }
        : undefined;
      const start = Date.now();
      try {
        const result = await bootVerify(sandbox, {
          command: previewCommand,
          port: previewPort,
          readyPattern: project?.previewReadyPattern ?? undefined,
          env,
        });
        bootCheck = {
          name: 'boot',
          passed: result.ready,
          durationMs: result.durationMs,
          output: result.errorSummary
            ? `${result.errorSummary}\n\n---logs---\n${result.logs}`
            : truncate(result.logs),
        };
        previewUrl = result.url;
      } catch (err) {
        bootCheck = {
          name: 'boot',
          passed: false,
          durationMs: Date.now() - start,
          output: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }

  const checks = [
    oracleCheck,
    regressionCheck,
    buildCheck,
    lintCheck,
    bootCheck,
  ].filter((c): c is FilterCheckResult => c !== undefined);
  const failed = checks.filter((c) => !c.passed);
  const overallPassed = failed.length === 0;

  const result: FilterCandidateResult = {
    scopeClean: true,
    scopeViolations: [],
    unauthorizedLockfiles: [],
    oracleCheck,
    oracleVerified,
    regressionCheck,
    buildCheck,
    lintCheck,
    bootCheck,
    previewUrl,
    overallPassed,
    failureSummary: overallPassed ? undefined : summarizeFailures(failed),
  };

  log.info(
    {
      overallPassed,
      checks: checks.map((c) => ({ name: c.name, passed: c.passed })),
    },
    'Filter complete'
  );
  return result;
}
