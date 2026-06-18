import { connectSandbox, type SandboxState } from '@codewright/sandbox';
import { log } from '../logger.js';

/**
 * Commit the reproduction oracle file so the sandbox's working tree is
 * clean before IMPLEMENT starts. Without this, REPRODUCE leaves an
 * uncommitted file in the tree and the precondition guardrail sees
 * `working-tree-dirty` on every IMPLEMENT retry.
 */
export async function commitOracleActivity(
  state: SandboxState,
  filePath: string
): Promise<void> {
  const sandbox = await connectSandbox(state);

  const add = await sandbox.exec(`git add -- ${shellQuote(filePath)}`, {
    timeoutMs: 15_000,
  });
  if (!add.success) {
    throw new Error(
      `git add failed for oracle file '${filePath}': ${add.stderr || add.stdout}`
    );
  }

  const commit = await sandbox.exec(
    'git commit -m "test: add failing reproduction"',
    { timeoutMs: 15_000 }
  );
  // `git commit` exits non-zero when there is nothing to commit — treat
  // that as success since the caller only cares that the file is tracked.
  if (!commit.success) {
    const combined = `${commit.stdout}\n${commit.stderr}`;
    if (/nothing.*to commit|no changes added/i.test(combined)) {
      log.info({ filePath }, 'Oracle file already committed; skipping');
      return;
    }
    throw new Error(
      `git commit failed for oracle file '${filePath}': ${commit.stderr || commit.stdout}`
    );
  }
  log.info({ filePath }, 'Oracle file committed');
}

function shellQuote(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`;
}
