import { prisma } from '@codewright/database';

function readString(obj: unknown, ...path: string[]): string | null {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === 'string' ? cur : null;
}

/**
 * Extract the SWE-bench `model_patch` (source-only unified diff) for a task.
 *
 * Reads the CRITIC stage's `resolution.diff` — which is persisted once
 * IMPLEMENT+CRITIC complete, BEFORE the PR/push stage. This matters for
 * SWE-bench: the repos are read-only for us, so the push stage fails and
 * the task ends FAILED, but the patch was already produced.
 *
 * Excludes the reproduction test file Codewright added — SWE-bench applies its
 * own gold `test_patch`, so our test file would be redundant or conflict.
 */
export async function extractModelPatch(
  taskId: string
): Promise<string | null> {
  const critic = await prisma.taskEvent.findFirst({
    where: { taskId, kind: 'STAGE', stageKey: 'CRITIC' },
    orderBy: { startedAt: 'desc' },
    select: { output: true },
  });
  const out = critic?.output;
  if (!out || typeof out !== 'object') return null;
  const o = out as Record<string, unknown>;

  const resolution =
    o.resolution && typeof o.resolution === 'object'
      ? (o.resolution as Record<string, unknown>)
      : o;
  const diff = resolution.diff;
  if (!Array.isArray(diff)) return null;

  const oracleFile = readString(o, 'reproductionOracle', 'filePath');

  const patches: string[] = [];
  for (const d of diff) {
    if (!d || typeof d !== 'object') continue;
    const rec = d as Record<string, unknown>;
    if (oracleFile && rec.file === oracleFile) continue;
    if (typeof rec.patch === 'string' && rec.patch.trim()) {
      patches.push(rec.patch);
    }
  }
  if (patches.length === 0) return null;
  return `${patches.join('\n').trimEnd()}\n`;
}
