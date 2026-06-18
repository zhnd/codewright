import { prisma } from '@torin/database';
import type {
  DefectAnalysis,
  FilterCheckResult,
  ReproductionOracle,
  ResolutionResult,
} from '@torin/domain';
import { connectSandbox, type SandboxState } from '@torin/sandbox';
import { decrypt, getEncryptionKey } from '@torin/shared';
import { log } from '../logger.js';
import { bootVerify } from '../utils/boot-verify.js';
import { checkScope, formatScopeFeedback } from '../utils/scope-check.js';
import { detectTestRunner } from '../utils/test-runner-detect.js';
import type { BaselineSnapshot } from './establish-baseline.js';

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
            TORIN_GIT_TOKEN: decrypt(
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

async function runCheck(
  name: string,
  label: string,
  fn: () => Promise<{
    success: boolean;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    truncated: boolean;
  }>
): Promise<FilterCheckResult> {
  const start = Date.now();
  try {
    const r = await fn();
    return {
      name,
      passed: r.success,
      durationMs: Date.now() - start,
      output: truncate(joinOutput(r.stdout, r.stderr)),
    };
  } catch (err) {
    return {
      name,
      passed: false,
      durationMs: Date.now() - start,
      output: `${label}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Decide whether a non-passing regression run is a TRUSTWORTHY verdict
 * (the suite ran and tests genuinely failed) versus a run that never got
 * off the ground (missing deps, repo config/collection errors, no tests).
 * The latter must not be treated as a regression — it's a sandbox/harness
 * limitation, not a defect in the patch.
 *
 *   - exit 0                → ran, passed (trustworthy)
 *   - "could not run" marks → NOT trustworthy (drop to no-signal)
 *   - pytest exits 2–5      → usage/collection/internal/no-tests → NOT trustworthy
 *   - otherwise (e.g. 1)    → genuine test failures → trustworthy gate
 */
function regressionProducedVerdict(
  exitCode: number | null,
  output: string
): boolean {
  if (exitCode === 0) return true;
  const couldNotRun =
    /ModuleNotFoundError|No module named|ImportError|unrecognized arguments|Unknown config option|INTERNALERROR|collected 0 items|no tests ran|command not found|: not found|^usage:/im.test(
      output
    );
  if (couldNotRun) return false;
  // pytest reserves 2–5 for non-(test-failure) conditions; 1 == real failures.
  if (exitCode !== null && exitCode >= 2) return false;
  return true;
}

async function runBuildIfPossible(
  sandbox: Awaited<ReturnType<typeof connectSandbox>>
): Promise<FilterCheckResult | undefined> {
  // Prefer the repo's OWN typecheck script. A bare root `tsc --noEmit`
  // misfires on real monorepos (project references, turbo orchestration,
  // generated clients like prisma) — the repo's `typecheck` script knows how
  // to do it correctly. (Build is advisory, so even a noisy result won't gate.)
  const pkgRaw = await readFileSafe(sandbox, 'package.json');
  if (pkgRaw) {
    const scripts = (safeJsonObject(pkgRaw)?.scripts ?? {}) as Record<
      string,
      string
    >;
    if (typeof scripts.typecheck === 'string' && scripts.typecheck.trim()) {
      const pm = await detectPackageManager(sandbox);
      const cmd = `${pm} run typecheck`;
      return runCheck('build', cmd, () =>
        sandbox.exec(cmd, { timeoutMs: 300_000 })
      );
    }
  }

  // Fallback probes for repos without a typecheck script.
  const attempts: Array<{ label: string; cmd: string; probe: string }> = [
    { label: 'tsc', cmd: 'npx -y tsc --noEmit', probe: 'tsconfig.json' },
    { label: 'cargo check', cmd: 'cargo check', probe: 'Cargo.toml' },
    { label: 'go build', cmd: 'go build ./...', probe: 'go.mod' },
  ];
  for (const a of attempts) {
    const has = await fileExists(sandbox, a.probe);
    if (!has) continue;
    return runCheck('build', a.label, () =>
      sandbox.exec(a.cmd, { timeoutMs: 300_000 })
    );
  }
  return undefined;
}

async function readFileSafe(
  sandbox: Awaited<ReturnType<typeof connectSandbox>>,
  path: string
): Promise<string | null> {
  try {
    return await sandbox.readFile(path);
  } catch {
    return null;
  }
}

function safeJsonObject(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function detectPackageManager(
  sandbox: Awaited<ReturnType<typeof connectSandbox>>
): Promise<string> {
  if (await fileExists(sandbox, 'pnpm-lock.yaml')) return 'pnpm';
  if (await fileExists(sandbox, 'bun.lockb')) return 'bun';
  if (await fileExists(sandbox, 'yarn.lock')) return 'yarn';
  return 'npm';
}

async function runLintIfPossible(
  sandbox: Awaited<ReturnType<typeof connectSandbox>>
): Promise<FilterCheckResult | undefined> {
  const attempts: Array<{ cmd: string; probe: string }> = [
    { cmd: 'npx -y biome check .', probe: 'biome.json' },
    { cmd: 'npx -y eslint .', probe: '.eslintrc.json' },
    { cmd: 'npx -y eslint .', probe: 'eslint.config.js' },
    { cmd: 'npx -y eslint .', probe: 'eslint.config.mjs' },
    { cmd: 'ruff check .', probe: 'ruff.toml' },
    { cmd: 'ruff check .', probe: 'pyproject.toml' },
    { cmd: 'cargo clippy -- -D warnings', probe: 'Cargo.toml' },
  ];
  for (const a of attempts) {
    if (!(await fileExists(sandbox, a.probe))) continue;
    return runCheck('lint', a.cmd, () =>
      sandbox.exec(a.cmd, { timeoutMs: 180_000 })
    );
  }
  return undefined;
}

async function fileExists(
  sandbox: Awaited<ReturnType<typeof connectSandbox>>,
  path: string
): Promise<boolean> {
  try {
    await sandbox.stat(path);
    return true;
  } catch {
    return false;
  }
}

function joinOutput(stdout: string, stderr: string): string {
  return [stdout, stderr].filter(Boolean).join('\n');
}

function truncate(text: string, max = 5_000): string {
  if (text.length <= max) return text;
  return `${text.slice(-max)}\n...[truncated]`;
}

function summarizeFailures(failed: FilterCheckResult[]): string {
  const lines: string[] = ['One or more automated checks failed:'];
  for (const f of failed) {
    lines.push('', `### ${f.name} (failed in ${f.durationMs}ms)`);
    if (f.output) lines.push('```', f.output, '```');
  }
  lines.push(
    '',
    'Fix these issues in your next attempt. Stay within scopeDeclaration.'
  );
  return lines.join('\n');
}
