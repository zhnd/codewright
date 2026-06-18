import { Client } from 'pg';
import { log } from '../../logger.js';

/**
 * Postgres LISTEN-backed pub/sub for task events. One long-lived
 * `pg.Client` (separate from Prisma's pool) holds a LISTEN on a single
 * global channel; per-taskId fanout happens in memory. One channel
 * avoids hitting PG's per-identifier limits under tool-storms.
 *
 * Subscribers receive debounced refetch signals (250 ms trailing) so a
 * burst of NOTIFYs from a single agent run collapses to one refetch.
 */

const CHANNEL = 'codewright_task_events';
const DEBOUNCE_MS = 250;

type Subscriber = () => void;

class TaskPubSub {
  private ready: Promise<void> | null = null;
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  private async ensureReady(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) {
        throw new Error('pubsub: DATABASE_URL is not set');
      }
      const client = new Client({ connectionString });
      await client.connect();
      client.on('notification', (msg) => {
        if (msg.channel !== CHANNEL || !msg.payload) return;
        let parsed: { taskId?: string; kind?: string } = {};
        try {
          parsed = JSON.parse(msg.payload);
        } catch {
          log.warn({ payload: msg.payload }, 'pubsub: invalid payload');
          return;
        }
        if (!parsed.taskId) return;
        const set = this.subscribers.get(parsed.taskId);
        log.debug(
          {
            taskId: parsed.taskId,
            kind: parsed.kind,
            subscriberCount: set?.size ?? 0,
          },
          'pubsub: notification received'
        );
        if (!set) return;
        for (const fn of set) fn();
      });
      client.on('error', (err) => {
        log.error({ err }, 'pubsub: client error');
      });
      await client.query(`LISTEN ${CHANNEL}`);
      log.info({ channel: CHANNEL }, 'pubsub: listening');
    })();
    return this.ready;
  }

  /**
   * Returns an async iterator that yields each time a NOTIFY arrives
   * for the given taskId. Trailing-debounced at 250 ms per subscriber
   * so tool-storms collapse.
   *
   * A `pending` flag bridges the window between yields: if a NOTIFY
   * fires while the consumer is still processing the previous yield,
   * `resolveNext` is null and the naive approach would drop the event.
   * Instead we set `pending = true` so the next iteration yields
   * immediately without awaiting.
   */
  async *iterate(taskId: string, signal?: AbortSignal): AsyncIterable<void> {
    await this.ensureReady();

    let resolveNext: (() => void) | null = null;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;
    let pending = false;
    let closed = false;

    const fire: Subscriber = () => {
      if (closed) return;
      if (pendingTimer) return;
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        pending = true;
        const r = resolveNext;
        resolveNext = null;
        r?.();
      }, DEBOUNCE_MS);
    };

    let set = this.subscribers.get(taskId);
    if (!set) {
      set = new Set();
      this.subscribers.set(taskId, set);
    }
    set.add(fire);

    const cleanup = () => {
      closed = true;
      set?.delete(fire);
      if (set?.size === 0) this.subscribers.delete(taskId);
      if (pendingTimer) clearTimeout(pendingTimer);
      resolveNext?.();
    };
    signal?.addEventListener('abort', cleanup);

    try {
      while (!closed && !(signal?.aborted ?? false)) {
        if (!pending) {
          await new Promise<void>((r) => {
            resolveNext = r;
          });
        }
        if (closed) break;
        pending = false;
        yield;
      }
    } finally {
      cleanup();
    }
  }
}

export const taskPubSub = new TaskPubSub();
