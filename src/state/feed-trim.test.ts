// @vitest-environment jsdom
/**
 * Intro and outro skip per show.
 *
 * The two rules that matter at playback are the ones that keep the trim from
 * fighting the listener: a resume past the intro is left alone, and the outro
 * only fires when playback runs into it — never after a seek into it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearFeedTrims,
  crossedOutro,
  feedTrimCount,
  feedTrimRevision,
  hasOwnTrim,
  loadFeedTrims,
  setFeedTrim,
  startPastIntro,
  trimFor,
} from './feed-trim';

beforeEach(() => {
  localStorage.clear();
  loadFeedTrims();
});

describe('the store', () => {
  it('is empty for a show that never asked', () => {
    expect(trimFor('f1')).toEqual({ intro: 0, outro: 0 });
    expect(hasOwnTrim('f1')).toBe(false);
    expect(trimFor(null)).toEqual({ intro: 0, outro: 0 });
  });

  it('keeps each end separately and survives a reload', () => {
    setFeedTrim('f1', 'intro', 30);
    setFeedTrim('f1', 'outro', 15);
    loadFeedTrims();
    expect(trimFor('f1')).toEqual({ intro: 30, outro: 15 });
    expect(trimFor('f2')).toEqual({ intro: 0, outro: 0 });
  });

  it('forgets a show once both ends are off', () => {
    setFeedTrim('f1', 'intro', 30);
    setFeedTrim('f1', 'intro', 0);
    expect(hasOwnTrim('f1')).toBe(false);
    expect(JSON.parse(localStorage.getItem('pp_feed_trim') ?? '{}')).toEqual({});
  });

  it('refuses a length the UI cannot produce', () => {
    setFeedTrim('f1', 'intro', 7);
    setFeedTrim('f1', 'intro', -30);
    setFeedTrim('f1', 'intro', Number.NaN);
    expect(hasOwnTrim('f1')).toBe(false);
  });

  it('drops corrupt or hand-edited entries on load', () => {
    localStorage.setItem(
      'pp_feed_trim',
      JSON.stringify({
        ok: { intro: 30, outro: 0 },
        half: { intro: 'x', outro: 60 },
        none: { intro: 0, outro: 0 },
        junk: 12,
        '': { intro: 30, outro: 30 },
      }),
    );
    loadFeedTrims();
    expect(trimFor('ok')).toEqual({ intro: 30, outro: 0 });
    expect(trimFor('half')).toEqual({ intro: 0, outro: 60 });
    expect(feedTrimCount()).toBe(2);
  });

  it('survives a non-object payload', () => {
    localStorage.setItem('pp_feed_trim', JSON.stringify([1, 2]));
    loadFeedTrims();
    expect(feedTrimCount()).toBe(0);
  });

  it('bumps the revision on every change and clears in one go', () => {
    const before = feedTrimRevision();
    setFeedTrim('f1', 'intro', 30);
    setFeedTrim('f2', 'outro', 30);
    expect(feedTrimRevision()).toBeGreaterThan(before);
    clearFeedTrims();
    expect(feedTrimCount()).toBe(0);
    expect(trimFor('f1')).toEqual({ intro: 0, outro: 0 });
  });
});

describe('startPastIntro', () => {
  const trim = { intro: 30, outro: 0 };

  it('jumps a fresh start past the intro', () => {
    expect(startPastIntro(0, 3600, trim)).toBe(30);
    expect(startPastIntro(12, 3600, trim)).toBe(30);
  });

  it('leaves a resume past the intro where it was', () => {
    expect(startPastIntro(30, 3600, trim)).toBe(30);
    expect(startPastIntro(1200, 3600, trim)).toBe(1200);
  });

  it('skips before the duration is known', () => {
    expect(startPastIntro(0, Number.NaN, trim)).toBe(30);
  });

  it('leaves a short episode whole', () => {
    expect(startPastIntro(0, 80, trim)).toBe(0);
    expect(startPastIntro(0, 89, { intro: 30, outro: 0 })).toBe(0);
    expect(startPastIntro(0, 90, { intro: 30, outro: 0 })).toBe(30);
    expect(startPastIntro(0, 150, { intro: 30, outro: 60 })).toBe(30);
    expect(startPastIntro(0, 149, { intro: 30, outro: 60 })).toBe(0);
  });

  it('does nothing without an intro', () => {
    expect(startPastIntro(0, 3600, { intro: 0, outro: 60 })).toBe(0);
  });
});

describe('crossedOutro', () => {
  const trim = { intro: 0, outro: 60 };

  it('fires when playback runs into the outro', () => {
    expect(crossedOutro(3539.8, 3540.05, 3600, trim)).toBe(true);
    // A tick at 2× under background throttling is still a tick.
    expect(crossedOutro(3537, 3540.5, 3600, trim)).toBe(true);
  });

  it('does not fire before it, or again inside it', () => {
    expect(crossedOutro(3500, 3500.25, 3600, trim)).toBe(false);
    expect(crossedOutro(3545, 3545.25, 3600, trim)).toBe(false);
  });

  it('lets a seek into the outro play', () => {
    expect(crossedOutro(1200, 3550, 3600, trim)).toBe(false);
    expect(crossedOutro(3530, 3545, 3600, trim)).toBe(false);
  });

  it('needs a known duration and a long enough episode', () => {
    expect(crossedOutro(99, 100.2, Number.NaN, trim)).toBe(false);
    expect(crossedOutro(59.9, 60.1, 120, trim)).toBe(true);
    expect(crossedOutro(58.9, 59.1, 119, trim)).toBe(false);
  });

  it('does nothing without an outro', () => {
    expect(crossedOutro(3539.8, 3540.05, 3600, { intro: 30, outro: 0 })).toBe(false);
  });
});
