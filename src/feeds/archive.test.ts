// @vitest-environment jsdom
/**
 * The Apple→RSS archive switch, and the migration that makes it safe.
 *
 * The whole reason this was an open question for so long is the blast radius:
 * an episode's id is the key for its resume position, its place in the queue
 * and its downloaded bytes. Getting the migration wrong does not show up as an
 * error — it shows up as a listener's history quietly disappearing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Episode } from './types';
import { buildEpisodeRemap, applyEpisodeRemap, needsArchive } from './archive';
import {
  loadProgress,
  getProgress,
  setProgress,
  getLastPlayed,
  setLastPlayed,
  saveProgressNow,
} from '../storage/progress';
import { clearQueue, enqueue, loadQueue, queue } from '../state/queue';

const remapDownload = vi.hoisted(() => vi.fn(async (_f: string, _t: string) => false));
vi.mock('../player/offline', () => ({ remapDownload }));

function ep(trackId: string, episodeUrl: string, extra: Partial<Episode> = {}): Episode {
  return {
    trackId,
    trackName: 'Ep ' + trackId,
    releaseDate: '',
    episodeUrl,
    trackTimeMillis: 0,
    ...extra,
  };
}

beforeEach(() => {
  localStorage.clear();
  loadProgress();
  loadQueue();
  clearQueue();
  remapDownload.mockReset();
  remapDownload.mockResolvedValue(false);
});

describe('buildEpisodeRemap', () => {
  it('joins the two sources on the enclosure url', () => {
    const apple = [ep('1001', 'https://cdn.example.com/a.mp3'), ep('1002', 'https://cdn.example.com/b.mp3')];
    const archive = [ep('guid-a', 'https://cdn.example.com/a.mp3'), ep('guid-b', 'https://cdn.example.com/b.mp3')];
    expect(buildEpisodeRemap(apple, archive)).toEqual([
      ['1001', 'guid-a'],
      ['1002', 'guid-b'],
    ]);
  });

  it('ignores tracking parameters, which the two sources spell differently', () => {
    const apple = [ep('1001', 'https://cdn.example.com/a.mp3?ref=itunes&t=123')];
    const archive = [ep('guid-a', 'https://cdn.example.com/a.mp3?utm_source=feed')];
    expect(buildEpisodeRemap(apple, archive)).toEqual([['1001', 'guid-a']]);
  });

  it('ignores a scheme difference', () => {
    const apple = [ep('1001', 'https://cdn.example.com/a.mp3')];
    const archive = [ep('guid-a', 'HTTPS://CDN.example.com/a.mp3')];
    expect(buildEpisodeRemap(apple, archive)).toEqual([['1001', 'guid-a']]);
  });

  it('leaves archive-only episodes alone — there is nothing to migrate', () => {
    const apple = [ep('1001', 'https://cdn.example.com/a.mp3')];
    const archive = [
      ep('guid-a', 'https://cdn.example.com/a.mp3'),
      ep('guid-old', 'https://cdn.example.com/ancient.mp3'),
    ];
    expect(buildEpisodeRemap(apple, archive)).toEqual([['1001', 'guid-a']]);
  });

  it('skips episodes whose id did not change', () => {
    // Apple falls back to the enclosure URL as its id when it has no trackId,
    // and so does the feed when it has no guid — they can agree by accident.
    const url = 'https://cdn.example.com/a.mp3';
    expect(buildEpisodeRemap([ep(url, url)], [ep(url, url)])).toEqual([]);
  });

  it('maps a duplicated enclosure only once', () => {
    const apple = [ep('1001', 'https://cdn.example.com/a.mp3'), ep('1002', 'https://cdn.example.com/a.mp3')];
    const archive = [ep('guid-a', 'https://cdn.example.com/a.mp3')];
    expect(buildEpisodeRemap(apple, archive)).toEqual([['1001', 'guid-a']]);
  });

  it('produces nothing from episodes with no enclosure', () => {
    expect(buildEpisodeRemap([ep('1001', '')], [ep('guid-a', '')])).toEqual([]);
  });
});

describe('applyEpisodeRemap', () => {
  const FEED = '777000111';
  const PAIRS = [
    ['1001', 'guid-a'],
    ['1002', 'guid-b'],
  ] as const;

  it('moves a saved position onto the new id', async () => {
    setProgress('1001', 431.5);
    const report = await applyEpisodeRemap(FEED, PAIRS);

    expect(report.positions).toBe(1);
    expect(getProgress('guid-a')).toBe(431.5);
    // And does not leave a duplicate behind under the old id.
    expect(getProgress('1001')).toBe(0);
  });

  it('carries the position stamp, so sync does not treat it as brand new', async () => {
    setProgress('1001', 100);
    // The write is throttled; nothing is in storage to compare against until
    // it is flushed.
    saveProgressNow();
    const stampBefore = JSON.parse(localStorage.getItem('pp_prog_at') ?? '{}') as Record<string, number>;
    expect(stampBefore['1001']).toBeTypeOf('number');
    await applyEpisodeRemap(FEED, PAIRS);
    const stampAfter = JSON.parse(localStorage.getItem('pp_prog_at') ?? '{}') as Record<string, number>;

    expect(stampAfter['guid-a']).toBe(stampBefore['1001']);
    expect(stampAfter['1001']).toBeUndefined();
  });

  it('keeps a position already written against the new id', async () => {
    setProgress('1001', 10);
    setProgress('guid-a', 900);
    await applyEpisodeRemap(FEED, PAIRS);
    // The new id's value was written by a build that already had the archive,
    // so it is the newer of the two by construction.
    expect(getProgress('guid-a')).toBe(900);
    expect(getProgress('1001')).toBe(0);
  });

  it('repoints the last-played marker', async () => {
    setLastPlayed(FEED, '1002');
    const report = await applyEpisodeRemap(FEED, PAIRS);
    expect(report.lastPlayed).toBe(true);
    expect(getLastPlayed(FEED)).toBe('guid-b');
  });

  it('leaves the last-played marker alone when it is not in the remap', async () => {
    setLastPlayed(FEED, 'something-else');
    const report = await applyEpisodeRemap(FEED, PAIRS);
    expect(report.lastPlayed).toBe(false);
    expect(getLastPlayed(FEED)).toBe('something-else');
  });

  it('rewrites queued items of this feed only', async () => {
    enqueue({ feedId: FEED, trackId: '1001', title: 'Mine', feedName: 'Pod' });
    enqueue({ feedId: 'other', trackId: '1001', title: 'Theirs', feedName: 'Other' });

    const report = await applyEpisodeRemap(FEED, PAIRS);

    expect(report.queued).toBe(1);
    expect(queue().map((q) => [q.feedId, q.trackId])).toEqual([
      [FEED, 'guid-a'],
      ['other', '1001'],
    ]);
  });

  it('does not restamp the queue, which would win every later sync conflict', async () => {
    enqueue({ feedId: FEED, trackId: '1001', title: 'Mine', feedName: 'Pod' });
    const stampBefore = localStorage.getItem('pp_queue_at');
    await applyEpisodeRemap(FEED, PAIRS);
    expect(localStorage.getItem('pp_queue_at')).toBe(stampBefore);
  });

  it('re-keys downloads and counts the ones that moved', async () => {
    remapDownload.mockImplementation(async (from: string) => from === '1002');
    const report = await applyEpisodeRemap(FEED, PAIRS);

    expect(remapDownload).toHaveBeenCalledWith('1001', 'guid-a');
    expect(remapDownload).toHaveBeenCalledWith('1002', 'guid-b');
    expect(report.downloads).toBe(1);
  });

  it('is safe to run twice', async () => {
    setProgress('1001', 55);
    enqueue({ feedId: FEED, trackId: '1001', title: 'Mine', feedName: 'Pod' });
    setLastPlayed(FEED, '1001');

    await applyEpisodeRemap(FEED, PAIRS);
    const second = await applyEpisodeRemap(FEED, PAIRS);

    expect(second).toEqual({ positions: 0, queued: 0, downloads: 0, lastPlayed: false });
    expect(getProgress('guid-a')).toBe(55);
    expect(getLastPlayed(FEED)).toBe('guid-a');
    expect(queue()[0]?.trackId).toBe('guid-a');
  });

  it('does nothing at all for an empty remap', async () => {
    setProgress('1001', 12);
    const report = await applyEpisodeRemap(FEED, []);
    expect(report).toEqual({ positions: 0, queued: 0, downloads: 0, lastPlayed: false });
    expect(getProgress('1001')).toBe(12);
    expect(remapDownload).not.toHaveBeenCalled();
  });
});

describe('needsArchive', () => {
  it('is exactly Apple admitting the list is short', () => {
    const base = { meta: { id: '1', name: '', artist: '', art: '' }, episodes: [] };
    expect(needsArchive({ ...base, limited: true })).toBe(true);
    expect(needsArchive({ ...base, limited: false })).toBe(false);
  });
});
