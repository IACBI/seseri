// @vitest-environment jsdom
/**
 * Speed per show.
 *
 * The behaviour worth pinning down is the self-cleaning rule: an override that
 * equals the global default is not stored. It is what keeps "set it back to
 * normal" from leaving a permanent entry behind, and what lets a change to the
 * global default still move every show that never asked for anything else.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearFeedSpeeds,
  feedSpeedCount,
  feedSpeedRevision,
  hasOwnSpeed,
  loadFeedSpeeds,
  setFeedSpeed,
  speedFor,
} from './feed-speed';
import { DEFAULT_SETTINGS, setSetting, settings } from './settings';

beforeEach(() => {
  localStorage.clear();
  settings.set({ ...DEFAULT_SETTINGS });
  loadFeedSpeeds();
});

describe('speedFor', () => {
  it('falls back to the global default', () => {
    setSetting('defaultSpeed', 1.25);
    expect(speedFor('f1')).toBe(1.25);
    expect(hasOwnSpeed('f1')).toBe(false);
  });

  it('prefers a show of its own', () => {
    setFeedSpeed('f1', 1.5);
    expect(speedFor('f1')).toBe(1.5);
    expect(speedFor('f2')).toBe(DEFAULT_SETTINGS.defaultSpeed);
    expect(hasOwnSpeed('f1')).toBe(true);
  });

  it('answers the global default for no feed at all', () => {
    setSetting('defaultSpeed', 2);
    expect(speedFor(null)).toBe(2);
    expect(speedFor(undefined)).toBe(2);
    expect(speedFor('')).toBe(2);
  });
});

describe('the self-cleaning rule', () => {
  it('stores nothing for a show set to the global default', () => {
    setFeedSpeed('f1', DEFAULT_SETTINGS.defaultSpeed);
    expect(feedSpeedCount()).toBe(0);
    expect(hasOwnSpeed('f1')).toBe(false);
  });

  it('removes an existing override set back to the default', () => {
    setFeedSpeed('f1', 1.75);
    expect(feedSpeedCount()).toBe(1);

    setFeedSpeed('f1', DEFAULT_SETTINGS.defaultSpeed);

    expect(feedSpeedCount()).toBe(0);
    expect(speedFor('f1')).toBe(DEFAULT_SETTINGS.defaultSpeed);
  });

  it('lets a new global default move every show that never asked', () => {
    setFeedSpeed('f1', 2);
    setSetting('defaultSpeed', 1.5);
    expect(speedFor('f1')).toBe(2); // asked for 2
    expect(speedFor('f2')).toBe(1.5); // never asked
  });
});

describe('persistence', () => {
  it('survives a reload', () => {
    setFeedSpeed('f1', 1.75);
    loadFeedSpeeds();
    expect(speedFor('f1')).toBe(1.75);
  });

  it('refuses a speed the UI cannot produce', () => {
    setFeedSpeed('f1', 3.7);
    setFeedSpeed('f2', Number.NaN);
    expect(feedSpeedCount()).toBe(0);
  });

  it('drops a stored value outside the offered set', () => {
    // It goes straight to `audio.playbackRate`, so "a number" is not enough.
    localStorage.setItem('pp_feed_speed', JSON.stringify({ ok: 1.5, bad: 9, worse: 'fast' }));
    loadFeedSpeeds();
    expect(speedFor('ok')).toBe(1.5);
    expect(hasOwnSpeed('bad')).toBe(false);
    expect(hasOwnSpeed('worse')).toBe(false);
  });

  it('ignores junk in storage instead of throwing during boot', () => {
    localStorage.setItem('pp_feed_speed', '"not an object"');
    expect(() => loadFeedSpeeds()).not.toThrow();
    expect(feedSpeedCount()).toBe(0);
  });

  it('ignores an empty feed id', () => {
    setFeedSpeed('', 1.5);
    expect(feedSpeedCount()).toBe(0);
  });
});

describe('feedSpeedRevision', () => {
  it('advances on every change, so both speed selects follow', () => {
    const before = feedSpeedRevision();
    setFeedSpeed('f1', 1.5);
    expect(feedSpeedRevision()).toBeGreaterThan(before);
  });
});

describe('clearFeedSpeeds', () => {
  it('forgets every show', () => {
    setFeedSpeed('f1', 1.5);
    setFeedSpeed('f2', 2);
    clearFeedSpeeds();
    expect(feedSpeedCount()).toBe(0);
  });
});
