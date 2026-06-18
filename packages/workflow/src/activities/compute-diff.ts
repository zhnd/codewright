import type { FileDiff } from '@torin/domain';
import { connectSandbox, type SandboxState } from '@torin/sandbox';
import { log } from '../logger.js';

function shellArg(input: string): string {
  return `'${input.replace(/'/g, `'\\''`)}'`;
}

/**
 * Snapshot the current HEAD sha. Captured BEFORE the implement agent runs so
 * we can later diff the agent's changes against the exact pre-fix tree (which
 * already contains the reproduction oracle, so the derived patch is fix-only).
 */
export async function captureHeadShaActivity(
  state: SandboxState
): Promise<string> {
  const sandbox = await connectSandbox(state);
  const r = await sandbox.exec('git rev-parse HEAD', { timeoutMs: 10_000 });
  return r.stdout.trim();
}

export interface ComputeDiffInput {
  state: SandboxState;
  /** Diff the current working tree against this ref (the pre-fix HEAD). */
  baseRef: string;
}

/**
 * Derive the CANONICAL, guaranteed-applyable patch from the sandbox via
 * `git diff`, instead of trusting the implement agent's hand-authored diff —
 * which routinely fails `git apply` (fabricated index lines, wrong hunk
 * headers, stripped whitespace). The agent edits files in the sandbox; git is
 * the rigorous serializer the model can't be.
 *
 * Stages everything first (`git add -A`) so newly-created files are included.
 * An EMPTY result means the agent claimed a fix but changed nothing on disk
 * (a no-op / "already fixed" hallucination) — the caller treats that as a
 * failed sample.
 */
export async function computeCanonicalDiffActivity(
  input: ComputeDiffInput
): Promise<FileDiff[]> {
  const sandbox = await connectSandbox(input.state);
  const base = shellArg(input.baseRef);
  await sandbox.exec('git add -A', { timeoutMs: 30_000 });

  const names = await sandbox.exec(`git diff --cached --name-only ${base}`, {
    timeoutMs: 30_000,
  });
  const files = names.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  // numstat in one shot: "<additions>\t<deletions>\t<file>".
  const numstat = await sandbox.exec(`git diff --cached --numstat ${base}`, {
    timeoutMs: 30_000,
  });
  const stats = new Map<string, { additions: number; deletions: number }>();
  for (const line of numstat.stdout.split('\n')) {
    const cols = line.split('\t');
    if (cols.length >= 3) {
      stats.set(cols.slice(2).join('\t'), {
        additions: Number.parseInt(cols[0], 10) || 0,
        deletions: Number.parseInt(cols[1], 10) || 0,
      });
    }
  }

  const out: FileDiff[] = [];
  for (const file of files) {
    const d = await sandbox.exec(
      `git diff --cached ${base} -- ${shellArg(file)}`,
      { timeoutMs: 30_000 }
    );
    const s = stats.get(file) ?? { additions: 0, deletions: 0 };
    out.push({
      file,
      reason: 'derived from git diff',
      additions: s.additions,
      deletions: s.deletions,
      patch: d.stdout,
    });
  }
  log.info(
    { baseRef: input.baseRef, files: files.length },
    'Computed canonical git diff'
  );
  return out;
}
