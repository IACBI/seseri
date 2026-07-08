// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveFeed } from './resolve';
import type { ResolveOptions } from './resolve';

const OPTS: ResolveOptions = { ytVideoTitle: 'YouTube video' };

function jsonRes(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel>
  <title>Direct Feed</title>
  <itunes:author>Feed Author</itunes:author>
  <item>
    <title>Only Episode</title>
    <guid>guid-1</guid>
    <enclosure url="https://cdn.example.com/1.mp3" type="audio/mpeg"/>
  </item>
</channel>
</rss>`;

afterEach(() => vi.unstubAllGlobals());

describe('resolveFeed — itunes', () => {
  it('resolves an Apple id through the lookup flow', async () => {
    const fetchMock = vi.fn(async () =>
      jsonRes({
        results: [
          {
            wrapperType: 'collection',
            collectionName: 'My Pod',
            artistName: 'The Artist',
            artworkUrl100: 'https://img/art.jpg',
          },
          {
            wrapperType: 'podcastEpisode',
            trackId: 42,
            trackName: 'Episode One',
            episodeUrl: 'https://cdn/1.mp3',
            trackTimeMillis: 1000,
            releaseDate: '2024-01-01',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const feed = await resolveFeed({ kind: 'itunes', id: '1550551126' }, OPTS);

    expect(feed.meta).toEqual({
      id: '1550551126',
      name: 'My Pod',
      artist: 'The Artist',
      art: 'https://img/art.jpg',
    });
    expect(feed.episodes).toHaveLength(1);
    expect(feed.episodes[0]?.trackId).toBe('42');
    expect(feed.limited).toBe(false);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('propagates an error when the lookup returns no results array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ notResults: true })));
    await expect(resolveFeed({ kind: 'itunes', id: '1550551126' }, OPTS)).rejects.toThrow(
      'invalid api response',
    );
  });
});

describe('resolveFeed — rss', () => {
  it('fetches and parses a direct RSS url', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(RSS, { status: 200 })));

    const feed = await resolveFeed({ kind: 'rss', url: 'https://feeds.example.com/pod' }, OPTS);

    expect(feed.meta.id).toBe('rss:https://feeds.example.com/pod');
    expect(feed.meta.name).toBe('Direct Feed');
    expect(feed.meta.artist).toBe('Feed Author');
    expect(feed.episodes.map((e) => e.trackId)).toEqual(['guid-1']);
    expect(feed.limited).toBe(false);
  });

  it('propagates a fetch failure when every proxy is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await expect(
      resolveFeed({ kind: 'rss', url: 'https://feeds.example.com/pod' }, OPTS),
    ).rejects.toThrow('fetch failed');
  });
});
