import type { Sandbox } from '@codewright/sandbox';

export interface TestRunnerInfo {
  hasTestInfra: boolean;
  frameworks: string[];
  testCommand?: string;
}

/**
 * Inspect the workspace to figure out if/how to run tests. Returns the
 * first command that looks viable based on detected config files; callers
 * can override via project settings if needed.
 */
export async function detectTestRunner(
  sandbox: Sandbox
): Promise<TestRunnerInfo> {
  const frameworks: string[] = [];
  let testCommand: string | undefined;

  const pkgJson = await readIfExists(sandbox, 'package.json');
  if (pkgJson) {
    const parsed = safeJsonParse(pkgJson);
    const deps = {
      ...((parsed?.dependencies ?? {}) as Record<string, string>),
      ...((parsed?.devDependencies ?? {}) as Record<string, string>),
    };
    if ('vitest' in deps) frameworks.push('vitest');
    if ('jest' in deps) frameworks.push('jest');
    if ('@playwright/test' in deps) frameworks.push('playwright');
    if ('mocha' in deps) frameworks.push('mocha');

    const scripts = (parsed?.scripts ?? {}) as Record<string, string>;
    if (typeof scripts.test === 'string' && scripts.test.trim().length > 0) {
      // Pick the package manager that matches the repo's lockfile.
      const pm = await detectJsPackageManager(sandbox);
      testCommand = `${pm} test`;
      // A test script by itself counts as test infra even if no recognized
      // framework lib is in deps — covers node's built-in `node --test`,
      // tape, ava-as-script, custom runners, etc.
      if (frameworks.length === 0) {
        if (/node\s+--test|node:test/.test(scripts.test)) {
          frameworks.push('node-test');
        } else {
          frameworks.push('npm-script');
        }
      }
    }
  }

  if (await exists(sandbox, 'pytest.ini')) frameworks.push('pytest');
  if (await exists(sandbox, 'tox.ini')) frameworks.push('pytest');
  const pyproject = await readIfExists(sandbox, 'pyproject.toml');
  if (pyproject?.includes('[tool.pytest')) frameworks.push('pytest');
  if (frameworks.includes('pytest') && !testCommand) testCommand = 'pytest';

  if (await exists(sandbox, 'Cargo.toml')) {
    frameworks.push('cargo-test');
    if (!testCommand) testCommand = 'cargo test';
  }

  if (await exists(sandbox, 'go.mod')) {
    frameworks.push('go-test');
    if (!testCommand) testCommand = 'go test ./...';
  }

  return {
    hasTestInfra: frameworks.length > 0 && !!testCommand,
    frameworks: Array.from(new Set(frameworks)),
    testCommand,
  };
}

async function detectJsPackageManager(sandbox: Sandbox): Promise<string> {
  if (await exists(sandbox, 'pnpm-lock.yaml')) return 'pnpm';
  if (await exists(sandbox, 'bun.lockb')) return 'bun';
  if (await exists(sandbox, 'yarn.lock')) return 'yarn';
  return 'npm';
}

async function exists(sandbox: Sandbox, path: string): Promise<boolean> {
  try {
    await sandbox.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readIfExists(
  sandbox: Sandbox,
  path: string
): Promise<string | null> {
  try {
    return await sandbox.readFile(path);
  } catch {
    return null;
  }
}

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}
