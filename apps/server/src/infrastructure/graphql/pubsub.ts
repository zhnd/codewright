import { Client } from 'pg';
import { log } from '../../logger.js';
import {
  debouncedSubscription,
  type Subscriber,
} from './debounced-subscription.js';

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

class TaskPubSub {
  private ready: Promise<void> | null = null;
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  // userId → subscribers, for the tasks-list subscription (any of a
  // user's tasks changing triggers a list refresh). Populated from the
  // `userId` field the NOTIFY payload now carries.
  private readonly userSubscribers = new Map<string, Set<Subscriber>>();

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
        let parsed: { taskId?: string; kind?: string; userId?: string } = {};
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
        if (set) for (const fn of set) fn();
        // List-plane fan-out: notify subscribers watching this user's tasks.
        if (parsed.userId) {
          const userSet = this.userSubscribers.get(parsed.userId);
          if (userSet) for (const fn of userSet) fn();
        }
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
   * for the given taskId. Debounced at 250 ms per subscriber so
   * tool-storms collapse.
   */
  async *iterate(taskId: string, signal?: AbortSignal): AsyncIterable<void> {
    await this.ensureReady();
    yield* debouncedSubscription(this.subscribers, taskId, DEBOUNCE_MS, signal);
  }

  /**
   * Like {@link iterate} but keyed by userId — yields whenever ANY of the
   * user's tasks changes. Backs the tasks-list subscription so the list
   * refreshes on status/stage changes instead of polling.
   */
  async *iterateUser(
    userId: string,
    signal?: AbortSignal
  ): AsyncIterable<void> {
    await this.ensureReady();
    yield* debouncedSubscription(
      this.userSubscribers,
      userId,
      DEBOUNCE_MS,
      signal
    );
  }
}

export const taskPubSub = new TaskPubSub();
