// @vitest-environment jsdom
/**
 * `pp_favs` is not only written by the app: `restoreBackup` copies it straight
 * out of a hand-editable JSON file, and sync supplies it from another build's
 * `subs[].meta`. `loadSubscriptions` runs inside `boot()` before any view
 * renders, so anything it throws on takes the whole app down — and the value
 * that caused it is in localStorage, so it does it again on every reload.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  addSubscriptions,
  refreshSubscription,
  loadSubscriptions,
  sanitizeSubscriptions,
  setSubscriptionsStamped,
  subscriptions,
} from './subscriptions';

function store(value: unknown): void {
  localStorage.setItem('pp_favs', JSON.stringify(value));
}

beforeEach(() => {
  localStorage.clear();
  subscriptions.set([]);
});

describe('loadSubscriptions survives a corrupt store', () => {
  it.each([
    ['a null entry', [null]],
    ['an undefined-ish entry', [0]],
    ['a string entry', ['f1']],
    ['a nested array', [[]]],
    ['an entry with no id', [{ name: 'A' }]],
    ['the whole value being an object', { id: 'f1' }],
    ['the whole value being a string', 'nope'],
  ])('drops %s instead of throwing', (_label, value) => {
    store(value);
    expect(() => loadSubscriptions()).not.toThrow();
    expect(subscriptions()).toEqual([]);
  });

  it('keeps the good entries beside a bad one', () => {
    store([null, { id: 'f1', name: 'A', artist: 'B', art: 'https://x/a.jpg' }, 'junk']);
    loadSubscriptions();
    expect(subscriptions()).toEqual([{ id: 'f1', name: 'A', artist: 'B', art: 'https://x/a.jpg' }]);
  });

  it('leaves the corrupt value in storage rather than rewriting it', () => {
    // Sanitising is a read-time repair; overwriting would destroy whatever the
    // user might still recover by hand.
    store([null, { id: 'f1', name: 'A', artist: '', art: '' }]);
    loadSubscriptions();
    expect(JSON.parse(localStorage.getItem('pp_favs') as string)).toHaveLength(2);
  });

  it('stamps every surviving entry so the first sync can order it', () => {
    store([null, { id: 'f1', name: 'A', artist: '', art: '' }]);
    expect(() => loadSubscriptions()).not.toThrow();
    expect(subscriptions().map((f) => f.id)).toEqual(['f1']);
  });
});

describe('sanitizeSubscriptions', () => {
  it('coerces a numeric legacy id and fills missing labels', () => {
    expect(sanitizeSubscriptions([{ id: 1535809341 }])).toEqual([
      { id: '1535809341', name: '', artist: '', art: '' },
    ]);
  });

  it('coerces non-string labels to empty rather than dropping the row', () => {
    expect(sanitizeSubscriptions([{ id: 'f1', name: 42, artist: null, art: {} }])).toEqual([
      { id: 'f1', name: '', artist: '', art: '' },
    ]);
  });

  it('drops a duplicate id, which would render twice and desync the sidecars', () => {
    expect(sanitizeSubscriptions([{ id: 'f1' }, { id: 'f1', name: 'again' }])).toHaveLength(1);
  });
});

describe('setSubscriptionsStamped', () => {
  it('sanitises what a remote payload hands it', () => {
    const remote = [null, { id: 'f2', name: 'Remote' }] as never;
    expect(() => setSubscriptionsStamped(remote, { f2: 1 }, {})).not.toThrow();
    expect(subscriptions()).toEqual([{ id: 'f2', name: 'Remote', artist: '', art: '' }]);
  });
});

describe('addSubscriptions', () => {
  const meta = (id: string) => ({ id, name: id, artist: '', art: '' });

  it('adds only what is new, in one change', () => {
    loadSubscriptions();
    addSubscriptions([meta('a')]);
    let emits = 0;
    const off = subscriptions.subscribe(() => emits++);

    const added = addSubscriptions([meta('a'), meta('b'), meta('c'), meta('b')]);

    off();
    expect(added).toBe(2);
    expect(subscriptions().map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(emits).toBe(1);
    expect(JSON.parse(localStorage.getItem('pp_favs') ?? '[]')).toHaveLength(3);
    // Stamped like any other subscribe, so the import travels with sync.
    expect(Object.keys(JSON.parse(localStorage.getItem('pp_subs_at') ?? '{}')).sort()).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('writes nothing when every entry is already there', () => {
    loadSubscriptions();
    addSubscriptions([meta('a')]);
    let emits = 0;
    const off = subscriptions.subscribe(() => emits++);
    expect(addSubscriptions([meta('a')])).toBe(0);
    off();
    expect(emits).toBe(0);
  });
});

describe('the feed address of an Apple subscription', () => {
  it('survives a reload, https only', () => {
    store([
      { id: '1', name: 'A', artist: '', art: '', feedUrl: 'https://feeds.example.com/a' },
      { id: '2', name: 'B', artist: '', art: '', feedUrl: 'http://feeds.example.com/b' },
      { id: '3', name: 'C', artist: '', art: '', feedUrl: 42 },
    ]);
    loadSubscriptions();
    expect(subscriptions().map((s) => s.feedUrl)).toEqual([
      'https://feeds.example.com/a',
      undefined,
      undefined,
    ]);
  });

  it('is learned by a subscription made before it was kept', () => {
    store([{ id: '7', name: 'Old', artist: 'H', art: 'https://img/a.jpg' }]);
    loadSubscriptions();
    refreshSubscription({
      id: '7',
      name: 'Old',
      artist: 'H',
      art: 'https://img/a.jpg',
      feedUrl: 'https://feeds.example.com/old',
    });
    expect(subscriptions()[0]?.feedUrl).toBe('https://feeds.example.com/old');
    expect(JSON.parse(localStorage.getItem('pp_favs') ?? '[]')[0].feedUrl).toBe(
      'https://feeds.example.com/old',
    );
  });
});
