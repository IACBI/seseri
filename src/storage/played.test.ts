// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPlayed,
  isExplicitlyUnplayed,
  isPlayed,
  loadPlayed,
  markPlayed,
  markUnplayed,
  notePlaybackEnded,
  playedFraction,
  playedRevision,
  playedSnapshot,
  setPlayedStamped,
  togglePlayed,
} from './played';
import { getProgress, loadProgress, setProgress, saveProgressNow } from './progress';

const HOUR_MS = 60 * 60 * 1000;

beforeEach(() => {
  localStorage.clear();
  loadProgress();
  loadPlayed();
});

describe('isPlayed — the derived case', () => {
  it('is true past 96% of a known duration', () => {
    setProgress('e1', 0.97 * 3600);
    expect(isPlayed('e1', HOUR_MS)).toBe(true);
  });

  it('is false below it', () => {
    setProgress('e1', 0.5 * 3600);
    expect(isPlayed('e1', HOUR_MS)).toBe(false);
  });

  it('is false with no position at all', () => {
    expect(isPlayed('e1', HOUR_MS)).toBe(false);
  });

  it('cannot be derived without a duration, which is the gap this fixes', () => {
    // A feed with no <itunes:duration> has no percentage to compare against,
    // so its episodes could never read as finished before the explicit marks.
    setProgress('e1', 99999);
    expect(isPlayed('e1', 0)).toBe(false);
    markPlayed('e1');
    expect(isPlayed('e1', 0)).toBe(true);
  });
});

describe('explicit marks override the derivation', () => {
  it('marks an unfinished episode played', () => {
    setProgress('e1', 10);
    expect(isPlayed('e1', HOUR_MS)).toBe(false);
    markPlayed('e1');
    expect(isPlayed('e1', HOUR_MS)).toBe(true);
  });

  it('marks a finished episode unplayed, and forgets the position', () => {
    setProgress('e1', 0.99 * 3600);
    saveProgressNow();
    expect(isPlayed('e1', HOUR_MS)).toBe(true);

    markUnplayed('e1');

    expect(isPlayed('e1', HOUR_MS)).toBe(false);
    // "Play it again" means from the start.
    expect(getProgress('e1')).toBe(0);
  });

  it('keeps an episode unplayed even when the position comes back', () => {
    // This is the whole reason the tombstone exists: `mergeProgress` is
    // additive and never deletes, so a position cleared here reappears from any
    // device that still has it. Without the tombstone the episode would mark
    // itself played again on the next sync.
    markUnplayed('e1');
    setProgress('e1', 0.99 * 3600);
    expect(isPlayed('e1', HOUR_MS)).toBe(false);
    expect(isExplicitlyUnplayed('e1')).toBe(true);
  });

  it('toggles back and forth, reporting the new state', () => {
    expect(togglePlayed('e1', HOUR_MS)).toBe(true);
    expect(isPlayed('e1', HOUR_MS)).toBe(true);
    expect(togglePlayed('e1', HOUR_MS)).toBe(false);
    expect(isPlayed('e1', HOUR_MS)).toBe(false);
    expect(togglePlayed('e1', HOUR_MS)).toBe(true);
  });

  it('ignores an empty episode id rather than storing one', () => {
    markPlayed('');
    markUnplayed('');
    expect(playedSnapshot()).toEqual({ played: {}, unplayed: {} });
  });
});

describe('notePlaybackEnded', () => {
  it('marks played when an episode runs out', () => {
    notePlaybackEnded('e1');
    expect(isPlayed('e1', 0)).toBe(true);
  });

  it('does not undo a listener who just said unplayed', () => {
    markUnplayed('e1');
    notePlaybackEnded('e1');
    expect(isPlayed('e1', HOUR_MS)).toBe(false);
  });

  it('does not restamp an episode already marked', () => {
    markPlayed('e1');
    const before = playedSnapshot().played['e1'];
    notePlaybackEnded('e1');
    expect(playedSnapshot().played['e1']).toBe(before);
  });
});

describe('persistence', () => {
  it('survives a reload', () => {
    markPlayed('e1');
    markUnplayed('e2');
    loadPlayed();
    expect(isPlayed('e1', 0)).toBe(true);
    expect(isExplicitlyUnplayed('e2')).toBe(true);
  });

  it('resolves an id that somehow ended up in both maps', () => {
    // Not reachable through the API, but a hand-edited backup or a payload from
    // another build can produce it, and "played and not played" has no reading.
    localStorage.setItem('pp_played', JSON.stringify({ e1: 1000, e2: 5000 }));
    localStorage.setItem('pp_played_rm', JSON.stringify({ e1: 2000, e2: 1000 }));
    loadPlayed();
    // Newer answer wins in each direction.
    expect(isPlayed('e1', 0)).toBe(false);
    expect(isPlayed('e2', 0)).toBe(true);
  });

  it('ignores junk in storage instead of throwing during boot', () => {
    localStorage.setItem('pp_played', '"not an object"');
    localStorage.setItem('pp_played_rm', '[1,2,3]');
    expect(() => loadPlayed()).not.toThrow();
    expect(playedSnapshot()).toEqual({ played: {}, unplayed: {} });
  });

  it('drops entries with unusable stamps', () => {
    localStorage.setItem('pp_played', JSON.stringify({ ok: 123, bad: 'soon', worse: null }));
    loadPlayed();
    expect(playedSnapshot().played).toEqual({ ok: 123 });
  });
});

describe('sync seam', () => {
  it('applies a merged set without restamping it', () => {
    setPlayedStamped({ e1: 111 }, { e2: 222 });
    expect(playedSnapshot()).toEqual({ played: { e1: 111 }, unplayed: { e2: 222 } });
  });

  it('hands out copies, so a caller cannot mutate the live maps', () => {
    markPlayed('e1');
    const snap = playedSnapshot();
    snap.played['e1'] = 0;
    snap.played['injected'] = 1;
    expect(isPlayed('e1', 0)).toBe(true);
    expect(playedSnapshot().played['injected']).toBeUndefined();
  });
});

describe('playedFraction', () => {
  it('reports how far in, ignoring the overrides', () => {
    setProgress('e1', 1800);
    expect(playedFraction('e1', HOUR_MS)).toBeCloseTo(0.5);
    markPlayed('e1');
    expect(playedFraction('e1', HOUR_MS)).toBeCloseTo(0.5);
  });

  it('clamps past the end and answers 0 without a duration', () => {
    setProgress('e1', 99999);
    expect(playedFraction('e1', HOUR_MS)).toBe(1);
    expect(playedFraction('e1', 0)).toBe(0);
  });
});

describe('playedRevision', () => {
  it('advances on every change, so views know to re-render', () => {
    const before = playedRevision();
    markPlayed('e1');
    expect(playedRevision()).toBeGreaterThan(before);
    const mid = playedRevision();
    markUnplayed('e1');
    expect(playedRevision()).toBeGreaterThan(mid);
  });
});

describe('clearPlayed', () => {
  it('forgets everything', () => {
    markPlayed('e1');
    markUnplayed('e2');
    clearPlayed();
    expect(playedSnapshot()).toEqual({ played: {}, unplayed: {} });
  });
});
