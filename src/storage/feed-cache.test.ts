/**
 * The feed cache's eviction policy.
 *
 * Nothing pruned this store before: only "clear all data" emptied it, so every
 * feed ever opened stayed forever. That was survivable while an Apple listing
 * meant 41 episodes and became a problem the moment it meant 2900 — one show
 * is now ~2.3 MB of records, and the first thing to suffer when an origin runs
 * out of quota is the downloads the listener chose to keep.
 */
import { describe, expect, it } from 'vitest';
import { feedsToEvict, type CachedFeed } from './db';

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const MB = 1024 * 1024;

const LIMITS = { maxAgeMs: 30 * DAY, budgetBytes: 10 * MB, keepMin: 2 };

function rec(id: string, ageDays: number, mb: number): CachedFeed {
  return {
    id,
    fetchedAt: NOW - ageDays * DAY,
    bytes: Math.round(mb * MB),
    feed: { meta: { id, name: id, artist: '', art: '' }, episodes: [], limited: false },
  };
}

describe('feedsToEvict — age', () => {
  it('drops what is older than the limit', () => {
    const all = [rec('fresh', 1, 1), rec('stale', 40, 1), rec('ancient', 400, 1), rec('a', 2, 1)];
    expect(feedsToEvict(all, 'fresh', NOW, LIMITS).sort()).toEqual(['ancient', 'stale']);
  });

  it('never drops the feed just written, however old the record claims to be', () => {
    // A device with a badly set clock would otherwise evict the copy it just
    // made, on every single load.
    const all = [rec('subject', 400, 1), rec('a', 1, 1), rec('b', 1, 1), rec('c', 1, 1)];
    expect(feedsToEvict(all, 'subject', NOW, LIMITS)).toEqual([]);
  });

  it('keeps a nearly-expired record', () => {
    const all = [rec('edge', 29.9, 1), rec('a', 1, 1), rec('b', 1, 1)];
    expect(feedsToEvict(all, 'a', NOW, LIMITS)).toEqual([]);
  });
});

describe('feedsToEvict — budget', () => {
  it('drops the oldest until the total fits', () => {
    const all = [
      rec('newest', 1, 4),
      rec('middle', 2, 4),
      rec('oldest', 3, 4),
      rec('older', 4, 4),
    ];
    // 4 MB each against a 10 MB budget: the two newest fit, the rest go.
    expect(feedsToEvict(all, 'newest', NOW, LIMITS).sort()).toEqual(['older', 'oldest']);
  });

  it('keeps everything when it already fits', () => {
    const all = [rec('a', 1, 1), rec('b', 2, 1), rec('c', 3, 1)];
    expect(feedsToEvict(all, 'a', NOW, LIMITS)).toEqual([]);
  });

  it('keeps the feed just written even when it is the thing over budget', () => {
    // A single 2900-episode archive can be most of the budget on its own, and
    // evicting it would make the write that triggered this pointless.
    const all = [rec('huge', 1, 40), rec('a', 2, 1), rec('b', 3, 1), rec('c', 4, 1)];
    const doomed = feedsToEvict(all, 'huge', NOW, LIMITS);
    expect(doomed).not.toContain('huge');
    expect(doomed.length).toBeGreaterThan(0);
  });

  it('stops at the floor rather than emptying the cache', () => {
    const all = [rec('a', 1, 50), rec('b', 2, 50), rec('c', 3, 50)];
    const doomed = feedsToEvict(all, 'a', NOW, LIMITS);
    expect(all.length - doomed.length).toBeGreaterThanOrEqual(LIMITS.keepMin);
  });

  it('does nothing at all while the store is at or under the floor', () => {
    expect(feedsToEvict([rec('a', 400, 99), rec('b', 400, 99)], 'a', NOW, LIMITS)).toEqual([]);
  });
});

describe('feedsToEvict — records from before the size was measured', () => {
  it('treats a missing size as free, so they age out rather than being purged', () => {
    // Reporting them as huge would empty the cache on the first write after an
    // upgrade; reporting them as free means the age rule collects them.
    const legacy: CachedFeed = {
      id: 'legacy',
      fetchedAt: NOW - DAY,
      feed: { meta: { id: 'legacy', name: '', artist: '', art: '' }, episodes: [], limited: false },
    };
    const all = [rec('a', 1, 6), legacy, rec('b', 2, 6), rec('c', 3, 1)];
    const doomed = feedsToEvict(all, 'a', NOW, LIMITS);
    expect(doomed).not.toContain('legacy');
  });

  it('collects them once they are old enough', () => {
    const legacy: CachedFeed = {
      id: 'legacy',
      fetchedAt: NOW - 90 * DAY,
      feed: { meta: { id: 'legacy', name: '', artist: '', art: '' }, episodes: [], limited: false },
    };
    const all = [rec('a', 1, 1), legacy, rec('b', 2, 1)];
    expect(feedsToEvict(all, 'a', NOW, LIMITS)).toEqual(['legacy']);
  });
});

describe('feedsToEvict — the real limits', () => {
  it('leaves a plausible library alone', () => {
    // 30 shows averaging 1 MB, all refreshed this week: nothing should go.
    const all = Array.from({ length: 30 }, (_, i) => rec('f' + i, i / 4, 1));
    expect(feedsToEvict(all, 'f0', NOW)).toEqual([]);
  });

  it('bounds a library of full archives', () => {
    // 60 shows at 2.3 MB each is ~138 MB, well past the 80 MB budget.
    const all = Array.from({ length: 60 }, (_, i) => rec('f' + i, i / 24, 2.3));
    const doomed = feedsToEvict(all, 'f0', NOW);
    expect(doomed.length).toBeGreaterThan(0);
    const keptBytes = all
      .filter((r) => !doomed.includes(r.id))
      .reduce((n, r) => n + (r.bytes ?? 0), 0);
    // The kept set is within one record of the budget: the loop admits the
    // record that crosses the line and evicts from there on.
    expect(keptBytes).toBeLessThanOrEqual(80 * MB + 2.3 * MB);
  });
});
