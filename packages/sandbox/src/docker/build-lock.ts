import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Build serialization for the two-tier repo image cache.
//
// In-process map guarantees a single build per key within this worker;
// flock on host fs serializes across multiple workers on the same host.

const LOCK_ROOT =
  process.env.LOCK_ROOT ?? path.join(os.tmpdir(), 'codewright', 'locks');

const inflight = new Map<string, Promise<void>>();

export async function withLock(
  key: string,
  fn: () => Promise<void>
): Promise<void> {
  const existing = inflight.get(key);
  if (existing) {
    await existing;
    // Re-enter after the other caller finished — they may have done the
    // work we were about to do, so the caller's own age/hit check will
    // short-circuit on the next iteration.
    return;
  }

  const promise = (async () => {
    const release = await acquireHostLock(key);
    try {
      await fn();
    } finally {
      release();
    }
  })();

  inflight.set(key, promise);
  try {
    await promise;
  } finally {
    inflight.delete(key);
  }
}

// Best-effort host-level lock using O_EXCL file creation + retry. Good
// enough for the rare case of two workers racing; not meant to be strictly
// correct under kernel crash.
async function acquireHostLock(key: string): Promise<() => void> {
  await fs.mkdir(LOCK_ROOT, { recursive: true });
  const lockPath = path.join(LOCK_ROOT, `${key}.lock`);
  const start = Date.now();
  const timeoutMs = 30 * 60 * 1000;

  while (true) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      await handle.write(`${process.pid}\n`);
      await handle.close();
      return () => {
        fs.unlink(lockPath).catch(() => {});
      };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw err;
      }
      // Stale lock detection: if the lock file is very old, assume the
      // holder crashed and take it over.
      const stat = await fs.stat(lockPath).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > timeoutMs) {
        await fs.unlink(lockPath).catch(() => {});
        continue;
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Timed out waiting for lock: ${key}`);
      }
      await sleep(500);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
