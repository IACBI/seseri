// @vitest-environment jsdom
/**
 * New-episode detection.
 *
 * Two failure modes matter more than anything else here, and both are about
 * announcing the wrong thing rather than missing something:
 *
 *   - A newly subscribed feed must announce NOTHING. A 600-episode archive
 *     arriving as 600 "new episodes" is not news, it is a wall, and it would
 *     also put 600 rows on Home.
 *   - A feed must not re-announce what it already announced. The sweep runs on
 *     every app open and on every return to the foreground.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Episode, ResolvedFeed, Subscription } from './types';

const resolveFeed = vi.hoisted(() => vi.fn());
const putCachedFeed = vi.hoisted(() => vi.fn(async () => undefined));
const startDownload = vi.hoisted(() => vi.fn(async () => 'ok'));

vi.mock('./resolve', () => ({ resolveFeed }));
vi.mock('../storage/db', () => ({ putCachedFeed }));
vi.mock('../player/download-jobs', () => ({ startDownload }));

import {
  CHECK_EVERY_MS,
  applyAppBadge,
  clearInbox,
  dismissInboxItem,
  inbox,
  loadInbox,
  newSince,
  pendingInbox,
  resetSeen,
  sweepSubscriptions,
} from './inbox';
import { loadPlayed, markPlayed } from '../storage/played';
import { loadProgress } from '../storage/progress';
import { DEFAULT_SETTINGS, settings } from '../state/settings';

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

function sub(id: string, name = 'Show ' + id): Subscription {
  return { id, name, artist: 'Host', art: 'https://img.example/' + id + '.jpg' };
}

/** `n` episodes, oldest first, one per day ending the day before `NOW`. */
function episodes(n: number, prefix = 'e'): Episode[] {
  return Array.from({ length: n }, (_, i) => ({
    trackId: `${prefix}${i}`,
    trackName: `Episode ${i}`,
    releaseDate: new Date(NOW - (n - i) * DAY).toUTCString(),
    episodeUrl: `https://cdn.example.com/${prefix}${i}.mp3`,
    trackTimeMillis: 600_000,
  }));
}

function feed(id: string, eps: Episode[]): ResolvedFeed {
  return {
    meta: { id, name: 'Show ' + id, artist: 'Host', art: 'https://img.example/' + id + '.jpg' },
    episodes: eps,
    limited: false,
  };
}

beforeEach(() => {
  localStorage.clear();
  loadProgress();
  loadPlayed();
  loadInbox();
  resetSeen();
  clearInbox();
  resolveFeed.mockReset();
  putCachedFeed.mockClear();
  startDownload.mockClear();
  settings.set({ ...DEFAULT_SETTINGS });
});

describe('the first sight of a feed', () => {
  it('announces nothing and remembers where it starts', async () => {
    resolveFeed.mockResolvedValue(feed('f1', episodes(600)));

    const result = await sweepSubscriptions([sub('f1')], { now: NOW });

    expect(result.checked).toBe(1);
    expect(result.found).toBe(0);
    expect(inbox()).toEqual([]);
  });

  it('then announces only what appears after it', async () => {
    resolveFeed.mockResolvedValue(feed('f1', episodes(3)));
    await sweepSubscriptions([sub('f1')], { now: NOW });

    // Two more published since.
    const grown = [
      ...episodes(3),
      {
        trackId: 'e3',
        trackName: 'Episode 3',
        releaseDate: new Date(NOW + DAY).toUTCString(),
        episodeUrl: 'https://cdn.example.com/e3.mp3',
        trackTimeMillis: 600_000,
      },
      {
        trackId: 'e4',
        trackName: 'Episode 4',
        releaseDate: new Date(NOW + 2 * DAY).toUTCString(),
        episodeUrl: 'https://cdn.example.com/e4.mp3',
        trackTimeMillis: 600_000,
      },
    ];
    resolveFeed.mockResolvedValue(feed('f1', grown));

    const result = await sweepSubscriptions([sub('f1')], { now: NOW + CHECK_EVERY_MS + 1 });

    expect(result.found).toBe(2);
    expect(pendingInbox().map((i) => i.trackId).sort()).toEqual(['e3', 'e4']);
  });
});

describe('the sweep does not repeat itself', () => {
  it('skips a feed checked within the interval', async () => {
    resolveFeed.mockResolvedValue(feed('f1', episodes(2)));
    await sweepSubscriptions([sub('f1')], { now: NOW });
    resolveFeed.mockClear();

    const result = await sweepSubscriptions([sub('f1')], { now: NOW + 60_000 });

    expect(result.skipped).toBe(1);
    expect(resolveFeed).not.toHaveBeenCalled();
  });

  it('checks it again once the interval has passed', async () => {
    resolveFeed.mockResolvedValue(feed('f1', episodes(2)));
    await sweepSubscriptions([sub('f1')], { now: NOW });
    resolveFeed.mockClear();

    await sweepSubscriptions([sub('f1')], { now: NOW + CHECK_EVERY_MS + 1 });

    expect(resolveFeed).toHaveBeenCalledTimes(1);
  });

  it('forces a check when asked, however recent the last one', async () => {
    resolveFeed.mockResolvedValue(feed('f1', episodes(2)));
    await sweepSubscriptions([sub('f1')], { now: NOW });
    resolveFeed.mockClear();

    await sweepSubscriptions([sub('f1')], { now: NOW + 1000, force: true });

    expect(resolveFeed).toHaveBeenCalledTimes(1);
  });

  it('never adds the same episode twice', async () => {
    resolveFeed.mockResolvedValue(feed('f1', episodes(2)));
    await sweepSubscriptions([sub('f1')], { now: NOW });

    const grown = [
      ...episodes(2),
      {
        trackId: 'e2',
        trackName: 'Episode 2',
        releaseDate: new Date(NOW + DAY).toUTCString(),
        episodeUrl: 'https://cdn.example.com/e2.mp3',
        trackTimeMillis: 600_000,
      },
    ];
    resolveFeed.mockResolvedValue(feed('f1', grown));
    await sweepSubscriptions([sub('f1')], { now: NOW + CHECK_EVERY_MS + 1, force: true });
    // A second forced sweep with the same feed contents: the mark moved on, so
    // there is nothing after it any more.
    await sweepSubscriptions([sub('f1')], { now: NOW + 2 * CHECK_EVERY_MS, force: true });

    expect(inbox().filter((i) => i.trackId === 'e2')).toHaveLength(1);
  });
});

describe('failures are not news', () => {
  it('survives a feed that cannot be reached', async () => {
    resolveFeed.mockRejectedValue(new Error('fetch failed'));
    const result = await sweepSubscriptions([sub('f1')], { now: NOW });
    expect(result.found).toBe(0);
    expect(inbox()).toEqual([]);
  });

  it('keeps checking the rest when one feed is down', async () => {
    resolveFeed.mockImplementation(async (req: { kind: string; id?: string; url?: string }) => {
      if (req.id === 'f1') throw new Error('down');
      return feed(String(req.id), episodes(2, 'g'));
    });

    const result = await sweepSubscriptions([sub('f1'), sub('f2')], { now: NOW });

    expect(result.checked).toBe(2); // both were attempted
    expect(resolveFeed).toHaveBeenCalledTimes(2);
  });

  it('ignores a subscription from the retired YouTube source', async () => {
    const result = await sweepSubscriptions([sub('yt:channel:abc')], { now: NOW });
    expect(resolveFeed).not.toHaveBeenCalled();
    expect(result.checked).toBe(0);
    expect(result.failed).toBe(0);
  });
});

describe('what the rail shows', () => {
  it('hides an episode that has been heard, wherever it was heard', async () => {
    // The played marks sync; the inbox does not. So an episode listened to on
    // another device stops being news here without anything else travelling.
    resolveFeed.mockResolvedValue(feed('f1', episodes(2)));
    await sweepSubscriptions([sub('f1')], { now: NOW });
    const grown = [
      ...episodes(2),
      {
        trackId: 'e2',
        trackName: 'Episode 2',
        releaseDate: new Date(NOW + DAY).toUTCString(),
        episodeUrl: 'https://cdn.example.com/e2.mp3',
        trackTimeMillis: 600_000,
      },
    ];
    resolveFeed.mockResolvedValue(feed('f1', grown));
    await sweepSubscriptions([sub('f1')], { now: NOW + CHECK_EVERY_MS + 1 });
    expect(pendingInbox()).toHaveLength(1);

    markPlayed('e2');

    expect(pendingInbox()).toHaveLength(0);
    // Still in the store, just not news: nothing was destroyed.
    expect(inbox()).toHaveLength(1);
  });

  it('drops a dismissed episode for good', async () => {
    resolveFeed.mockResolvedValue(feed('f1', episodes(1)));
    await sweepSubscriptions([sub('f1')], { now: NOW });
    resolveFeed.mockResolvedValue(
      feed('f1', [
        ...episodes(1),
        {
          trackId: 'e1',
          trackName: 'Episode 1',
          releaseDate: new Date(NOW + DAY).toUTCString(),
          episodeUrl: 'https://cdn.example.com/e1.mp3',
          trackTimeMillis: 600_000,
        },
      ]),
    );
    await sweepSubscriptions([sub('f1')], { now: NOW + CHECK_EVERY_MS + 1 });
    expect(pendingInbox()).toHaveLength(1);

    dismissInboxItem('f1', 'e1');

    expect(pendingInbox()).toHaveLength(0);
    expect(inbox()).toHaveLength(0);
  });

  it('survives a reload', async () => {
    resolveFeed.mockResolvedValue(feed('f1', episodes(1)));
    await sweepSubscriptions([sub('f1')], { now: NOW });
    resolveFeed.mockResolvedValue(
      feed('f1', [
        ...episodes(1),
        {
          trackId: 'e1',
          trackName: 'Fresh',
          releaseDate: new Date(NOW + DAY).toUTCString(),
          episodeUrl: 'https://cdn.example.com/e1.mp3',
          trackTimeMillis: 600_000,
        },
      ]),
    );
    await sweepSubscriptions([sub('f1')], { now: NOW + CHECK_EVERY_MS + 1 });

    loadInbox();

    expect(pendingInbox().map((i) => i.title)).toEqual(['Fresh']);
  });

  it('ignores junk in storage instead of throwing during boot', () => {
    localStorage.setItem('pp_inbox', '"not a list"');
    localStorage.setItem('pp_feed_seen', '[1,2,3]');
    expect(() => loadInbox()).not.toThrow();
    expect(inbox()).toEqual([]);
  });
});

describe('auto-download', () => {
  /** Grow `f1` by `n` episodes past the two it starts with. */
  async function publish(n: number): Promise<void> {
    resolveFeed.mockResolvedValue(feed('f1', episodes(2)));
    await sweepSubscriptions([sub('f1')], { now: NOW });
    const grown = [
      ...episodes(2),
      ...Array.from({ length: n }, (_, i) => ({
        trackId: `new${i}`,
        trackName: `New ${i}`,
        releaseDate: new Date(NOW + (i + 1) * DAY).toUTCString(),
        episodeUrl: `https://cdn.example.com/new${i}.mp3`,
        trackTimeMillis: 600_000,
      })),
    ];
    resolveFeed.mockResolvedValue(feed('f1', grown));
    await sweepSubscriptions([sub('f1')], { now: NOW + CHECK_EVERY_MS + 1 });
  }

  it('downloads nothing while the setting is off — which is the default', async () => {
    await publish(3);
    expect(startDownload).not.toHaveBeenCalled();
  });

  it('downloads what the sweep found when asked to', async () => {
    settings.set({ ...DEFAULT_SETTINGS, autoDownload: 'always' });
    await publish(3);
    expect(startDownload).toHaveBeenCalledTimes(3);
    const started = startDownload.mock.calls as unknown as Array<[Episode, string]>;
    expect(started.map((c) => c[0].trackId)).toEqual([
      'new0',
      'new1',
      'new2',
    ]);
  });

  it('caps how many it starts at once', async () => {
    // A show that publishes daily, opened after a holiday, would otherwise
    // start thirty transfers at the same moment.
    settings.set({ ...DEFAULT_SETTINGS, autoDownload: 'always' });
    await publish(12);
    expect(startDownload).toHaveBeenCalledTimes(5);
  });

  it('respects the connection, not just the setting', async () => {
    settings.set({ ...DEFAULT_SETTINGS, autoDownload: 'wifi' });
    vi.stubGlobal('navigator', { ...navigator, connection: { type: 'cellular' } });
    await publish(2);
    expect(startDownload).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('still records what it found when a download fails', async () => {
    settings.set({ ...DEFAULT_SETTINGS, autoDownload: 'always' });
    startDownload.mockRejectedValue(new Error('no space'));
    await publish(2);
    // The news survives the transfer: the rail is the point, the copy is a
    // convenience.
    expect(pendingInbox().map((i) => i.trackId).sort()).toEqual(['new0', 'new1']);
  });
});

describe('warming the cache', () => {
  it('stores every feed it fetched, so opening the show is instant', async () => {
    resolveFeed.mockResolvedValue(feed('f1', episodes(2)));
    await sweepSubscriptions([sub('f1')], { now: NOW });
    expect(putCachedFeed).toHaveBeenCalledTimes(1);
  });
});

describe('newSince', () => {
  const list = episodes(5);

  it('takes everything after the remembered id', () => {
    expect(newSince(list, { at: 0, newest: 'e2' }).map((e) => e.trackId)).toEqual(['e3', 'e4']);
  });

  it('is empty when the remembered id is still the newest', () => {
    expect(newSince(list, { at: 0, newest: 'e4' })).toEqual([]);
  });

  it('falls back to dates when the remembered id is gone', () => {
    // A feed that rotates its window, or one whose ids changed with the
    // Apple→RSS archive switch.
    const cutoff = NOW - 2.5 * DAY;
    expect(newSince(list, { at: cutoff, newest: 'vanished' }).map((e) => e.trackId)).toEqual([
      'e3',
      'e4',
    ]);
  });

  it('announces nothing from an undated feed whose id is gone', () => {
    // Guessing here would mean re-announcing a whole archive.
    const undated = list.map((e) => ({ ...e, releaseDate: '' }));
    expect(newSince(undated, { at: 0, newest: 'vanished' })).toEqual([]);
  });

  it('handles an empty feed', () => {
    expect(newSince([], { at: 0, newest: 'e1' })).toEqual([]);
  });
});

describe('applyAppBadge', () => {
  it('sets the count and clears it at zero', () => {
    const setAppBadge = vi.fn(async () => undefined);
    const clearAppBadge = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { setAppBadge, clearAppBadge });

    applyAppBadge(3);
    expect(setAppBadge).toHaveBeenCalledWith(3);

    applyAppBadge(0);
    expect(clearAppBadge).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('is a no-op where the platform has no badge', () => {
    vi.stubGlobal('navigator', {});
    expect(() => applyAppBadge(2)).not.toThrow();
    vi.unstubAllGlobals();
  });
});
