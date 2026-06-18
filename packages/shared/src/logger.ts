import type { Logger } from 'pino';
import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';
const level = process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info');

// Build transport targets. Console stays pretty in dev; when LOG_FILE is set
// we additionally tee newline-delimited JSON to that file (analysis-friendly:
// grep/jq, or `pino-pretty < file` to re-colorize). Both sinks run together.
const targets: pino.TransportTargetOptions[] = [];
if (isDev) {
  targets.push({
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss.l',
      ignore: 'pid,hostname',
    },
  });
}
if (process.env.LOG_FILE) {
  targets.push({
    target: 'pino/file',
    options: { destination: process.env.LOG_FILE, mkdir: true },
  });
}

export const loggerConfig: pino.LoggerOptions = {
  level,
  // No targets → no transport: prod with no LOG_FILE keeps emitting JSON to
  // stdout exactly as before.
  ...(targets.length > 0 ? { transport: { targets } } : {}),
};

export const logger: Logger = pino(loggerConfig);

export function createLogger(
  name: string,
  context?: Record<string, unknown>
): Logger {
  return logger.child({ module: name, ...context });
}

export type { Logger } from 'pino';
