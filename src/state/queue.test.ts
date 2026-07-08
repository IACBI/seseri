import { beforeEach, describe, expect, it } from 'vitest';
import { clearQueue, dequeueNext, enqueue, moveInQueue, queue, queuePosition, removeFromQueue } from './queue';

// The queue lives in a module-level signal, so isolate every test by
// resetting to empty before it runs.
beforeEach(() => clearQueue());

describe('enqueue', () => {
  it('appends ids in order', () => {
    enqueue('a');
    enqueue('b');
    expect(queue()).toEqual(['a', 'b']);
  });

  it('is idempotent — a duplicate id is not added twice', () => {
    enqueue('a');
    enqueue('a');
    expect(queue()).toEqual(['a']);
  });
});

describe('removeFromQueue', () => {
  it('removes the given id and leaves the rest in order', () => {
    enqueue('a');
    enqueue('b');
    enqueue('c');
    removeFromQueue('b');
    expect(queue()).toEqual(['a', 'c']);
  });

  it('is a no-op for an id that is not queued', () => {
    enqueue('a');
    removeFromQueue('zzz');
    expect(queue()).toEqual(['a']);
  });
});

describe('queuePosition', () => {
  it('returns the 1-based position for a queued id', () => {
    enqueue('a');
    enqueue('b');
    expect(queuePosition('a')).toBe(1);
    expect(queuePosition('b')).toBe(2);
  });

  it('returns 0 when the id is not queued', () => {
    enqueue('a');
    expect(queuePosition('missing')).toBe(0);
  });
});

describe('dequeueNext', () => {
  it('pops and returns the head, shrinking the queue', () => {
    enqueue('a');
    enqueue('b');
    expect(dequeueNext()).toBe('a');
    expect(queue()).toEqual(['b']);
  });

  it('returns undefined on an empty queue', () => {
    expect(dequeueNext()).toBeUndefined();
    expect(queue()).toEqual([]);
  });

  it('skips the just-ended id before popping the next', () => {
    // Head equals the ended episode: it is dropped, next becomes the result.
    enqueue('a');
    enqueue('b');
    enqueue('c');
    expect(dequeueNext('a')).toBe('b');
    expect(queue()).toEqual(['c']);
  });

  it('removes the ended id even when it is not at the head', () => {
    enqueue('a');
    enqueue('b');
    enqueue('c');
    // 'b' ended out of order: it is filtered, then the head ('a') is popped.
    expect(dequeueNext('b')).toBe('a');
    expect(queue()).toEqual(['c']);
  });

  it('returns undefined when the only queued id is the one that just ended', () => {
    enqueue('a');
    expect(dequeueNext('a')).toBeUndefined();
    expect(queue()).toEqual([]);
  });
});

describe('clearQueue', () => {
  it('empties the queue', () => {
    enqueue('a');
    enqueue('b');
    clearQueue();
    expect(queue()).toEqual([]);
  });
});

describe('moveInQueue', () => {
  it('swaps an id with its neighbor in the given direction', () => {
    enqueue('a');
    enqueue('b');
    enqueue('c');
    moveInQueue('c', -1);
    expect(queue()).toEqual(['a', 'c', 'b']);
    moveInQueue('a', 1);
    expect(queue()).toEqual(['c', 'a', 'b']);
  });

  it('is a no-op at the edges and for unknown ids', () => {
    enqueue('a');
    enqueue('b');
    moveInQueue('a', -1);
    moveInQueue('b', 1);
    moveInQueue('zz', 1);
    expect(queue()).toEqual(['a', 'b']);
  });
});
