// @vitest-environment jsdom
/**
 * The Worker-parsed path, and — more importantly — what happens when it cannot
 * answer. `/v1/parse` is newer than some deployed Workers and than every build
 * that has no Worker at all, so falling back to raw XML is not an edge case:
 * it is how the app behaves for anyone running the public-proxy configuration.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, settings } from '../state/settings';

const fetchParsedFeed = vi.hoisted(() => vi.fn());
const fetchTextProxied = vi.hoisted(() => vi.fn());

vi.mock('./proxy-chain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./proxy-chain')>();
  return { ...actual, fetchParsedFeed, fetchTextProxied };
});

import { resolveFeed } from './resolve';

const URL_ = 'https://feeds.example.com/pod.xml';
const REQ = { kind: 'rss' as const, url: URL_ };

const XML = `<rss version="2.0"><channel><title>From XML</title>
  <item><title>Ep</title><guid>x1</guid>
    <enclosure url="https://cdn.example.com/1.mp3"/>
    <description>notes in the xml</description></item>
</channel></rss>`;

beforeEach(() => {
  settings.set({ ...DEFAULT_SETTINGS });
  fetchParsedFeed.mockReset();
  fetchTextProxied.mockReset();
});

describe('resolveFeed — rss through the Worker', () => {
  it('uses the parsed JSON and never downloads the XML', async () => {
    fetchParsedFeed.mockResolvedValue({
      meta: { name: 'From JSON', artist: 'Author', art: 'https://img.example/a.jpg' },
      total: 2,
      offset: 0,
      episodes: [
        {
          trackId: 'g1',
          trackName: 'Ep 1',
          releaseDate: '',
          episodeUrl: 'https://cdn.example.com/1.mp3',
          trackTimeMillis: 1000,
        },
        {
          trackId: 'g2',
          trackName: 'Ep 2',
          releaseDate: '',
          episodeUrl: 'https://cdn.example.com/2.mp3',
          trackTimeMillis: 2000,
        },
      ],
    });

    const feed = await resolveFeed(REQ, {});

    expect(feed.meta).toEqual({
      id: 'rss:' + URL_,
      name: 'From JSON',
      artist: 'Author',
      art: 'https://img.example/a.jpg',
    });
    expect(feed.episodes.map((e) => e.trackId)).toEqual(['g1', 'g2']);
    // The whole point: the raw feed was never fetched.
    expect(fetchTextProxied).not.toHaveBeenCalled();
  });

  it('marks the list as missing its notes, so the sheet knows to ask', async () => {
    fetchParsedFeed.mockResolvedValue({
      meta: { name: 'P', artist: '', art: '' },
      total: 1,
      offset: 0,
      episodes: [
        {
          trackId: 'g1',
          trackName: 'Ep',
          releaseDate: '',
          episodeUrl: 'https://cdn.example.com/1.mp3',
          trackTimeMillis: 0,
        },
      ],
    });
    const feed = await resolveFeed(REQ, {});
    expect(feed.notesDeferred).toBe(true);
  });

  it('falls back to raw XML when the Worker cannot parse for us', async () => {
    fetchParsedFeed.mockResolvedValue(null);
    fetchTextProxied.mockResolvedValue(XML);

    const feed = await resolveFeed(REQ, {});

    expect(feed.meta.name).toBe('From XML');
    expect(feed.episodes.map((e) => e.trackId)).toEqual(['x1']);
    // The XML carries the notes, so nothing needs to be asked for later.
    expect(feed.notesDeferred).toBeUndefined();
    expect(feed.episodes[0]?.description).toBe('notes in the xml');
  });

  it('propagates the XML path error when both routes fail', async () => {
    fetchParsedFeed.mockResolvedValue(null);
    fetchTextProxied.mockRejectedValue(new Error('proxies-disabled'));
    await expect(resolveFeed(REQ, {})).rejects.toThrow('proxies-disabled');
  });

  it('propagates an abort rather than quietly falling back', async () => {
    // An aborted load means the user moved on; retrying through the proxies
    // would be a request nobody is waiting for.
    const err = new DOMException('aborted', 'AbortError');
    fetchParsedFeed.mockRejectedValue(err);
    await expect(resolveFeed(REQ, {})).rejects.toThrow('aborted');
    expect(fetchTextProxied).not.toHaveBeenCalled();
  });
});
