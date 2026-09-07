import { describe, expect, it } from 'vitest';
import type { FeedMeta } from '../feeds/types';
import type { QueueItem } from '../state/queue';
import {
  SIMULTANEITY_MS,
  TOMBSTONE_TTL_MS,
  capPayload,
  emptyPayload,
  isSyncPayload,
  mergePayload,
} from './merge';
import type { ProgressEntry, SyncPayload } from './types';

/**
 * The merge decides which of two devices' listening history survives, so a bug
 * here is silent data loss rather than a visible error. The last three tests
 * matter most: they assert the *properties* (commutative, idempotent, never
 * moves a position backwards) that make convergence possible at all, and they
 * catch reorderings that every branch test above them would still pass.
 */

const T0 = 1_700_000_000_000;
const NOW = T0 + 86_400_000;
const HOUR = 3_600_000;

// ── builders ──────────────────────────────────────────────────────────

function payload(p: Partial<SyncPayload> = {}): SyncPayload {
  return { ...emptyPayload(), ...p };
}

function prog(t: number, at: number): ProgressEntry {
  return { t, at };
}

function meta(id: string): FeedMeta {
  return { id, name: 'Show ' + id, artist: 'Host', art: '' };
}

function qi(feedId: string, trackId: string): QueueItem {
  return { feedId, trackId, title: 'T', feedName: 'F' };
}

describe('mergePayload — progress', () => {
  it('keeps the remote position when the remote stamp is more than a minute newer', () => {
    const out = mergePayload(
      payload({ progress: { a: prog(100, T0) } }),
      payload({ progress: { a: prog(400, T0 + 120_000) } }),
      NOW,
    );

    expect(out.progress['a']).toEqual({ t: 400, at: T0 + 120_000 });
  });

  it('keeps the local position when the local stamp is more than a minute newer', () => {
    const out = mergePayload(
      payload({ progress: { a: prog(400, T0 + 120_000) } }),
      payload({ progress: { a: prog(100, T0) } }),
      NOW,
    );

    expect(out.progress['a']).toEqual({ t: 400, at: T0 + 120_000 });
  });

  it('takes the furthest position when both devices wrote inside the simultaneity window', () => {
    // Both listened offline; the writes are seconds apart on unsynchronised
    // clocks, so they are unordered and the further position has to win.
    const out = mergePayload(
      payload({ progress: { a: prog(900, T0) } }),
      payload({ progress: { a: prog(120, T0 + 59_000) } }),
      NOW,
    );

    expect(out.progress['a']).toEqual({ t: 900, at: T0 + 59_000 });
  });

  it('takes the furthest position when neither entry carries a timestamp', () => {
    // Every entry written before this feature existed reports at: 0.
    const out = mergePayload(
      payload({ progress: { a: prog(300, 0) } }),
      payload({ progress: { a: prog(1200, 0) } }),
      NOW,
    );

    expect(out.progress['a']).toEqual({ t: 1200, at: 0 });
  });

  it('clamps a stamp more than 48 hours in the future, so a wrong clock cannot win', () => {
    const out = mergePayload(
      payload({ progress: { a: prog(10, NOW + 72 * HOUR) } }),
      payload({ progress: { a: prog(900, NOW - 1000) } }),
      NOW,
    );

    expect(out.progress['a']?.t).toBe(900);
  });

  it('leaves a stamp 47 hours in the future alone', () => {
    const out = mergePayload(
      payload({ progress: { a: prog(10, NOW + 47 * HOUR) } }),
      payload({ progress: { a: prog(900, NOW - 1000) } }),
      NOW,
    );

    expect(out.progress['a']).toEqual({ t: 10, at: NOW + 47 * HOUR });
  });

  it.each([
    ['only local', { a: prog(50, T0) }, {}, { t: 50, at: T0 }],
    ['only remote', {}, { a: prog(70, T0) }, { t: 70, at: T0 }],
  ])('keeps an entry present on one side only (%s)', (_label, l, r, expected) => {
    const out = mergePayload(payload({ progress: l }), payload({ progress: r }), NOW);

    expect(out.progress['a']).toEqual(expected);
  });

  it('has no entry for a key neither side carries', () => {
    const out = mergePayload(payload(), payload(), NOW);

    expect(out.progress).not.toHaveProperty('a');
  });

  it.each([[-1], [NaN], [Infinity], [null], [undefined]])(
    'treats a non-finite timestamp (%o) as zero',
    (bad) => {
      const out = mergePayload(
        payload({ progress: { a: prog(100, bad as unknown as number) } }),
        payload({ progress: { a: prog(500, 0) } }),
        NOW,
      );

      expect(out.progress['a']).toEqual({ t: 500, at: 0 });
    },
  );
});

describe('mergePayload — lastPlayed', () => {
  it('prefers the episode with more merged progress when both were written at once', () => {
    const out = mergePayload(
      payload({ progress: { a: prog(100, T0) }, lastPlayed: { f1: { ep: 'a', at: T0 } } }),
      payload({ progress: { b: prog(900, T0) }, lastPlayed: { f1: { ep: 'b', at: T0 } } }),
      NOW,
    );

    expect(out.lastPlayed['f1']).toEqual({ ep: 'b', at: T0 });
  });

  it('prefers the larger episode id when the progress ties too', () => {
    const out = mergePayload(
      payload({ progress: { a: prog(100, T0) }, lastPlayed: { f1: { ep: 'a', at: T0 } } }),
      payload({ progress: { b: prog(100, T0) }, lastPlayed: { f1: { ep: 'b', at: T0 } } }),
      NOW,
    );

    expect(out.lastPlayed['f1']).toEqual({ ep: 'b', at: T0 });
  });
});

describe('mergePayload — subscriptions', () => {
  it('removes the feed on the other device when one device unsubscribed', () => {
    const out = mergePayload(
      payload({ subs: { f1: { at: T0, meta: meta('f1') } } }),
      payload({ subs: { f1: { at: T0 + 240_000, removed: true } } }),
      NOW,
    );

    expect(out.subs['f1']).toEqual({ at: T0 + 240_000, removed: true });
  });

  it('does not resurrect the subscription when the tombstone is merged again', () => {
    // The reason tombstones exist: the merge is a union, so an absence loses to
    // the copy the other device still holds.
    const local = payload({ subs: { f1: { at: T0, meta: meta('f1') } } });
    const tombstoned = mergePayload(
      local,
      payload({ subs: { f1: { at: T0 + 240_000, removed: true } } }),
      NOW,
    );

    const out = mergePayload(local, tombstoned, NOW);

    expect(out.subs['f1']).toEqual({ at: T0 + 240_000, removed: true });
  });

  it('brings the feed back when the re-subscribe is stamped after the removal', () => {
    const out = mergePayload(
      payload({ subs: { f1: { at: T0 + 480_000, meta: meta('f1') } } }),
      payload({ subs: { f1: { at: T0 + 240_000, removed: true } } }),
      NOW,
    );

    expect(out.subs['f1']).toEqual({ at: T0 + 480_000, meta: meta('f1') });
  });

  it('keeps the subscription when an add and a remove land in the same window', () => {
    const out = mergePayload(
      payload({ subs: { f1: { at: T0, meta: meta('f1') } } }),
      payload({ subs: { f1: { at: T0 + 30_000, removed: true } } }),
      NOW,
    );

    expect(out.subs['f1']).toEqual({ at: T0 + 30_000, meta: meta('f1') });
  });

  it.each([
    ['drops', TOMBSTONE_TTL_MS + 1, false],
    ['keeps', TOMBSTONE_TTL_MS - HOUR, true],
  ])('%s a tombstone aged past the TTL boundary', (_label, age, present) => {
    const out = mergePayload(
      payload(),
      payload({ subs: { f1: { at: NOW - age, removed: true } } }),
      NOW,
    );

    expect(Object.hasOwn(out.subs, 'f1')).toBe(present);
  });
});

describe('mergePayload — queue', () => {
  it('replaces the whole queue rather than merging it item by item', () => {
    const out = mergePayload(
      payload({ queue: { list: [qi('f', 'A'), qi('f', 'B'), qi('f', 'C')], at: T0 } }),
      payload({ queue: { list: [qi('f', 'C'), qi('f', 'A')], at: T0 + 120_000 } }),
      NOW,
    );

    expect(out.queue.list).toEqual([qi('f', 'C'), qi('f', 'A')]);
  });

  it('keeps the longer queue when both were written in the same window', () => {
    const out = mergePayload(
      payload({ queue: { list: [qi('f', 'A'), qi('f', 'B')], at: T0 } }),
      payload({ queue: { list: [qi('f', 'C')], at: T0 + 20_000 } }),
      NOW,
    );

    expect(out.queue.list).toEqual([qi('f', 'A'), qi('f', 'B')]);
  });
});

// ── the properties that make convergence work ─────────────────────────

/**
 * Pairs chosen to hit every branch above. None uses a stamp beyond the future
 * cap, so clamping is the identity here and the properties are about the merge
 * itself rather than about normalisation.
 */
const PAIRS: ReadonlyArray<readonly [string, SyncPayload, SyncPayload]> = [
  [
    'ordered progress',
    payload({ progress: { a: prog(100, T0) } }),
    payload({ progress: { a: prog(400, T0 + 120_000) } }),
  ],
  [
    'concurrent progress',
    payload({ progress: { a: prog(900, T0) } }),
    payload({ progress: { a: prog(120, T0 + 59_000) } }),
  ],
  [
    'untimestamped progress',
    payload({ progress: { a: prog(300, 0) } }),
    payload({ progress: { a: prog(1200, 0) } }),
  ],
  [
    'disjoint keys',
    payload({ progress: { a: prog(10, T0) } }),
    payload({ progress: { b: prog(20, T0) } }),
  ],
  [
    'lastPlayed tie',
    payload({ progress: { a: prog(100, T0) }, lastPlayed: { f1: { ep: 'a', at: T0 } } }),
    payload({ progress: { b: prog(900, T0) }, lastPlayed: { f1: { ep: 'b', at: T0 } } }),
  ],
  [
    'tombstone vs subscription',
    payload({ subs: { f1: { at: T0, meta: meta('f1') } } }),
    payload({ subs: { f1: { at: T0 + 240_000, removed: true } } }),
  ],
  [
    'simultaneous add and remove',
    payload({ subs: { f1: { at: T0, meta: meta('f1') } } }),
    payload({ subs: { f1: { at: T0 + 30_000, removed: true } } }),
  ],
  [
    'queues of equal length in the same window',
    payload({ queue: { list: [qi('f', 'A'), qi('f', 'B')], at: T0 } }),
    payload({ queue: { list: [qi('f', 'C'), qi('f', 'D')], at: T0 + 10_000 } }),
  ],
];

describe('mergePayload — properties', () => {
  it.each(PAIRS)('is commutative for %s', (_label, a, b) => {
    expect(mergePayload(a, b, NOW)).toEqual(mergePayload(b, a, NOW));
  });

  it.each(PAIRS)('is idempotent for %s', (_label, a, b) => {
    const merged = mergePayload(a, b, NOW);

    expect(mergePayload(merged, b, NOW)).toEqual(merged);
    expect(mergePayload(merged, a, NOW)).toEqual(merged);
  });

  it.each(PAIRS)('never moves a position backwards without a clear winner (%s)', (_label, a, b) => {
    const out = mergePayload(a, b, NOW);

    for (const [key, entry] of Object.entries(out.progress)) {
      const l = a.progress[key];
      const r = b.progress[key];
      if (!l || !r) continue;

      const furthest = Math.max(l.t, r.t);
      const ordered = Math.abs(l.at - r.at) > SIMULTANEITY_MS;
      expect(entry.t === furthest || ordered).toBe(true);
    }
  });
});

describe('capPayload', () => {
  it('drops the oldest-stamped entries first', () => {
    const progress: Record<string, ProgressEntry> = {};
    for (let i = 0; i < 10; i++) progress['e' + i] = prog(i, T0 - i * HOUR);

    const out = capPayload(payload({ progress }), 4);

    expect(Object.keys(out.progress).sort()).toEqual(['e0', 'e1', 'e2', 'e3']);
  });

  it('leaves a payload under the cap untouched', () => {
    const p = payload({ progress: { a: prog(1, T0) } });

    expect(capPayload(p, 4)).toBe(p);
  });
});

describe('isSyncPayload', () => {
  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'x'],
    ['a version-only object', { v: 2 }],
    ['progress as an array', { ...emptyPayload(), progress: [] }],
    ['a string position', { ...emptyPayload(), progress: { a: { t: '90', at: T0 } } }],
    ['a missing queue', { v: 1, progress: {}, lastPlayed: {}, subs: {} }],
    // `meta` lands in the subscription list, which keys the feed cache and the
    // per-feed last-played pointers.
    ['a null sub meta', { ...emptyPayload(), subs: { f1: { at: T0, meta: null } } }],
    ['a string sub meta', { ...emptyPayload(), subs: { f1: { at: T0, meta: 'f1' } } }],
    ['a sub meta with no id', { ...emptyPayload(), subs: { f1: { at: T0, meta: { name: 'A' } } } }],
    [
      'a sub meta with an empty id',
      { ...emptyPayload(), subs: { f1: { at: T0, meta: { id: '' } } } },
    ],
    ['a null queue row', { ...emptyPayload(), queue: { list: [null], at: T0 } }],
    [
      'a queue row with no trackId',
      { ...emptyPayload(), queue: { list: [{ feedId: 'f1' }], at: T0 } },
    ],
  ])('rejects %s', (_label, value) => {
    expect(isSyncPayload(value)).toBe(false);
  });

  it('accepts a tombstone, which carries no meta at all', () => {
    expect(isSyncPayload({ ...emptyPayload(), subs: { f1: { at: T0, removed: true } } })).toBe(
      true,
    );
  });

  it('accepts a payload carrying unknown extra keys, so a newer version still merges', () => {
    expect(isSyncPayload({ ...emptyPayload(), somethingNew: { x: 1 } })).toBe(true);
  });

  it('accepts extra keys on a sub meta and a queue row', () => {
    const p = {
      ...emptyPayload(),
      subs: { f1: { at: T0, meta: { id: 'f1', name: 'A', artist: '', art: '', extra: 1 } } },
      queue: {
        list: [{ feedId: 'f1', trackId: 't1', title: 'T', feedName: 'A', extra: 1 }],
        at: T0,
      },
    };
    expect(isSyncPayload(p)).toBe(true);
  });
});
