/**
 * The IndexedDB layer against a real IndexedDB implementation.
 *
 * `fake-indexeddb` implements the spec in memory — versionchange, blocked
 * upgrades, cursors and all — so these run the actual `openDB` upgrade path
 * rather than a stand-in for it.
 */
// The globals idb checks with `instanceof` (IDBRequest, IDBCursor, …).
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedFeed } from '../feeds/types';
import {
  DB_NAME,
  DB_SCHEMA_VERSION,
  closeDb,
  db,
  feedCacheInfo,
  getCachedFeed,
  listDownloads,
  patchCachedEpisode,
  putCachedFeed,
  putDownload,
} from './db';

const DAY = 86_400_000;

function feed(id: string, episodes = 2): ResolvedFeed {
  return {
    meta: { id, name: id, artist: '', art: '' },
    episodes: Array.from({ length: episodes }, (_, i) => ({
      trackId: `${id}-${i}`,
      trackName: `Episode ${i}`,
      releaseDate: '',
      episodeUrl: `https://cdn.example.com/${id}/${i}.mp3`,
      trackTimeMillis: 1000,
    })),
    limited: false,
  };
}

/** A raw request as a promise, for the parts written without `idb`. */
function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** What a 4.2.9 install has on disk: schema 2, no `feedStats`. */
async function seedVersion2(records: Array<{ id: string; fetchedAt: number; bytes?: number }>) {
  const open = indexedDB.open(DB_NAME, 2);
  open.onupgradeneeded = () => {
    const d = open.result;
    d.createObjectStore('feeds', { keyPath: 'id' });
    d.createObjectStore('downloads', { keyPath: 'id' });
    d.createObjectStore('resume', { keyPath: 'id' });
  };
  const d = await done(open);
  const tx = d.transaction('feeds', 'readwrite');
  for (const r of records) tx.objectStore('feeds').put({ ...r, feed: feed(r.id) });
  await new Promise((r) => (tx.oncomplete = r));
  return d;
}

/** Wait for a condition, on real time — IndexedDB work is not timer-driven. */
async function until(pred: () => boolean | Promise<boolean>, label: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('timed out waiting for: ' + label);
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
});

afterEach(() => {
  closeDb();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('schema 3', () => {
  it('is the version this build opens', () => {
    expect(DB_SCHEMA_VERSION).toBe(3);
  });

  it('migrates an existing cache into the stats store, once', async () => {
    const old = await seedVersion2([
      { id: 'a', fetchedAt: 1000, bytes: 300 },
      { id: 'b', fetchedAt: 2000, bytes: 700 },
      { id: 'legacy', fetchedAt: 3000 }, // written before sizes were measured
    ]);
    old.close();

    expect(await feedCacheInfo()).toEqual({ count: 3, bytes: 1000 });
    // The feeds themselves are untouched by the upgrade.
    expect((await getCachedFeed('a'))?.feed.meta.id).toBe('a');
  });

  it('writes a stat beside every cached feed', async () => {
    await putCachedFeed(feed('x', 3));
    const info = await feedCacheInfo();
    expect(info.count).toBe(1);
    expect(info.bytes).toBe(JSON.stringify(feed('x', 3)).length);
  });

  it('grows the counted size when notes are filled in', async () => {
    await putCachedFeed(feed('n'));
    const before = (await feedCacheInfo()).bytes;

    await patchCachedEpisode('n', 'n-0', { description: 'x'.repeat(5000) });

    expect((await feedCacheInfo()).bytes).toBeGreaterThanOrEqual(before + 5000);
    expect((await getCachedFeed('n'))?.feed.episodes[0]?.description).toHaveLength(5000);
  });
});

describe('pruning reads the stats, not the archives', () => {
  it('evicts a stale feed without ever reading the feeds store whole', async () => {
    const reads: string[] = [];
    // `IDBObjectStore` is fake-indexeddb's here (installed by /auto).
    const getAll = IDBObjectStore.prototype.getAll;
    vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<typeof getAll>
    ) {
      reads.push(this.name);
      return getAll.apply(this, args);
    });

    // Six feeds, one of them 40 days old: over the floor of five, so the
    // stale one is eligible.
    const old = await seedVersion2([{ id: 'stale', fetchedAt: Date.now() - 40 * DAY, bytes: 10 }]);
    old.close();
    for (const id of ['f1', 'f2', 'f3', 'f4', 'f5']) await putCachedFeed(feed(id));

    // Pruning waits for the burst of writes to end.
    await until(async () => !(await getCachedFeed('stale')), 'the stale feed to be pruned');

    expect((await feedCacheInfo()).count).toBe(5);
    expect(reads).toContain('feedStats');
    expect(reads).not.toContain('feeds');
  });
});

describe('an upgrade another tab is blocking', () => {
  it('fails fast instead of hanging, then recovers when the tab lets go', async () => {
    // A tab still running 4.2.9: it holds a schema-2 connection and does not
    // close it when asked to.
    const other = await seedVersion2([{ id: 'a', fetchedAt: 1, bytes: 5 }]);
    other.onversionchange = () => undefined;

    const started = Date.now();
    await expect(listDownloads()).resolves.toEqual([]);
    await expect(getCachedFeed('a')).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1000);

    other.close();

    await until(async () => (await feedCacheInfo()).count === 1, 'the upgrade to go through');
    await putDownload({ id: 'd1', feedId: 'a', title: 'T', bytes: 1, addedAt: 1 });
    expect((await listDownloads()).map((d) => d.id)).toEqual(['d1']);
    expect((await db()).version).toBe(3);
  });
});
