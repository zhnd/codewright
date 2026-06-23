export type Subscriber = () => void;

/**
 * Async generator that yields once per debounced NOTIFY for a given key.
 *
 * Registers a throttled subscriber in `subscribers[key]` (the first NOTIFY
 * schedules a yield after `debounceMs`; further NOTIFYs while that timer is
 * pending coalesce), bridges a NOTIFY that lands mid-yield via a `pending`
 * flag so it isn't dropped, and removes its Set entry on abort / return.
 *
 * Shared by the task status plane ({@link TaskPubSub}, per-taskId and
 * per-userId fanout) and the agent-message data plane
 * ({@link AgentMessagePubSub}); callers `await ensureReady()` before
 * delegating with `yield*`.
 */
export async function* debouncedSubscription(
  subscribers: Map<string, Set<Subscriber>>,
  key: string,
  debounceMs: number,
  signal?: AbortSignal
): AsyncIterable<void> {
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
    }, debounceMs);
  };

  let set = subscribers.get(key);
  if (!set) {
    set = new Set();
    subscribers.set(key, set);
  }
  set.add(fire);

  const cleanup = () => {
    closed = true;
    set?.delete(fire);
    if (set?.size === 0) subscribers.delete(key);
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
