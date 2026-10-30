// @vitest-environment jsdom
/**
 * `openAndPlay` against a feed that is cached.
 *
 * A shared episode link (`?ep=`) and the new-episodes rail both open a feed and
 * start one episode "once the list paints". The list paints twice for a cached
 * feed — the stored copy at once, then the network's — and the request was used
 * up by the first paint. A link to an episode published since the cache was
 * written (which is what a link shared the day it came out points at) found
 * nothing in the stale copy, was dropped, and never ran against the fresh one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CachedFeed } from '../storage/db';
import type { Episode } from '../feeds/types';

const getCachedFeed = vi.hoisted(() => vi.fn());
vi.mock('../storage/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../storage/db')>()),
  getCachedFeed,
}));

import { createPlaybackController } from './playback-controller';
import { audio } from '../player/engine';
import { playing } from '../player/session';
import { clearQueue } from '../state/queue';
import { DEFAULT_SETTINGS, settings } from '../state/settings';

const URL_A = 'https://feeds.example.com/deeplink';
const ID_A = 'rss:' + URL_A;

function xml(ids: string[]): string {
  const items = ids
    .map(
      (id, i) => `<item><title>Ep ${id}</title><guid>${id}</guid>
        <pubDate>Mon, 0${i + 1} Jan 2024 00:00:00 GMT</pubDate>
        <enclosure url="https://cdn.example.com/${id}.mp3" type="audio/mpeg"/></item>`,
    )
    .join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Deep</title>${items}</channel></rss>`;
}

function episode(id: string, day: number): Episode {
  return {
    trackId: id,
    trackName: 'Ep ' + id,
    releaseDate: `Mon, 0${day} Jan 2024 00:00:00 GMT`,
    episodeUrl: `https://cdn.example.com/${id}.mp3`,
    trackTimeMillis: 0,
  };
}

/** What the device cached yesterday: two episodes, not the third. */
const STALE: CachedFeed = {
  id: ID_A,
  fetchedAt: 1,
  feed: {
    meta: { id: ID_A, name: 'Deep', artist: '', art: '' },
    episodes: [episode('d1', 1), episode('d2', 2)],
    limited: false,
  },
};

async function waitFor(pred: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('timed out waiting for: ' + label);
}

let ctl: ReturnType<typeof createPlaybackController>;

beforeEach(() => {
  getCachedFeed.mockReset();
  getCachedFeed.mockResolvedValue(STALE);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(xml(['d1', 'd2', 'd3']), { status: 200 })),
  );
  settings.set({ ...DEFAULT_SETTINGS, allowPublicProxies: true });
  localStorage.clear();
  clearQueue();
  playing.set(null);
  audio.removeAttribute('src');
  ctl = createPlaybackController();
});

afterEach(() => {
  vi.unstubAllGlobals();
  settings.set({ ...DEFAULT_SETTINGS });
});

describe('openAndPlay on a cached feed', () => {
  it('still finds an episode that only the fresh copy has', async () => {
    ctl.openAndPlay({ kind: 'rss', url: URL_A }, 'd3', { autoplay: false });

    await waitFor(() => playing()?.trackId === 'd3', 'd3 to load');

    expect(playing()).toMatchObject({ feedId: ID_A, trackId: 'd3' });
  });

  it('starts an episode the cached copy already has as soon as that paints', async () => {
    ctl.openAndPlay({ kind: 'rss', url: URL_A }, 'd2', { autoplay: false });

    await waitFor(() => playing()?.trackId === 'd2', 'd2 to load');
  });

  it('says so when neither copy has the episode', async () => {
    ctl.openAndPlay({ kind: 'rss', url: URL_A }, 'nope', { autoplay: false });

    await waitFor(() => document.querySelector('.toast-error') !== null, 'the error toast');

    expect(playing()).toBeNull();
  });

  it('does not carry an unmet request over to a different feed', async () => {
    // Offline: the stored copy paints, lacks the episode, and the network never
    // answers, so nothing ever says the request is over.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    ctl.openAndPlay({ kind: 'rss', url: URL_A }, 'd3', { autoplay: false });
    await waitFor(() => ctl.session().filtered.length === 2, 'the stored copy');

    // Later, a different show that happens to have an episode with that id.
    getCachedFeed.mockResolvedValue(undefined);
    const other = 'https://feeds.example.com/other';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(xml(['d3']), { status: 200 })),
    );
    ctl.openFeed({ kind: 'rss', url: other });
    await waitFor(() => ctl.session().meta?.id === 'rss:' + other, 'the other feed');
    expect(playing()).toBeNull();

    // …and coming back to the first show later is just browsing it.
    getCachedFeed.mockResolvedValue(STALE);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(xml(['d1', 'd2', 'd3']), { status: 200 })),
    );
    ctl.openFeed({ kind: 'rss', url: URL_A });
    await waitFor(() => ctl.session().filtered.length === 3, 'the first show again');

    expect(playing()).toBeNull();
  });
});
