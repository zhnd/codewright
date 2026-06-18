import type { ReproductionOracle } from '@codewright/domain';
import { connectSandbox, type SandboxState } from '@codewright/sandbox';
import { log } from '../logger.js';

/**
 * Re-materialize the reproduction oracle file onto the current tree and
 * commit it.
 *
 * Used after a per-sample sandbox reset in IMPLEMENT: the reset
 * (`git reset --hard origin/<base>`) discards the oracle commit made
 * during REPRODUCE, so without this every Best-of-N candidate after the
 * first runs FILTER against only the pre-existing tests — the actual
 * bug-reproducing test is gone, and `oracleVerified` becomes a false
 * positive. Restoring it guarantees each candidate is verified against
 * the SAME reproduction the baseline established.
 */
export async function applyOracleActivity(
  state: SandboxState,
  oracle: ReproductionOracle
): Promise<void> {
  if (!oracle.filePath || oracle.content === undefined) return;
  const sandbox = await connectSandbox(state);

  await sandbox.writeFile(oracle.filePath, oracle.content);

  const add = await sandbox.exec(`git add -- ${shellQuote(oracle.filePath)}`, {
    timeoutMs: 15_000,
  });
  if (!add.success) {
    throw new Error(
      `git add failed for oracle file '${oracle.filePath}': ${add.stderr || add.stdout}`
    );
  }

  const commit = await sandbox.exec(
    'git commit -m "test: restore reproduction oracle"',
    { timeoutMs: 15_000 }
  );
  // `git commit` exits non-zero when there is nothing to commit — that
  // means the oracle was already present (e.g. no reset happened). Treat
  // it as success.
  if (!commit.success) {
    const combined = `${commit.stdout}\n${commit.stderr}`;
    if (/nothing.*to commit|no changes added/i.test(combined)) {
      log.info(
        { filePath: oracle.filePath },
        'Oracle already present; nothing to restore'
      );
      return;
    }
    throw new Error(
      `git commit failed for oracle file '${oracle.filePath}': ${commit.stderr || commit.stdout}`
    );
  }
  log.info(
    { filePath: oracle.filePath },
    'Reproduction oracle restored after reset'
  );
}

function shellQuote(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`;
}
