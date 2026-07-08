// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Episode } from '../feeds/types';

// In-memory download-record store standing in for the idb layer.
const store = vi.hoisted(() => new Map<string, unknown>());

vi.mock('../storage/db', () => ({
  getDownload: vi.fn(async (id: string) => store.get(id)),
  putDownload: vi.fn(async (rec: { id: string }) => {
    store.set(rec.id, rec);
  }),
  deleteDownload: vi.fn(async (id: string) => {
    store.delete(id);
  }),
  listDownloads: vi.fn(async () => [...store.values()]),
}));

// Never hit the network for YT resolution — offline tests supply direct URLs.
vi.mock('../youtube/piped', () => ({ ytServiceAudioUrl: vi.fn(async () => '') }));

import {
  downloadOffline,
  isDownloaded,
  offlineAudioUrl,
  removeDownload,
} from './offline';

// Mixing jsdom's Blob with Node's (undici) Response throws TypeError on some
// Node versions, so the whole fetch surface is duck-typed here: a FakeResponse
// stands in for the global Response, fetch returns a plain object, and the
// Map-backed cache stores whatever put() receives.
const FAKE_BLOB = { size: 11, kind: 'fake-audio-blob' };

class FakeResponse {
  ok: boolean;
  status: number;
  headers: { get(k: string): string | null };
  private body: unknown;
  constructor(body?: unknown, init?: { status?: number; headers?: Record<string, string> }) {
    this.body = body ?? FAKE_BLOB;
    this.status = init?.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
    const h = init?.headers ?? {};
    this.headers = { get: (k: string) => h[k.toLowerCase()] ?? h[k] ?? null };
  }
  blob = async (): Promise<unknown> => this.body;
}

type CacheEntry = Map<string, FakeResponse>;
const cachesStore = new Map<string, CacheEntry>();

function installCaches(): void {
  const cacheFor = (name: string): CacheEntry => {
    let c = cachesStore.get(name);
    if (!c) cachesStore.set(name, (c = new Map()));
    return c;
  };
  const fakeCaches = {
    open: vi.fn(async (name: string) => {
      const c = cacheFor(name);
      return {
        put: vi.fn(async (key: string, res: FakeResponse) => {
          c.set(key, res);
        }),
        match: vi.fn(async (key: string) => c.get(key)),
        delete: vi.fn(async (key: string) => c.delete(key)),
      };
    }),
    delete: vi.fn(async (name: string) => cachesStore.delete(name)),
  };
  vi.stubGlobal('caches', fakeCaches);
}

function makeEpisode(trackId: unknown, url = 'https://cdn.example.com/a.mp3'): Episode {
  return {
    trackId: trackId as string,
    trackName: 'Ep',
    releaseDate: '',
    episodeUrl: url,
    trackTimeMillis: 0,
  };
}

beforeEach(() => {
  store.clear();
  cachesStore.clear();
  installCaches();
  // offline.ts wraps the fetched blob in `new Response(...)` — point the
  // global at the fake so no real undici/jsdom classes ever mix.
  vi.stubGlobal('Response', FakeResponse as unknown as typeof Response);
  vi.stubGlobal('fetch', vi.fn(async () => new FakeResponse() as unknown as Response));
  // jsdom does not implement object URLs.
  URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('downloadOffline', () => {
  it('caches the audio and records the download under String(trackId)', async () => {
    const ep = makeEpisode(12345);
    const outcome = await downloadOffline(ep, 'feed-1', false);

    expect(outcome).toBe('ok');
    // Record keyed by the stringified trackId.
    expect(store.has('12345')).toBe(true);
    expect(await isDownloaded('12345')).toBe(true);
  });

  it('returns "no-url" when the episode has no usable audio url', async () => {
    const ep = makeEpisode(1, 'http://insecure.example.com/x.mp3'); // httpsOnly strips it
    expect(await downloadOffline(ep, 'feed-1', false)).toBe('no-url');
    expect(store.size).toBe(0);
  });

  it('returns "failed" when the fetch responds non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    expect(await downloadOffline(makeEpisode(2), 'feed-1', false)).toBe('failed');
    expect(store.size).toBe(0);
  });

  it('returns "cors-blocked" on a TypeError (CDN without CORS headers)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    expect(await downloadOffline(makeEpisode(3), 'feed-1', false)).toBe('cors-blocked');
  });
});

describe('cacheKey / trackId round-trip', () => {
  it('stores under String(trackId) and reads back by the same episodeId', async () => {
    // trackId is a number here — the store must coerce it so the read key matches.
    const ep = makeEpisode(98765);
    await downloadOffline(ep, 'feed-1', false);

    const url = await offlineAudioUrl('98765');
    expect(url).toBe('blob:mock-url');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('returns null for an episodeId that was never downloaded', async () => {
    expect(await offlineAudioUrl('nope')).toBeNull();
  });

  it('returns null when the record exists but the cache entry is missing', async () => {
    // Record present, but wipe the cache bucket to simulate an evicted body.
    await downloadOffline(makeEpisode(55), 'feed-1', false);
    cachesStore.clear();
    expect(await offlineAudioUrl('55')).toBeNull();
  });
});

describe('removeDownload', () => {
  it('drops both the cache entry and the download record', async () => {
    await downloadOffline(makeEpisode(77), 'feed-1', false);
    expect(await isDownloaded('77')).toBe(true);

    await removeDownload('77');

    expect(await isDownloaded('77')).toBe(false);
    expect(await offlineAudioUrl('77')).toBeNull();
  });
});
