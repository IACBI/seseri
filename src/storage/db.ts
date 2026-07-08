import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ResolvedFeed } from '../feeds/types';

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
}

export interface DownloadRecord {
  /** Episode trackId. */
  id: string;
  feedId: string;
  title: string;
  bytes: number;
  addedAt: number;
}

interface SeseriDB extends DBSchema {
  feeds: { key: string; value: CachedFeed };
  downloads: { key: string; value: DownloadRecord };
}

let dbPromise: Promise<IDBPDatabase<SeseriDB>> | null = null;

export function db(): Promise<IDBPDatabase<SeseriDB>> {
  if (!dbPromise) {
    dbPromise = openDB<SeseriDB>('seseri', 1, {
      upgrade(d) {
        d.createObjectStore('feeds', { keyPath: 'id' });
        d.createObjectStore('downloads', { keyPath: 'id' });
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

export async function putCachedFeed(feed: ResolvedFeed): Promise<void> {
  try {
    await (await db()).put('feeds', { id: feed.meta.id, feed, fetchedAt: Date.now() });
  } catch {
    /* cache is best-effort */
  }
}

export async function clearFeedCache(): Promise<void> {
  try {
    await (await db()).clear('feeds');
  } catch {
    /* ignore */
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
