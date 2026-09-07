import { local } from '../storage/local';
import { signal } from './signals';

/**
 * Play queue — "up next", across feeds and across sessions.
 *
 * It used to be a bare list of trackIds scoped to the loaded feed, and
 * `openFeed` cleared it: opening any podcast silently destroyed whatever the
 * user had lined up. An entry now carries its own feed id and the labels the
 * queue view needs, so a queued episode survives navigating away, opening
 * another show, and a reload.
 */

export interface QueueItem {
  /** `<itunesId>` | `rss:<url>` | `yt:<type>:<id>` — see feeds/feed-id.ts. */
  feedId: string;
  trackId: string;
  /** Captured at enqueue time: the queue must render without loading the feed. */
  title: string;
  feedName: string;
}

const STORE_KEY = 'pp_queue';

/**
 * When the queue was last changed. One stamp for the whole list, because sync
 * replaces the queue wholesale rather than merging it item by item — two
 * independently reordered lists merged element-wise produce an order neither
 * user asked for.
 */
const AT_KEY = 'pp_queue_at';

let queueAt = 0;

export const queue = signal<QueueItem[]>([]);

/** Identity of a queued episode. Titles are labels and never part of it. */
export function sameItem(a: { feedId: string; trackId: string }, b: { feedId: string; trackId: string }): boolean {
  return a.feedId === b.feedId && a.trackId === b.trackId;
}

function persist(list: QueueItem[]): void {
  queue.set(list);
  queueAt = Date.now();
  local.set(STORE_KEY, list);
  local.set(AT_KEY, queueAt);
}

/** What sync reads. */
export function queueSnapshot(): { list: QueueItem[]; at: number } {
  return { list: queue().slice(), at: queueAt };
}

/**
 * Apply a merged queue, keeping the merge's own timestamp. Not `persist`, which
 * would restamp the other device's queue as if it had just been reordered here.
 */
export function setQueueStamped(list: QueueItem[], at: number): void {
  queue.set(list);
  queueAt = at;
  local.set(STORE_KEY, list);
  local.set(AT_KEY, at);
}

/** Restore the persisted queue. Malformed entries are dropped, not thrown on. */
export function loadQueue(): void {
  const saved = local.get<unknown>(STORE_KEY, []);
  if (!Array.isArray(saved)) {
    queue.set([]);
    return;
  }
  const clean: QueueItem[] = [];
  for (const row of saved) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Partial<QueueItem>;
    if (typeof r.feedId !== 'string' || typeof r.trackId !== 'string') continue;
    if (!r.feedId || !r.trackId) continue;
    if (clean.some((x) => sameItem(x, r as QueueItem))) continue;
    clean.push({
      feedId: r.feedId,
      trackId: r.trackId,
      title: typeof r.title === 'string' ? r.title : '',
      feedName: typeof r.feedName === 'string' ? r.feedName : '',
    });
  }
  queue.set(clean);
  const at = local.get<unknown>(AT_KEY, 0);
  queueAt = typeof at === 'number' && Number.isFinite(at) ? at : 0;
}

export function enqueue(item: QueueItem): void {
  const list = queue();
  if (list.some((x) => sameItem(x, item))) return;
  persist([...list, item]);
}

export function removeFromQueue(ref: { feedId: string; trackId: string }): void {
  persist(queue().filter((x) => !sameItem(x, ref)));
}

/** Position in the queue (1-based), or 0 when not queued. */
export function queuePosition(ref: { feedId: string; trackId: string }): number {
  return queue().findIndex((x) => sameItem(x, ref)) + 1;
}

/**
 * 1-based positions for one feed's episodes, keyed by trackId. Use this instead
 * of calling `queuePosition` per row, which is O(items × queue).
 */
export function queuePositions(feedId: string): Map<string, number> {
  const m = new Map<string, number>();
  queue().forEach((item, i) => {
    if (item.feedId === feedId) m.set(item.trackId, i + 1);
  });
  return m;
}

/** Pop the next queued item (skipping the episode that just ended). */
export function dequeueNext(justEnded?: { feedId: string; trackId: string }): QueueItem | undefined {
  const rest = justEnded ? queue().filter((x) => !sameItem(x, justEnded)) : queue().slice();
  const next = rest[0];
  persist(rest.slice(1));
  return next;
}

/** Move a queued item one step up (-1) or down (+1); no-op at the edges. */
export function moveInQueue(ref: { feedId: string; trackId: string }, dir: -1 | 1): void {
  const q = queue();
  const i = q.findIndex((x) => sameItem(x, ref));
  const j = i + dir;
  const a = q[i];
  const b = q[j];
  if (i < 0 || a === undefined || b === undefined) return;
  const next = q.slice();
  next[i] = b;
  next[j] = a;
  persist(next);
}

export function clearQueue(): void {
  persist([]);
}
