import type { FilterCheckResult } from '@codewright/domain';
import type { connectSandbox } from '@codewright/sandbox';

// Standalone check runners + sandbox/file helpers for filterCandidateActivity.
// Pure of any workflow/orchestration state — each takes an explicit sandbox.

type Sandbox = Awaited<ReturnType<typeof connectSandbox>>;

export async function runCheck(
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
export function regressionProducedVerdict(
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

export async function runBuildIfPossible(
  sandbox: Sandbox
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

export async function runLintIfPossible(
  sandbox: Sandbox
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

async function readFileSafe(
  sandbox: Sandbox,
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

async function detectPackageManager(sandbox: Sandbox): Promise<string> {
  if (await fileExists(sandbox, 'pnpm-lock.yaml')) return 'pnpm';
  if (await fileExists(sandbox, 'bun.lockb')) return 'bun';
  if (await fileExists(sandbox, 'yarn.lock')) return 'yarn';
  return 'npm';
}

export async function fileExists(
  sandbox: Sandbox,
  path: string
): Promise<boolean> {
  try {
    await sandbox.stat(path);
    return true;
  } catch {
    return false;
  }
}

export function joinOutput(stdout: string, stderr: string): string {
  return [stdout, stderr].filter(Boolean).join('\n');
}

export function truncate(text: string, max = 5_000): string {
  if (text.length <= max) return text;
  return `${text.slice(-max)}\n...[truncated]`;
}

export function summarizeFailures(failed: FilterCheckResult[]): string {
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
