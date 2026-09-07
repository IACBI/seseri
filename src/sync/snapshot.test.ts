import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedMeta } from '../feeds/types';
import type { QueueItem } from '../state/queue';
import { emptyPayload } from './merge';
import type { SyncPayload } from './types';

/**
 * Snapshot is the only module in `src/sync/` allowed to touch storage, so these
 * tests pin two things: that reading is genuinely read-only, and that clock
 * skew is applied exactly once in each direction. Getting the skew sign wrong
 * would silently hand every conflict to whichever device has the faster clock.
 */

const T0 = 1_700_000_000_000;
const SKEW = 3_600_000;

const state = vi.hoisted(() => ({
  prog: {} as Record<string, number>,
  progAt: {} as Record<string, number>,
  lastAt: {} as Record<string, number>,
  lastPlayed: new Map<string, string>(),
  subs: [] as FeedMeta[],
  subAt: {} as Record<string, number>,
  subRm: {} as Record<string, number>,
  queue: [] as QueueItem[],
  queueAt: 0,
  /** every attempted write, by name — must stay empty while only reading */
  writes: [] as string[],
}));

vi.mock('../storage/progress', () => ({
  progressSnapshot: () => ({
    prog: { ...state.prog },
    progAt: { ...state.progAt },
    lastAt: { ...state.lastAt },
  }),
  getLastPlayed: (feedId: string) => state.lastPlayed.get(feedId) ?? null,
  mergeProgress: vi.fn(() => {
    state.writes.push('mergeProgress');
  }),
}));

vi.mock('../storage/subscriptions', () => ({
  subscriptionsSnapshot: () => ({
    list: state.subs.slice(),
    at: { ...state.subAt },
    removed: { ...state.subRm },
  }),
  setSubscriptionsStamped: vi.fn(() => {
    state.writes.push('setSubscriptionsStamped');
  }),
}));

vi.mock('../state/queue', () => ({
  queueSnapshot: () => ({ list: state.queue.slice(), at: state.queueAt }),
  setQueueStamped: vi.fn(() => {
    state.writes.push('setQueueStamped');
  }),
}));

import { mergeProgress } from '../storage/progress';
import { setSubscriptionsStamped } from '../storage/subscriptions';
import { setQueueStamped } from '../state/queue';
import { applyPayload, readLocalPayload } from './snapshot';

// ── builders ──────────────────────────────────────────────────────────

function meta(id: string): FeedMeta {
  return { id, name: 'Show ' + id, artist: 'Host', art: '' };
}

function qi(feedId: string, trackId: string): QueueItem {
  return { feedId, trackId, title: 'T', feedName: 'F' };
}

function payload(p: Partial<SyncPayload> = {}): SyncPayload {
  return { ...emptyPayload(), ...p };
}

beforeEach(() => {
  state.prog = {};
  state.progAt = {};
  state.lastAt = {};
  state.lastPlayed = new Map();
  state.subs = [];
  state.subAt = {};
  state.subRm = {};
  state.queue = [];
  state.queueAt = 0;
  state.writes = [];
  vi.clearAllMocks();
});

describe('readLocalPayload', () => {
  it('gathers progress, pointers, subscriptions and the queue into one payload', () => {
    state.prog = { '111': 942.5 };
    state.progAt = { '111': T0 };
    state.lastAt = { f1: T0 };
    state.lastPlayed.set('f1', '111');
    state.subs = [meta('f1')];
    state.subAt = { f1: T0 };
    state.subRm = { f9: T0 - 1000 };
    state.queue = [qi('f1', '222')];
    state.queueAt = T0;

    expect(readLocalPayload(0)).toEqual({
      ...emptyPayload(),
      progress: { '111': { t: 942.5, at: T0 } },
      lastPlayed: { f1: { ep: '111', at: T0 } },
      subs: {
        f1: { at: T0, meta: meta('f1') },
        f9: { at: T0 - 1000, removed: true },
      },
      queue: { list: [qi('f1', '222')], at: T0 },
    });
  });

  it('reports an entry with no sidecar stamp as zero', () => {
    state.prog = { '111': 10 };

    expect(readLocalPayload(0).progress['111']).toEqual({ t: 10, at: 0 });
  });

  it('drops a pointer whose episode id is gone', () => {
    state.lastAt = { f1: T0 };

    expect(readLocalPayload(0).lastPlayed).toEqual({});
  });

  it('adds the measured skew to every real stamp on the way out', () => {
    state.prog = { '111': 10 };
    state.progAt = { '111': T0 };
    state.queueAt = T0;

    const out = readLocalPayload(SKEW);

    expect(out.progress['111']?.at).toBe(T0 + SKEW);
    expect(out.queue.at).toBe(T0 + SKEW);
  });

  it('leaves an unknown stamp at zero rather than shifting it by the skew', () => {
    // 0 means "we do not know when this happened", not "1970". Shifting it
    // would turn every pre-sync entry into a dated one and let it win.
    state.prog = { '111': 10 };
    state.progAt = { '111': 0 };

    expect(readLocalPayload(SKEW).progress['111']?.at).toBe(0);
  });

  it('performs no writes', () => {
    state.prog = { '111': 10 };
    state.subs = [meta('f1')];

    readLocalPayload(SKEW);

    expect(state.writes).toEqual([]);
  });
});

describe('applyPayload', () => {
  it('writes each store exactly once', () => {
    applyPayload(
      payload({
        progress: { '111': { t: 50, at: T0 }, '222': { t: 70, at: T0 } },
        subs: { f1: { at: T0, meta: meta('f1') }, f2: { at: T0, meta: meta('f2') } },
      }),
      0,
      new Set(),
    );

    expect(mergeProgress).toHaveBeenCalledTimes(1);
    expect(setSubscriptionsStamped).toHaveBeenCalledTimes(1);
    expect(setQueueStamped).toHaveBeenCalledTimes(1);
  });

  it('leaves the currently playing episode alone', () => {
    applyPayload(
      payload({ progress: { '111': { t: 5, at: T0 }, '222': { t: 70, at: T0 } } }),
      0,
      new Set(['111']),
    );

    expect(vi.mocked(mergeProgress).mock.calls[0]?.[0]).toEqual({ '222': { t: 70, at: T0 } });
  });

  it('subtracts the measured skew from every real stamp on the way in', () => {
    applyPayload(
      payload({
        progress: { '111': { t: 50, at: T0 + SKEW }, '222': { t: 1, at: 0 } },
        queue: { list: [], at: T0 + SKEW },
      }),
      SKEW,
      new Set(),
    );

    expect(vi.mocked(mergeProgress).mock.calls[0]?.[0]).toEqual({
      '111': { t: 50, at: T0 },
      '222': { t: 1, at: 0 },
    });
    expect(vi.mocked(setQueueStamped).mock.calls[0]?.[1]).toBe(T0);
  });

  it('passes the last-played pointers through to storage', () => {
    applyPayload(payload({ lastPlayed: { f1: { ep: '111', at: T0 } } }), 0, new Set());

    expect(vi.mocked(mergeProgress).mock.calls[0]?.[1]).toEqual({ f1: { ep: '111', at: T0 } });
  });

  it('removes a tombstoned feed from the stored list', () => {
    state.subs = [meta('f1'), meta('f2')];

    applyPayload(
      payload({ subs: { f1: { at: T0, meta: meta('f1') }, f2: { at: T0 + 1, removed: true } } }),
      0,
      new Set(),
    );

    const [list, at, removed] = vi.mocked(setSubscriptionsStamped).mock.calls[0] ?? [];
    expect(list).toEqual([meta('f1')]);
    expect(at).toEqual({ f1: T0 });
    expect(removed).toEqual({ f2: T0 + 1 });
  });

  it('keeps the order the user already sees and appends new feeds oldest first', () => {
    // Re-sorting the library on every sync would read as a bug.
    state.subs = [meta('b'), meta('a')];

    applyPayload(
      payload({
        subs: {
          a: { at: T0, meta: meta('a') },
          b: { at: T0, meta: meta('b') },
          z: { at: T0 + 10, meta: meta('z') },
          y: { at: T0 + 5, meta: meta('y') },
        },
      }),
      0,
      new Set(),
    );

    expect(vi.mocked(setSubscriptionsStamped).mock.calls[0]?.[0]).toEqual([
      meta('b'),
      meta('a'),
      meta('y'),
      meta('z'),
    ]);
  });
});

afterEach(() => {
  vi.clearAllMocks();
});
