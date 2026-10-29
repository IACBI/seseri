import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearProgress,
  getProgress,
  mergeProgress,
  progressSnapshot,
  setProgress,
} from './progress';

describe('setProgress', () => {
  beforeEach(() => {
    clearProgress();
    vi.useFakeTimers();
  });

  it('does not restamp a position that has not moved', () => {
    vi.setSystemTime(1_000);
    setProgress('e1', 300);
    vi.setSystemTime(9_000);
    // A seek on a paused element reports the position it already holds.
    setProgress('e1', 300.4);
    expect(progressSnapshot().progAt['e1']).toBe(1_000);
    expect(getProgress('e1')).toBe(300);
  });

  it('stamps a real change', () => {
    vi.setSystemTime(1_000);
    setProgress('e1', 300);
    vi.setSystemTime(9_000);
    setProgress('e1', 310);
    expect(progressSnapshot().progAt['e1']).toBe(9_000);
  });
});

describe('mergeProgress forget', () => {
  beforeEach(() => clearProgress());

  it('forgets a position no newer than the unplayed mark, and keeps a newer one', () => {
    mergeProgress({ old: { t: 50, at: 100 }, fresh: { t: 60, at: 900 } }, {});
    mergeProgress({}, {}, { old: 500, fresh: 500 });
    expect(getProgress('old')).toBe(0);
    expect(getProgress('fresh')).toBe(60);
  });
});
