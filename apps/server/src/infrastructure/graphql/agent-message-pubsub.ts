import { Client } from 'pg';
import { log } from '../../logger.js';

/**
 * Postgres LISTEN-backed pub/sub for the agent message log data plane.
 * Separate channel + connection from {@link TaskPubSub} so the
 * high-frequency message stream never collapses into the status plane's
 * 250ms debounce (and vice versa).
 *
 * Debounce is a short micro-batch window (leading edge fires fast for a
 * low first-token latency / "alive" feel; a brief trailing window
 * coalesces tool-storms). Subscribers receive a signal only; the
 * subscription then pulls rows with `cursor > lastSeen`.
 */
const CHANNEL = 'codewright_agent_messages';
const DEBOUNCE_MS = Number(process.env.AGENT_MESSAGE_DEBOUNCE_MS ?? 80);

type Subscriber = () => void;

class AgentMessagePubSub {
  private ready: Promise<void> | null = null;
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  private async ensureReady(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) {
        throw new Error('agent-message pubsub: DATABASE_URL is not set');
      }
      const client = new Client({ connectionString });
      await client.connect();
      client.on('notification', (msg) => {
        if (msg.channel !== CHANNEL || !msg.payload) return;
        let parsed: { taskId?: string; cursor?: string } = {};
        try {
          parsed = JSON.parse(msg.payload);
        } catch {
          log.warn(
            { payload: msg.payload },
            'agent-message pubsub: bad payload'
          );
          return;
        }
        if (!parsed.taskId) return;
        const set = this.subscribers.get(parsed.taskId);
        if (!set) return;
        for (const fn of set) fn();
      });
      client.on('error', (err) => {
        log.error({ err }, 'agent-message pubsub: client error');
      });
      await client.query(`LISTEN ${CHANNEL}`);
      log.info({ channel: CHANNEL }, 'agent-message pubsub: listening');
    })();
    return this.ready;
  }

  /**
   * Yields each time new messages for `taskId` arrive, micro-batched at
   * {@link DEBOUNCE_MS} with a leading edge. A `pending` flag bridges the
   * window between yields so a NOTIFY mid-processing isn't dropped.
   */
  async *iterate(taskId: string, signal?: AbortSignal): AsyncIterable<void> {
    await this.ensureReady();

    let resolveNext: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending = false;
    let closed = false;

    const fire: Subscriber = () => {
      if (closed || timer) return;
      timer = setTimeout(() => {
        timer = null;
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
      if (timer) clearTimeout(timer);
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

export const agentMessagePubSub = new AgentMessagePubSub();
