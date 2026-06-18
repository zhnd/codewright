import { connectSandbox, type SandboxState } from '@codewright/sandbox';
import { log } from '../logger.js';

/**
 * Rename a local git branch inside the sandbox. Used by Best-of-N to
 * preserve each passing sample's branch under a sample-scoped name
 * (`codewright/cand-<round>-<sampleId>`) before the next sample or reset can
 * overwrite or delete it. `git branch -M` force-overwrites the
 * destination so re-running a workflow round does not trip on stale
 * candidates from the prior round.
 */
export async function renameBranchActivity(
  state: SandboxState,
  from: string,
  to: string
): Promise<void> {
  const sandbox = await connectSandbox(state);
  const r = await sandbox.exec(
    `git branch -M ${shellArg(from)} ${shellArg(to)}`,
    { timeoutMs: 10_000 }
  );
  if (!r.success) {
    throw new Error(
      `git branch -M ${from} ${to} failed: ${r.stderr || r.stdout}`
    );
  }
  log.info({ from, to }, 'Branch renamed');
}

function shellArg(input: string): string {
  return `'${input.replace(/'/g, `'\\''`)}'`;
}
