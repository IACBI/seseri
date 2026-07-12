import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CachedFeed } from '../../storage/db';
import type { Episode, FeedMeta, FeedRequest } from '../../feeds/types';

/**
 * continueListening() is a READ-ONLY aggregator: it may only read
 * subscriptions, progress, the last-feed pointer and the idb feed cache, and
 * must never write. All four storage modules are mocked with in-memory,
 * inspectable state so we can drive every branch and prove zero writes.
 */

// Hoisted, controllable state shared by the mock factories below.
const state = vi.hoisted(() => ({
  subs: [] as FeedMeta[],
  /** Value returned for local.get('pp_last_feed', …). */
  lastFeed: null as FeedRequest | null,
  /** feedId → last-played episodeId */
  lastPlayed: new Map<string, string>(),
  /** episodeId → saved seconds */
  progress: new Map<string, number>(),
  /** feedId → CachedFeed */
  cached: new Map<string, CachedFeed>(),
  /** every attempted write, by name — must stay empty */
  writes: [] as string[],
}));

vi.mock('../../storage/subscriptions', () => ({
  subscriptions: () => state.subs,
}));

vi.mock('../../storage/progress', () => ({
  getLastPlayed: vi.fn((feedId: string) => state.lastPlayed.get(feedId) ?? null),
  getProgress: vi.fn((id: string) => state.progress.get(id) ?? 0),
}));

vi.mock('../../storage/local', () => ({
  local: {
    get: vi.fn((key: string, fallback: unknown) =>
      key === 'pp_last_feed' ? state.lastFeed : fallback,
    ),
    rawGet: vi.fn(() => null),
    set: vi.fn(() => {
      state.writes.push('local.set');
    }),
    rawSet: vi.fn(() => {
      state.writes.push('local.rawSet');
    }),
    remove: vi.fn(() => {
      state.writes.push('local.remove');
    }),
    clear: vi.fn(() => {
      state.writes.push('local.clear');
    }),
  },
}));

vi.mock('../../storage/db', () => ({
  getCachedFeed: vi.fn(async (id: string) => state.cached.get(id)),
  putCachedFeed: vi.fn(async () => {
    state.writes.push('db.putCachedFeed');
  }),
}));

import { continueListening } from './continue-listening';
import { local } from '../../storage/local';
import { putCachedFeed } from '../../storage/db';

// ── builders ─────────────────────────────────────────────────────────
function ep(trackId: string, ms = 100_000): Episode {
  return { trackId, trackName: 'Ep ' + trackId, releaseDate: '', episodeUrl: '', trackTimeMillis: ms };
}
function meta(id: string): FeedMeta {
  return { id, name: 'Feed ' + id, artist: 'Artist ' + id, art: '' };
}
/** Register a cached iTunes feed and its last-played + progress in one shot. */
function seedFeed(
  id: string,
  opts: { episodes?: Episode[]; lastPlayed?: string; progressSec?: number } = {},
): void {
  const episodes = opts.episodes ?? [ep('e' + id)];
  state.cached.set(id, { id, feed: { meta: meta(id), episodes, limited: false }, fetchedAt: 0 });
  if (opts.lastPlayed) state.lastPlayed.set(id, opts.lastPlayed);
  if (opts.progressSec != null) state.progress.set(opts.lastPlayed ?? 'e' + id, opts.progressSec);
}

beforeEach(() => {
  state.subs = [];
  state.lastFeed = null;
  state.lastPlayed.clear();
  state.progress.clear();
  state.cached.clear();
  state.writes = [];
  vi.clearAllMocks();
});

afterEach(() => {
  // Nothing in this module is allowed to persist state.
  expect(state.writes).toEqual([]);
});

describe('continueListening — inclusion rules', () => {
  it('includes only cached feeds that have a last-played episode with progress > 5s', async () => {
    // Included: cached, last-played, 50s of 100s.
    seedFeed('100', { lastPlayed: 'e100', progressSec: 50 });
    // Skipped: progress at the 5s floor (positionSec <= 5 is not resumable).
    seedFeed('200', { lastPlayed: 'e200', progressSec: 5 });
    // Skipped: has progress but its feed was never cached.
    state.lastPlayed.set('300', 'e300');
    state.progress.set('e300', 60);
    // Skipped: cached but no saved last-played pointer.
    seedFeed('400');
    state.subs = [meta('100'), meta('200'), meta('300'), meta('400')];

    const out = await continueListening();

    expect(out).toHaveLength(1);
    const item = out[0]!;
    expect(item.feed.id).toBe('100');
    expect(item.episode.trackId).toBe('e100');
    expect(item.positionSec).toBe(50);
    expect(item.percent).toBeCloseTo(50);
  });

  it('skips finished episodes (>= 96%) but keeps partially-heard ones', async () => {
    seedFeed('100', { lastPlayed: 'e100', progressSec: 98 }); // 98% → finished → skip
    seedFeed('200', { lastPlayed: 'e200', progressSec: 40 }); // 40% → keep
    state.subs = [meta('100'), meta('200')];

    const out = await continueListening();

    expect(out).toHaveLength(1);
    expect(out[0]!.feed.id).toBe('200');
  });
});

describe('continueListening — ordering & dedupe', () => {
  it('puts the pp_last_feed item first and never duplicates it with its subscription', async () => {
    seedFeed('100', { lastPlayed: 'e100', progressSec: 30 });
    seedFeed('200', { lastPlayed: 'e200', progressSec: 40 });
    state.subs = [meta('100'), meta('200')];
    // Most-recent pointer aims at the *second* subscription.
    state.lastFeed = { kind: 'itunes', id: '200' };

    const out = await continueListening();

    expect(out.map((i) => i.feed.id)).toEqual(['200', '100']); // 200 hoisted, not repeated
  });
});

describe('continueListening — limit', () => {
  it('caps the result at the requested limit', async () => {
    for (const id of ['100', '200', '300', '400']) {
      seedFeed(id, { lastPlayed: 'e' + id, progressSec: 42 });
    }
    state.subs = ['100', '200', '300', '400'].map(meta);

    expect(await continueListening(2)).toHaveLength(2);
    expect(await continueListening()).toHaveLength(4); // default limit (6) not reached
  });
});

describe('continueListening — no writes', () => {
  it('performs no persistence for any storage layer', async () => {
    seedFeed('100', { lastPlayed: 'e100', progressSec: 30 });
    state.subs = [meta('100')];
    state.lastFeed = { kind: 'itunes', id: '100' };

    await continueListening();

    // The afterEach guard also checks state.writes; assert on the mocks directly.
    expect(vi.mocked(local.set)).not.toHaveBeenCalled();
    expect(vi.mocked(local.rawSet)).not.toHaveBeenCalled();
    expect(vi.mocked(putCachedFeed)).not.toHaveBeenCalled();
  });
});
