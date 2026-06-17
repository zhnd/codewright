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

  // 3. Regression
  const runner = await detectTestRunner(sandbox);
  let regressionCheck: FilterCheckResult | undefined;
  if (runner.hasTestInfra && runner.testCommand) {
    regressionCheck = await runCheck('regression', runner.testCommand, () =>
      sandbox.exec(runner.testCommand as string, { timeoutMs: 600_000 })
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

async function runBuildIfPossible(
  sandbox: Awaited<ReturnType<typeof connectSandbox>>
): Promise<FilterCheckResult | undefined> {
  // Try a sequence; the first that looks applicable wins.
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
