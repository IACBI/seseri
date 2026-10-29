import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearQueue,
  dequeueNext,
  enqueue,
  loadQueue,
  moveInQueue,
  queue,
  queuePosition,
  queuePositions,
  queueSnapshot,
  removeFromQueue,
  type QueueItem,
} from './queue';

/** Terse builder — most tests only care about the identity pair. */
const item = (feedId: string, trackId: string, title = trackId): QueueItem => ({
  feedId,
  trackId,
  title,
  feedName: feedId,
});

const ids = (): string[] => queue().map((x) => `${x.feedId}/${x.trackId}`);

/** Install a minimal localStorage for the load tests, then take it away. */
function withStored(value: string | null, fn: () => void): void {
  globalThis.localStorage = {
    getItem: (k: string) => (k === 'pp_queue' ? value : null),
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  } as unknown as Storage;
  try {
    fn();
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
}

// The queue lives in a module-level signal, so isolate every test by
// resetting to empty before it runs.
beforeEach(() => clearQueue());

describe('enqueue', () => {
  it('appends items in order', () => {
    enqueue(item('f1', 'a'));
    enqueue(item('f1', 'b'));
    expect(ids()).toEqual(['f1/a', 'f1/b']);
  });

  it('is idempotent — the same episode is not added twice', () => {
    enqueue(item('f1', 'a'));
    enqueue(item('f1', 'a', 'a different label'));
    expect(ids()).toEqual(['f1/a']);
  });

  it('treats the same trackId in another feed as a different episode', () => {
    // RSS guids are only unique within their own feed.
    enqueue(item('f1', 'a'));
    enqueue(item('f2', 'a'));
    expect(ids()).toEqual(['f1/a', 'f2/a']);
  });
});

describe('removeFromQueue', () => {
  it('removes the given item and leaves the rest in order', () => {
    enqueue(item('f1', 'a'));
    enqueue(item('f1', 'b'));
    enqueue(item('f1', 'c'));
    removeFromQueue({ feedId: 'f1', trackId: 'b' });
    expect(ids()).toEqual(['f1/a', 'f1/c']);
  });

  it('is a no-op for an episode that is not queued', () => {
    enqueue(item('f1', 'a'));
    removeFromQueue({ feedId: 'f1', trackId: 'zzz' });
    removeFromQueue({ feedId: 'other', trackId: 'a' });
    expect(ids()).toEqual(['f1/a']);
  });
});

describe('queuePosition', () => {
  it('returns the 1-based position for a queued episode', () => {
    enqueue(item('f1', 'a'));
    enqueue(item('f2', 'b'));
    expect(queuePosition({ feedId: 'f1', trackId: 'a' })).toBe(1);
    expect(queuePosition({ feedId: 'f2', trackId: 'b' })).toBe(2);
  });

  it('returns 0 when the episode is not queued', () => {
    enqueue(item('f1', 'a'));
    expect(queuePosition({ feedId: 'f1', trackId: 'missing' })).toBe(0);
    expect(queuePosition({ feedId: 'f2', trackId: 'a' })).toBe(0);
  });
});

describe('queuePositions', () => {
  it('keeps global positions but only lists the asked-for feed', () => {
    enqueue(item('f1', 'a'));
    enqueue(item('f2', 'x'));
    enqueue(item('f1', 'b'));
    // The badge must show where the episode sits in the WHOLE queue.
    expect([...queuePositions('f1')]).toEqual([
      ['a', 1],
      ['b', 3],
    ]);
    expect([...queuePositions('f2')]).toEqual([['x', 2]]);
  });
});

describe('dequeueNext', () => {
  it('pops and returns the head, shrinking the queue', () => {
    enqueue(item('f1', 'a'));
    enqueue(item('f1', 'b'));
    expect(dequeueNext()?.trackId).toBe('a');
    expect(ids()).toEqual(['f1/b']);
  });

  it('returns undefined on an empty queue', () => {
    expect(dequeueNext()).toBeUndefined();
    expect(ids()).toEqual([]);
  });

  it('does not restamp an empty queue, which would wipe the other device’s on sync', () => {
    const before = queueSnapshot().at;
    vi.useFakeTimers();
    vi.setSystemTime(before + 60_000);
    try {
      expect(dequeueNext({ feedId: 'f1', trackId: 'x' })).toBeUndefined();
      expect(queueSnapshot().at).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips the just-ended episode before popping the next', () => {
    enqueue(item('f1', 'a'));
    enqueue(item('f1', 'b'));
    enqueue(item('f1', 'c'));
    expect(dequeueNext({ feedId: 'f1', trackId: 'a' })?.trackId).toBe('b');
    expect(ids()).toEqual(['f1/c']);
  });

  it('removes the ended episode even when it is not at the head', () => {
    enqueue(item('f1', 'a'));
    enqueue(item('f1', 'b'));
    enqueue(item('f1', 'c'));
    expect(dequeueNext({ feedId: 'f1', trackId: 'b' })?.trackId).toBe('a');
    expect(ids()).toEqual(['f1/c']);
  });

  it('returns undefined when the only queued episode is the one that ended', () => {
    enqueue(item('f1', 'a'));
    expect(dequeueNext({ feedId: 'f1', trackId: 'a' })).toBeUndefined();
    expect(ids()).toEqual([]);
  });

  it('hands back the next episode even when it belongs to another feed', () => {
    // Cross-feed auto-next is the whole point of carrying feedId on the entry.
    enqueue(item('f2', 'x'));
    expect(dequeueNext({ feedId: 'f1', trackId: 'a' })).toMatchObject({
      feedId: 'f2',
      trackId: 'x',
    });
  });
});

describe('clearQueue', () => {
  it('empties the queue', () => {
    enqueue(item('f1', 'a'));
    enqueue(item('f1', 'b'));
    clearQueue();
    expect(ids()).toEqual([]);
  });
});

describe('moveInQueue', () => {
  it('swaps an item with its neighbor in the given direction', () => {
    enqueue(item('f1', 'a'));
    enqueue(item('f1', 'b'));
    enqueue(item('f1', 'c'));
    moveInQueue({ feedId: 'f1', trackId: 'c' }, -1);
    expect(ids()).toEqual(['f1/a', 'f1/c', 'f1/b']);
    moveInQueue({ feedId: 'f1', trackId: 'a' }, 1);
    expect(ids()).toEqual(['f1/c', 'f1/a', 'f1/b']);
  });

  it('is a no-op at the edges and for unknown items', () => {
    enqueue(item('f1', 'a'));
    enqueue(item('f1', 'b'));
    moveInQueue({ feedId: 'f1', trackId: 'a' }, -1);
    moveInQueue({ feedId: 'f1', trackId: 'b' }, 1);
    moveInQueue({ feedId: 'f1', trackId: 'zz' }, 1);
    expect(ids()).toEqual(['f1/a', 'f1/b']);
  });
});

describe('loadQueue', () => {
  it('drops malformed and duplicate entries instead of throwing', () => {
    // Simulates a hand-edited or half-written `pp_queue` value.
    const raw = JSON.stringify([
      { feedId: 'f1', trackId: 'a', title: 'A', feedName: 'Feed 1' },
      { feedId: 'f1', trackId: 'a', title: 'dup' },
      { feedId: '', trackId: 'b' },
      { trackId: 'c' },
      null,
      'nonsense',
      { feedId: 'f2', trackId: 'd' },
    ]);
    withStored(raw, () => {
      loadQueue();
      expect(ids()).toEqual(['f1/a', 'f2/d']);
      // Missing labels default to empty strings, never undefined.
      expect(queue()[1]).toEqual({ feedId: 'f2', trackId: 'd', title: '', feedName: '' });
    });
  });

  it('resets to empty when the stored value is not an array', () => {
    enqueue(item('f1', 'a'));
    withStored('{"nope":true}', () => {
      loadQueue();
      expect(ids()).toEqual([]);
    });
  });
});
