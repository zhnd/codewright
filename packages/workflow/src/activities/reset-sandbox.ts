import { connectSandbox, type SandboxState } from '@torin/sandbox';
import { log } from '../logger.js';

export interface ResetSandboxInput {
  state: SandboxState;
  /**
   * Optional base branch. If omitted, the activity detects the default
   * branch via `git symbolic-ref refs/remotes/origin/HEAD`.
   */
  baseBranch?: string;
  /**
   * Pinned base commit (e.g. SWE-bench `base_commit`). When set, the reset
   * lands the base branch on THIS commit instead of `origin/<baseBranch>`.
   * Without it, every reset would jump to the latest default-branch tip —
   * which for an eval repo is years past the instance's base, where the
   * bug is already fixed and there is nothing to repair.
   */
  commit?: string;
  /** If true, also delete any `fix/*` branches. Default: true. */
  deleteFixBranches?: boolean;
}

export interface ResetSandboxResult {
  baseBranch: string;
}

/**
 * Reset the sandbox working tree between Best-of-N samples so sample
 * k+1 starts from a clean base:
 *   1. Detect (or use provided) base branch
 *   2. checkout it + reset --hard origin/<base>
 *   3. delete stale `fix/*` branches (best-effort)
 *
 * Auto-detects baseBranch so callers don't need to thread it through.
 */
export async function resetSandboxActivity(
  input: ResetSandboxInput
): Promise<ResetSandboxResult> {
  const sandbox = await connectSandbox(input.state);

  let baseBranch = input.baseBranch;
  if (!baseBranch) {
    const detect = await sandbox.exec(
      "git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo main",
      { timeoutMs: 10_000 }
    );
    baseBranch = detect.stdout.trim() || 'main';
  }

  log.info({ baseBranch, commit: input.commit }, 'Resetting sandbox');

  if (input.commit) {
    // Pinned base commit: point the base branch AT the commit and check it
    // out (`-B` creates/moves the branch). The commit is normally already
    // present from the create-sandbox checkout; fetch it if a prior prune
    // dropped it.
    let checkout = await sandbox.exec(
      `git checkout -f -B ${shellArg(baseBranch)} ${shellArg(input.commit)}`,
      { timeoutMs: 30_000 }
    );
    if (!checkout.success) {
      await sandbox.exec(
        `git fetch origin ${shellArg(input.commit)} --filter=blob:none`,
        { timeoutMs: 120_000 }
      );
      checkout = await sandbox.exec(
        `git checkout -f -B ${shellArg(baseBranch)} ${shellArg(input.commit)}`,
        { timeoutMs: 30_000 }
      );
    }
    if (!checkout.success) {
      throw new Error(
        `Reset to pinned commit ${input.commit} failed: ${checkout.stderr || checkout.stdout}`
      );
    }
  } else {
    const checkout = await sandbox.exec(
      `git checkout ${shellArg(baseBranch)} && git reset --hard origin/${shellArg(baseBranch)}`,
      { timeoutMs: 30_000 }
    );
    if (!checkout.success) {
      throw new Error(
        `Reset failed during checkout/reset: ${checkout.stderr || checkout.stdout}`
      );
    }
  }

  if (input.deleteFixBranches !== false) {
    await sandbox.exec(
      `git for-each-ref --format='%(refname:short)' refs/heads/fix/ | xargs -r git branch -D 2>/dev/null || true`,
      { timeoutMs: 10_000 }
    );
  }

  log.info({ baseBranch }, 'Sandbox reset complete');
  return { baseBranch };
}

function shellArg(input: string): string {
  return `'${input.replace(/'/g, `'\\''`)}'`;
}
