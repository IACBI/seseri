/**
 * An archive longer than one `/v1/parse` response.
 *
 * The Worker answers at most 5000 episodes at a time. The client used to take
 * the first answer as the whole show, so everything past it vanished without
 * the list saying it was partial.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const FEED = 'https://feeds.example.com/very-long.xml';

function episodes(from: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    trackId: `e${from + i}`,
    trackName: `Episode ${from + i}`,
    releaseDate: '',
    episodeUrl: `https://cdn.example.com/${from + i}.mp3`,
    trackTimeMillis: 1000,
  }));
}

/**
 * A Worker holding `total` episodes that answers `pageSize` per request, the
 * way `/v1/parse` slices by `offset`. `failAt` makes one offset answer 502.
 */
function worker(total: number, pageSize: number, failAt?: number) {
  const offsets: number[] = [];
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    const u = new URL(String(url));
    const offset = Number(u.searchParams.get('offset') ?? 0);
    offsets.push(offset);
    if (offset === failAt) return new Response('{"error":"upstream 502"}', { status: 502 });
    const count = Math.max(0, Math.min(pageSize, total - offset));
    return Response.json({
      meta: { name: 'Long', artist: 'A', art: '' },
      total,
      offset,
      episodes: episodes(offset, count),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return offsets;
}

async function load() {
  vi.stubEnv('VITE_API_BASE', 'https://api.test');
  vi.resetModules();
  return {
    proxy: await import('./proxy-chain'),
    resolve: await import('./resolve'),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('fetchParsedFeed pages past one response', () => {
  it('fetches the remainder from where the first answer stopped', async () => {
    const offsets = worker(12, 5);
    const { proxy } = await load();

    const parsed = await proxy.fetchParsedFeed(FEED);

    expect(offsets).toEqual([0, 5, 10]);
    expect(parsed?.episodes.map((e) => e.trackId)).toEqual(episodes(0, 12).map((e) => e.trackId));
    expect(parsed?.total).toBe(12);
  });

  it('asks once when the first answer is the whole archive', async () => {
    const offsets = worker(4, 5000);
    const { proxy } = await load();
    await proxy.fetchParsedFeed(FEED);
    expect(offsets).toEqual([0]);
  });

  it('stops at a page that fails, and reports the list as partial', async () => {
    const offsets = worker(12, 5, 5);
    const { resolve } = await load();

    const feed = await resolve.resolveFeed({ kind: 'rss', url: FEED }, {});

    expect(offsets).toEqual([0, 5]);
    expect(feed.episodes).toHaveLength(5);
    expect(feed.limited).toBe(true);
    expect(feed.total).toBe(12);
  });

  it('reports a complete archive as complete', async () => {
    worker(12, 5);
    const { resolve } = await load();

    const feed = await resolve.resolveFeed({ kind: 'rss', url: FEED }, {});

    expect(feed.episodes).toHaveLength(12);
    expect(feed.limited).toBe(false);
  });
});
