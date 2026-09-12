import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Episode, FeedMeta, ResolvedFeed } from '../feeds/types';

/**
 * IndexedDB layer. Scope note: settings/progress/subscriptions intentionally
 * stay in localStorage (tiny, sync access, legacy-compatible) — idb holds the
 * bulky data: cached feeds and offline-download metadata. Audio bytes live in
 * the Cache API bucket `seseri-audio` (see player/downloads.ts).
 */

export interface CachedFeed {
  /** FeedMeta id — `<itunesId>` | `rss:<url>` | `yt:<type>:<id>` */
  id: string;
  feed: ResolvedFeed;
  fetchedAt: number;
  /**
   * Roughly how much the record costs, in bytes.
   *
   * Measured once at write time, because IndexedDB will not tell us and the
   * number is needed to bound the store. It is an estimate — the length of the
   * serialised record, which is close for the mostly-ASCII text a feed
   * contains and wrong for a feed written in a script that needs three bytes a
   * character. Absent on records written before this field existed; those count
   * as zero and age out instead.
   */
  bytes?: number;
}

export interface DownloadRecord {
  /** Episode trackId. */
  id: string;
  feedId: string;
  title: string;
  bytes: number;
  addedAt: number;
  /**
   * True for a copy the app cached on its own to survive a backgrounded
   * network, false/absent for one the user asked for. Only ephemeral copies are
   * ever evicted, and the Downloads list hides them — deleting something the
   * user deliberately saved to reclaim space would be a betrayal.
   */
  ephemeral?: boolean;
}

/**
 * Just enough about one episode for the Home "continue listening" rail.
 *
 * Home used to reach this through `getCachedFeed`, which structured-clones a
 * feed's *entire* archive out of IndexedDB — for every subscription, on every
 * visit home — to read a single title and duration. This projection is one
 * small record per feed instead.
 */
export interface ResumeEntry {
  /** FeedMeta id, same key space as the `feeds` store. */
  id: string;
  meta: FeedMeta;
  episode: Episode;
  updatedAt: number;
}

interface SeseriDB extends DBSchema {
  feeds: { key: string; value: CachedFeed };
  downloads: { key: string; value: DownloadRecord };
  resume: { key: string; value: ResumeEntry };
}

/** Exported so `storage/reset.ts` deletes the same database this opens. */
export const DB_NAME = 'seseri';

const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<SeseriDB>> | null = null;

/**
 * Drop the cached connection so `indexedDB.deleteDatabase` can proceed.
 *
 * An open connection makes a delete fire `blocked` and wait indefinitely, so a
 * reset that does not close first hangs instead of wiping (see
 * `storage/reset.ts`). The next `db()` call simply opens again.
 */
export function closeDb(): void {
  const pending = dbPromise;
  dbPromise = null;
  if (!pending) return;
  void pending.then(
    (d) => d.close(),
    () => {
      /* never opened — nothing to close */
    },
  );
}

export function db(): Promise<IDBPDatabase<SeseriDB>> {
  if (!dbPromise) {
    dbPromise = openDB<SeseriDB>(DB_NAME, DB_VERSION, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          d.createObjectStore('feeds', { keyPath: 'id' });
          d.createObjectStore('downloads', { keyPath: 'id' });
        }
        if (oldVersion < 2) {
          d.createObjectStore('resume', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

// ── feed cache (stale-while-revalidate source) ─────────────────────
export async function getCachedFeed(id: string): Promise<CachedFeed | undefined> {
  try {
    return await (await db()).get('feeds', id);
  } catch {
    return undefined;
  }
}

/**
 * How long a cached feed is worth keeping.
 *
 * The cache exists to paint instantly and to work offline, and a copy this old
 * does neither usefully: the app refetches on open anyway (stale-while-
 * revalidate), and an archive from last spring is not what "offline" means.
 */
const FEED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Ceiling on the whole store.
 *
 * This became load-bearing with the Apple→RSS archive switch: a show that used
 * to cache 41 episodes now caches 2900, which is ~2.3 MB of records for one
 * feed. Nothing pruned this store before — only "clear all data" emptied it —
 * so every feed ever opened stayed forever, and the first thing to suffer from
 * the origin running out of quota is the downloads the listener chose to keep.
 */
const FEED_BUDGET_BYTES = 80 * 1024 * 1024;

/** Never prune below this, whatever the budget says. */
const FEED_KEEP_MIN = 5;

/** The policy in one object, so a test can drive it with small numbers. */
export const FEED_CACHE_LIMITS = {
  maxAgeMs: FEED_MAX_AGE_MS,
  budgetBytes: FEED_BUDGET_BYTES,
  keepMin: FEED_KEEP_MIN,
} as const;

function recordBytes(rec: CachedFeed): number {
  return typeof rec.bytes === 'number' && rec.bytes > 0 ? rec.bytes : 0;
}

/**
 * Which records to drop: anything too old, then the oldest until it fits.
 *
 * Pure, and separate from the store, because the policy is the part worth
 * testing and IndexedDB is not available where the unit tests run. `keepId` is
 * the feed just written — evicting it would make the write pointless, and it is
 * by definition the most recently useful record.
 */
export function feedsToEvict(
  all: readonly CachedFeed[],
  keepId: string,
  now: number,
  limits: { maxAgeMs: number; budgetBytes: number; keepMin: number } = FEED_CACHE_LIMITS,
): string[] {
  if (all.length <= limits.keepMin) return [];

  const doomed: string[] = [];
  const survivors: CachedFeed[] = [];
  for (const rec of all) {
    if (rec.id !== keepId && now - rec.fetchedAt > limits.maxAgeMs) doomed.push(rec.id);
    else survivors.push(rec);
  }

  // Newest first, so the budget pass spends its allowance on them and the
  // oldest are the ones that fall off the end.
  survivors.sort((a, b) => b.fetchedAt - a.fetchedAt);
  let total = 0;
  for (const rec of survivors) {
    total += recordBytes(rec);
    if (total <= limits.budgetBytes) continue;
    if (rec.id === keepId) continue;
    if (all.length - doomed.length <= limits.keepMin) break;
    doomed.push(rec.id);
  }
  return doomed;
}

async function pruneFeedCache(keepId: string, now = Date.now()): Promise<void> {
  try {
    const d = await db();
    const doomed = feedsToEvict(await d.getAll('feeds'), keepId, now);
    if (!doomed.length) return;
    const tx = d.transaction(['feeds', 'resume'], 'readwrite');
    for (const id of doomed) {
      void tx.objectStore('feeds').delete(id);
      // The resume projection is derived from the feed; keeping it would leave
      // Home a row it cannot render.
      void tx.objectStore('resume').delete(id);
    }
    await tx.done;
  } catch {
    /* pruning is best-effort; the next write tries again */
  }
}

export async function putCachedFeed(feed: ResolvedFeed): Promise<void> {
  try {
    const record: CachedFeed = {
      id: feed.meta.id,
      feed,
      fetchedAt: Date.now(),
      bytes: JSON.stringify(feed).length,
    };
    await (await db()).put('feeds', record);
    await pruneFeedCache(feed.meta.id);
  } catch {
    /* cache is best-effort */
  }
}

export interface FeedCacheInfo {
  count: number;
  /** Estimated total, in bytes. See the note on `CachedFeed.bytes`. */
  bytes: number;
}

/** What Settings shows, so the cache is not an invisible consumer of quota. */
export async function feedCacheInfo(): Promise<FeedCacheInfo> {
  try {
    const all = await (await db()).getAll('feeds');
    return { count: all.length, bytes: all.reduce((n, r) => n + recordBytes(r), 0) };
  } catch {
    return { count: 0, bytes: 0 };
  }
}

export { pruneFeedCache };

/**
 * Merge fields into one cached episode, in place.
 *
 * Used by the lazy show-notes path: notes read once should survive a reload and
 * be there offline, and rewriting the whole feed record is the only way
 * IndexedDB offers to change one item inside it. Silent when the feed is not
 * cached or the episode is no longer in it — the caller has the value either
 * way, and this is only about keeping it.
 */
export async function patchCachedEpisode(
  feedId: string,
  trackId: string,
  patch: Partial<Episode>,
): Promise<void> {
  try {
    const d = await db();
    const tx = d.transaction('feeds', 'readwrite');
    const store = tx.objectStore('feeds');
    const rec = await store.get(feedId);
    const i = rec?.feed.episodes.findIndex((e) => String(e.trackId) === trackId) ?? -1;
    const target = rec && i >= 0 ? rec.feed.episodes[i] : undefined;
    if (!rec || !target) {
      await tx.done;
      return;
    }
    rec.feed.episodes[i] = { ...target, ...patch };
    await store.put(rec);
    await tx.done;
  } catch {
    /* cache is best-effort */
  }
}

export async function clearFeedCache(): Promise<void> {
  try {
    const d = await db();
    await d.clear('feeds');
    await d.clear('resume');
  } catch {
    /* ignore */
  }
}

// ── resume projection (Home's continue-listening rail) ─────────────
export async function getResume(feedId: string): Promise<ResumeEntry | undefined> {
  try {
    return await (await db()).get('resume', feedId);
  } catch {
    return undefined;
  }
}

export async function putResume(entry: ResumeEntry): Promise<void> {
  try {
    await (await db()).put('resume', entry);
  } catch {
    /* best-effort: Home falls back to the full feed cache */
  }
}

// ── download records ───────────────────────────────────────────────
export async function getDownload(id: string): Promise<DownloadRecord | undefined> {
  try {
    return await (await db()).get('downloads', id);
  } catch {
    return undefined;
  }
}

export async function putDownload(rec: DownloadRecord): Promise<void> {
  await (await db()).put('downloads', rec);
}

export async function deleteDownload(id: string): Promise<void> {
  try {
    await (await db()).delete('downloads', id);
  } catch {
    /* ignore */
  }
}

export async function listDownloads(): Promise<DownloadRecord[]> {
  try {
    return await (await db()).getAll('downloads');
  } catch {
    return [];
  }
}
