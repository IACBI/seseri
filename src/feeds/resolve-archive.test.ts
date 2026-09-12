// @vitest-environment jsdom
/**
 * Opening an Apple podcast now reaches past Apple for the rest of the archive.
 *
 * The failure mode to guard hardest is not "the archive did not load" — it is
 * "the archive did not load and took the show with it". A feed host that is
 * down, a feed that no longer parses, or a user who has not opted into the
 * public proxies must all leave the listener exactly where they were: with the
 * short Apple list, working.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Episode } from './types';

const lookupPodcast = vi.hoisted(() => vi.fn());
const fetchParsedFeed = vi.hoisted(() => vi.fn());
const fetchTextProxied = vi.hoisted(() => vi.fn());
const applyEpisodeRemap = vi.hoisted(() =>
  vi.fn(async () => ({ positions: 0, queued: 0, downloads: 0, lastPlayed: false })),
);

vi.mock('./itunes', () => ({ lookupPodcast }));
vi.mock('./proxy-chain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./proxy-chain')>();
  return { ...actual, fetchParsedFeed, fetchTextProxied };
});
vi.mock('./archive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./archive')>();
  return { ...actual, applyEpisodeRemap };
});

import { resolveFeed } from './resolve';

const ID = '777000111';
const FEED_URL = 'https://feeds.example.com/the-show.xml';

function ep(trackId: string, url: string): Episode {
  return {
    trackId,
    trackName: 'Ep ' + trackId,
    releaseDate: '',
    episodeUrl: url,
    trackTimeMillis: 0,
  };
}

/** Apple's answer: a slice, and its own admission that it is one. */
function appleLookup(returned: number, claims: number, feedUrl = FEED_URL) {
  return {
    meta: { id: ID, name: 'The Show', artist: 'A Studio', art: 'https://img/apple.jpg' },
    episodes: Array.from({ length: returned }, (_, i) =>
      ep(String(1000 + i), `https://cdn.example.com/${i}.mp3`),
    ),
    limited: claims > returned,
    total: claims,
    feedUrl,
  };
}

/** The show's own feed: everything, under its own ids. */
function archive(count: number) {
  return {
    meta: { name: 'The Show (feed title)', artist: 'Feed Artist', art: 'https://img/feed.jpg' },
    total: count,
    offset: 0,
    episodes: Array.from({ length: count }, (_, i) =>
      ep(`guid-${i}`, `https://cdn.example.com/${i}.mp3`),
    ),
  };
}

beforeEach(() => {
  lookupPodcast.mockReset();
  fetchParsedFeed.mockReset();
  fetchTextProxied.mockReset();
  applyEpisodeRemap.mockClear();
});

describe('resolveFeed — the Apple archive switch', () => {
  it('replaces a truncated listing with the full archive', async () => {
    // The real numbers this exists for: Apple reports 2676 and returns 41.
    lookupPodcast.mockResolvedValue(appleLookup(41, 2676));
    fetchParsedFeed.mockResolvedValue(archive(2676));

    const feed = await resolveFeed({ kind: 'itunes', id: ID }, {});

    expect(feed.episodes).toHaveLength(2676);
    expect(feed.total).toBe(2676);
    // Nothing is a slice of anything any more, so the "of N in the archive"
    // note must stop appearing.
    expect(feed.limited).toBe(false);
    expect(fetchParsedFeed).toHaveBeenCalledWith(FEED_URL, undefined);
  });

  it('keeps the Apple identity, so subscriptions and pointers still resolve', async () => {
    lookupPodcast.mockResolvedValue(appleLookup(41, 2676));
    fetchParsedFeed.mockResolvedValue(archive(100));

    const feed = await resolveFeed({ kind: 'itunes', id: ID }, {});

    expect(feed.meta.id).toBe(ID);
    // Apple's curation wins over the feed's own strings.
    expect(feed.meta.name).toBe('The Show');
    expect(feed.meta.artist).toBe('A Studio');
    expect(feed.meta.art).toBe('https://img/apple.jpg');
  });

  it('migrates the episode ids it changed', async () => {
    lookupPodcast.mockResolvedValue(appleLookup(2, 10));
    fetchParsedFeed.mockResolvedValue(archive(10));

    await resolveFeed({ kind: 'itunes', id: ID }, {});

    expect(applyEpisodeRemap).toHaveBeenCalledTimes(1);
    const call = applyEpisodeRemap.mock.calls[0] as unknown as [string, Array<[string, string]>];
    const [feedId, pairs] = call;
    expect(feedId).toBe(ID);
    expect(pairs).toEqual([
      ['1000', 'guid-0'],
      ['1001', 'guid-1'],
    ]);
  });

  it('does not go looking when Apple returned the whole show', async () => {
    lookupPodcast.mockResolvedValue(appleLookup(12, 12));

    const feed = await resolveFeed({ kind: 'itunes', id: ID }, {});

    expect(feed.episodes).toHaveLength(12);
    expect(fetchParsedFeed).not.toHaveBeenCalled();
    expect(fetchTextProxied).not.toHaveBeenCalled();
  });

  it('does not go looking when Apple gives no feed url', async () => {
    lookupPodcast.mockResolvedValue(appleLookup(41, 2676, ''));
    const feed = await resolveFeed({ kind: 'itunes', id: ID }, {});
    expect(feed.episodes).toHaveLength(41);
    expect(feed.limited).toBe(true);
    expect(fetchParsedFeed).not.toHaveBeenCalled();
  });

  it('keeps the short list when the feed host is down', async () => {
    lookupPodcast.mockResolvedValue(appleLookup(41, 2676));
    fetchParsedFeed.mockResolvedValue(null);
    fetchTextProxied.mockRejectedValue(new Error('fetch failed'));

    const feed = await resolveFeed({ kind: 'itunes', id: ID }, {});

    expect(feed.episodes).toHaveLength(41);
    expect(feed.limited).toBe(true);
    expect(feed.total).toBe(2676);
    expect(applyEpisodeRemap).not.toHaveBeenCalled();
  });

  it('keeps the short list when the user has not opted into the public proxies', async () => {
    // The common configuration for a build with no Worker: the archive simply
    // cannot be reached, and that must not break opening the show.
    lookupPodcast.mockResolvedValue(appleLookup(41, 2676));
    fetchParsedFeed.mockResolvedValue(null);
    fetchTextProxied.mockRejectedValue(new Error('proxies-disabled'));

    const feed = await resolveFeed({ kind: 'itunes', id: ID }, {});
    expect(feed.episodes).toHaveLength(41);
    expect(feed.limited).toBe(true);
  });

  it('keeps the short list when the archive turns out to be no longer', async () => {
    // A feed that only publishes recent episodes. Switching sources would lose
    // episodes AND re-key everything for nothing.
    lookupPodcast.mockResolvedValue(appleLookup(41, 2676));
    fetchParsedFeed.mockResolvedValue(archive(20));

    const feed = await resolveFeed({ kind: 'itunes', id: ID }, {});

    expect(feed.episodes).toHaveLength(41);
    expect(feed.episodes[0]?.trackId).toBe('1000');
    expect(applyEpisodeRemap).not.toHaveBeenCalled();
  });

  it('propagates an abort instead of falling back', async () => {
    lookupPodcast.mockResolvedValue(appleLookup(41, 2676));
    fetchParsedFeed.mockRejectedValue(new DOMException('aborted', 'AbortError'));
    await expect(resolveFeed({ kind: 'itunes', id: ID }, {})).rejects.toThrow('aborted');
  });

  it('falls back to raw XML for the archive when the Worker cannot parse', async () => {
    lookupPodcast.mockResolvedValue(appleLookup(1, 3));
    fetchParsedFeed.mockResolvedValue(null);
    fetchTextProxied.mockResolvedValue(
      `<rss version="2.0"><channel><title>Feed</title>` +
        `<item><guid>guid-0</guid><enclosure url="https://cdn.example.com/0.mp3"/></item>` +
        `<item><guid>guid-1</guid><enclosure url="https://cdn.example.com/1.mp3"/></item>` +
        `<item><guid>guid-2</guid><enclosure url="https://cdn.example.com/2.mp3"/></item>` +
        `</channel></rss>`,
    );

    const feed = await resolveFeed({ kind: 'itunes', id: ID }, {});

    expect(feed.episodes.map((e) => e.trackId)).toEqual(['guid-0', 'guid-1', 'guid-2']);
    expect(feed.limited).toBe(false);
    // Notes came with the XML, so nothing has to be fetched later.
    expect(feed.notesDeferred).toBeUndefined();
  });
});
