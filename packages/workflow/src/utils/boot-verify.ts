import type { Sandbox } from '@codewright/sandbox';

const DEFAULT_READY_PATTERNS = [
  'ready in',
  'ready - started server on',
  'Local:',
  'server started',
  'listening on',
  'Local:        http',
];

const ERROR_PATTERNS = [
  /^Error:/m,
  /TypeError:/,
  /ReferenceError:/,
  /SyntaxError:/,
  /Failed to compile/,
  /Module not found/,
  /Cannot find module/,
  /EADDRINUSE/,
];

export interface BootVerifyOptions {
  command: string;
  port: number;
  readyPattern?: string;
  cwd?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  env?: Record<string, string>;
}

export interface BootVerifyResult {
  ready: boolean;
  url?: string;
  errorSummary?: string;
  logs: string;
  durationMs: number;
}

/**
 * Start a dev server in the sandbox, wait for a ready signal in its logs,
 * scan the startup window for known error patterns, and return an
 * outcome. The server is left running on success so HITL can poll the URL.
 */
export async function bootVerify(
  sandbox: Sandbox,
  options: BootVerifyOptions
): Promise<BootVerifyResult> {
  if (!sandbox.execDetached) {
    throw new Error('Sandbox provider does not support execDetached');
  }
  if (!sandbox.domain) {
    throw new Error('Sandbox provider does not support domain');
  }

  const timeoutMs = options.timeoutMs ?? 60_000;
  const pollMs = options.pollIntervalMs ?? 1_000;
  const readyPatterns = options.readyPattern
    ? [options.readyPattern]
    : DEFAULT_READY_PATTERNS;

  const start = Date.now();
  const { logFile } = await sandbox.execDetached(options.command, {
    cwd: options.cwd,
    env: options.env,
  });

  while (Date.now() - start < timeoutMs) {
    await sleep(pollMs);
    const logs = await readLogSafe(sandbox, logFile);

    const errorHit = findError(logs);
    if (errorHit) {
      return {
        ready: false,
        errorSummary: errorHit,
        logs: truncateLogs(logs),
        durationMs: Date.now() - start,
      };
    }

    if (readyPatterns.some((p) => logs.includes(p))) {
      const url = sandbox.domain(options.port);
      return {
        ready: true,
        url,
        logs: truncateLogs(logs),
        durationMs: Date.now() - start,
      };
    }
  }

  const logs = await readLogSafe(sandbox, logFile);
  return {
    ready: false,
    errorSummary: `Timed out waiting for ready pattern after ${timeoutMs}ms`,
    logs: truncateLogs(logs),
    durationMs: Date.now() - start,
  };
}

async function readLogSafe(sandbox: Sandbox, path: string): Promise<string> {
  try {
    return await sandbox.readFile(path);
  } catch {
    return '';
  }
}

function findError(logs: string): string | null {
  for (const pattern of ERROR_PATTERNS) {
    const match = logs.match(pattern);
    if (match) {
      const idx = logs.indexOf(match[0]);
      return logs.slice(idx, idx + 300);
    }
  }
  return null;
}

function truncateLogs(logs: string, max = 5_000): string {
  if (logs.length <= max) return logs;
  return `${logs.slice(-max)}\n...[truncated]`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
