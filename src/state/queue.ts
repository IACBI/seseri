import { signal } from './signals';

/**
 * Play queue: episode trackIds queued for "up next" within the loaded feed.
 * Session-scoped — a new feed starts a fresh queue. When the queue is
 * non-empty it wins over plain auto-next ordering.
 */
export const queue = signal<string[]>([]);

export function enqueue(id: string): void {
  queue.update((q) => (q.includes(id) ? q : [...q, id]));
}

export function removeFromQueue(id: string): void {
  queue.update((q) => q.filter((x) => x !== id));
}

/** Position in the queue (1-based), or 0 when not queued. */
export function queuePosition(id: string): number {
  return queue().indexOf(id) + 1;
}

/** Pop the next queued id (skipping the episode that just ended). */
export function dequeueNext(justEndedId?: string): string | undefined {
  let next: string | undefined;
  queue.update((q) => {
    const rest = justEndedId ? q.filter((x) => x !== justEndedId) : q.slice();
    next = rest[0];
    return rest.slice(1);
  });
  return next;
}

/** Move a queued id one step up (-1) or down (+1); no-op at the edges. */
export function moveInQueue(id: string, dir: -1 | 1): void {
  queue.update((q) => {
    const i = q.indexOf(id);
    const j = i + dir;
    const a = q[i];
    const b = q[j];
    if (i < 0 || a === undefined || b === undefined) return q;
    const next = q.slice();
    next[i] = b;
    next[j] = a;
    return next;
  });
}

export function clearQueue(): void {
  queue.set([]);
}
