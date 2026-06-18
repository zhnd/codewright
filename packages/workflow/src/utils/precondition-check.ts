import type { Sandbox } from '@codewright/sandbox';

export interface PreconditionViolation {
  kind:
    | 'scope-file-missing'
    | 'test-file-deleted'
    | 'working-tree-dirty'
    | 'required-file-gone';
  detail: string;
}

export interface PreconditionCheckResult {
  clean: boolean;
  violations: PreconditionViolation[];
}

/**
 * Pre-IMPLEMENT guardrail. Runs BEFORE a retry attempt, surfaces any
 * structural problems the previous attempt created, and lets the
 * workflow reject the retry or inject the violations into the next
 * prompt as a hard "do not repeat" signal.
 *
 * This is the SWE-agent +3 pts guardrail pattern, adapted to our
 * distributed workflow: instead of blocking an edit in-conversation, we
 * block at the stage boundary and feed the violation back.
 */
export async function checkPreconditions(
  sandbox: Sandbox,
  input: {
    /** Files the next attempt is allowed to touch. */
    scopeDeclaration: string[];
    /** Test files that must still exist after the previous attempt. */
    existingTestFiles?: string[];
    /** Other files that must still exist (e.g., the reproduction oracle path). */
    requiredFiles?: string[];
    /** If true, a dirty working tree is an error. Default: true. */
    requireCleanTree?: boolean;
  }
): Promise<PreconditionCheckResult> {
  const violations: PreconditionViolation[] = [];

  for (const file of input.scopeDeclaration) {
    if (!(await fileExists(sandbox, file))) {
      violations.push({
        kind: 'scope-file-missing',
        detail: `Declared scope file '${file}' no longer exists in the working tree. A previous attempt may have deleted it.`,
      });
    }
  }

  if (input.existingTestFiles) {
    for (const file of input.existingTestFiles) {
      if (!(await fileExists(sandbox, file))) {
        violations.push({
          kind: 'test-file-deleted',
          detail: `Test file '${file}' was deleted by a previous attempt. Test files must never be removed.`,
        });
      }
    }
  }

  if (input.requiredFiles) {
    for (const file of input.requiredFiles) {
      if (!(await fileExists(sandbox, file))) {
        violations.push({
          kind: 'required-file-gone',
          detail: `Required file '${file}' is missing. A previous attempt removed it.`,
        });
      }
    }
  }

  const requireClean = input.requireCleanTree ?? true;
  if (requireClean) {
    const status = await sandbox.exec('git status --porcelain', {
      timeoutMs: 10_000,
    });
    if (status.success && status.stdout.trim().length > 0) {
      violations.push({
        kind: 'working-tree-dirty',
        detail: `Working tree has uncommitted changes:\n${status.stdout.trim().slice(0, 500)}\nReset with 'git reset --hard' before the next attempt.`,
      });
    }
  }

  return {
    clean: violations.length === 0,
    violations,
  };
}

async function fileExists(sandbox: Sandbox, path: string): Promise<boolean> {
  try {
    await sandbox.stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Render violations into a list of strings for retry-feedback's
 * preconditionViolations field.
 */
export function renderViolations(result: PreconditionCheckResult): string[] {
  return result.violations.map((v) => `[${v.kind}] ${v.detail}`);
}
