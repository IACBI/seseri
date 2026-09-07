import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The sleep timer's whole point is behaviour that is invisible until it is
 * wrong: it must not count down while paused, must restore the volume it faded,
 * and must beat auto-next when set to stop at the end of the episode.
 */

/**
 * Mirrors the real engine: what you hear is the listener's own level times the
 * fade factor, and the timer may only touch the second of those.
 */
const engine = vi.hoisted(() => ({
  paused: false,
  userVolume: 1,
  fade: 1,
  pauseCalls: 0,
  get volume(): number {
    return this.userVolume * this.fade;
  },
}));

vi.mock('./engine', () => ({
  pbPaused: () => engine.paused,
  pbPause: () => {
    engine.pauseCalls++;
    engine.paused = true;
  },
  pbSetFade: (f: number) => {
    engine.fade = f;
  },
  pbSetVolume: (v: number) => {
    engine.userVolume = v;
  },
  pbGetVolume: () => engine.userVolume,
}));

const store = vi.hoisted(() => ({ map: new Map<string, unknown>() }));

vi.mock('../storage/local', () => ({
  local: {
    get: (k: string, fallback: unknown) => store.map.get(k) ?? fallback,
    set: (k: string, v: unknown) => store.map.set(k, v),
    remove: (k: string) => store.map.delete(k),
  },
}));

import {
  cancelSleepTimer,
  consumeSleepAtEpisodeEnd,
  extendSleepTimer,
  initSleepTimer,
  setSleepEndOfEpisode,
  setSleepMinutes,
  sleepTimerActive,
} from './sleep-timer';
import { sleepState } from '../state/sleep';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  engine.paused = false;
  engine.userVolume = 1;
  engine.fade = 1;
  engine.pauseCalls = 0;
  store.map.clear();
  cancelSleepTimer();
});

afterEach(() => {
  cancelSleepTimer();
  vi.useRealTimers();
});

/** Advance both the clock and the interval, which the timer reads via Date.now. */
function advance(ms: number): void {
  vi.advanceTimersByTime(ms);
}

describe('sleep timer — countdown', () => {
  it('pauses playback when the time runs out', () => {
    setSleepMinutes(1);
    expect(sleepTimerActive()).toBe(true);
    advance(60_000);
    expect(engine.pauseCalls).toBe(1);
    expect(sleepTimerActive()).toBe(false);
  });

  it('does not count down while playback is paused', () => {
    setSleepMinutes(2);
    advance(30_000);
    const afterPlaying = sleepState().remainingMs;
    expect(afterPlaying).toBeLessThan(120_000);

    engine.paused = true;
    advance(600_000); // ten minutes of being paused
    expect(sleepState().remainingMs).toBe(afterPlaying);
    expect(sleepState().held).toBe(true);
    expect(engine.pauseCalls).toBe(0);

    engine.paused = false;
    advance(afterPlaying);
    expect(engine.pauseCalls).toBe(1);
  });

  it('extends by five minutes', () => {
    setSleepMinutes(10);
    advance(60_000);
    const before = sleepState().remainingMs;
    extendSleepTimer();
    expect(sleepState().remainingMs).toBe(before + 5 * 60_000);
  });
});

describe('sleep timer — fade out', () => {
  it('fades over the last stretch and restores the volume when it fires', () => {
    setSleepMinutes(1);
    advance(35_000); // 25s left → inside the 30s fade window
    expect(engine.volume).toBeGreaterThan(0);
    expect(engine.volume).toBeLessThan(1);

    advance(25_000);
    expect(engine.pauseCalls).toBe(1);
    // Critical: a timer that fired must not leave playback muted forever.
    expect(engine.volume).toBe(1);
  });

  it('restores the volume when cancelled mid-fade', () => {
    setSleepMinutes(1);
    advance(40_000);
    expect(engine.volume).toBeLessThan(1);
    cancelSleepTimer();
    expect(engine.volume).toBe(1);
  });

  it('restores the volume when extended mid-fade', () => {
    setSleepMinutes(1);
    advance(40_000);
    expect(engine.volume).toBeLessThan(1);
    extendSleepTimer();
    expect(engine.volume).toBe(1);
  });

  it('fades around the chosen level instead of overwriting it', () => {
    engine.userVolume = 0.4;
    setSleepMinutes(1);
    advance(45_000); // 15s left → halfway through the 30s fade
    expect(engine.volume).toBeLessThan(0.4);
    expect(engine.userVolume).toBe(0.4);

    cancelSleepTimer();
    expect(engine.userVolume).toBe(0.4);
    expect(engine.volume).toBe(0.4);
  });
});

describe('sleep timer — end of episode', () => {
  it('claims the ended event so auto-next cannot advance', () => {
    setSleepEndOfEpisode();
    expect(consumeSleepAtEpisodeEnd()).toBe(true);
    expect(sleepTimerActive()).toBe(false);
  });

  it('does not claim the ended event when inactive', () => {
    expect(consumeSleepAtEpisodeEnd()).toBe(false);
    setSleepMinutes(30);
    expect(consumeSleepAtEpisodeEnd()).toBe(false);
  });
});

describe('sleep timer — persistence', () => {
  it('restores a running timer across a reload', () => {
    setSleepMinutes(10);
    advance(15_000);
    const remaining = sleepState().remainingMs;

    // Simulate a fresh module state: clear the signal, then re-init.
    cancelSleepTimer();
    store.map.set('pp_sleep', { mode: 'minutes', minutes: 10, remainingMs: remaining });
    initSleepTimer(() => {});

    expect(sleepTimerActive()).toBe(true);
    expect(sleepState().remainingMs).toBe(remaining);
  });

  it('forgets the timer once it is cleared', () => {
    setSleepMinutes(10);
    cancelSleepTimer();
    initSleepTimer(() => {});
    expect(sleepTimerActive()).toBe(false);
  });

  it('keeps writing the remaining time when a throttled tab delivers late ticks', () => {
    // The gate used to be `Math.round(remainingMs / 1000) % 15 === 0`: it fires
    // only when the countdown happens to LAND on a 15-second multiple. With
    // one-second ticks it always does, so it looked correct. A background tab
    // gets throttled and each tick then swallows several seconds at once —
    // the countdown steps over the multiples and the gate stops matching
    // entirely, freezing the stored value for the rest of the listen.
    //
    // 592 s decremented by exactly 15 s a tick stays at 7 mod 15 forever, so
    // the old gate never fires here and the counted one still does.
    store.map.set('pp_sleep', { mode: 'minutes', minutes: 10, remainingMs: 592_000 });
    initSleepTimer(() => {});
    store.map.delete('pp_sleep');

    for (let i = 0; i < 15; i++) {
      vi.setSystemTime(Date.now() + 14_000); // the tab was asleep
      advance(1000); // …and the interval finally runs
    }

    const saved = store.map.get('pp_sleep') as { remainingMs: number } | undefined;
    expect(saved).toBeDefined();
    expect(saved?.remainingMs).toBe(sleepState().remainingMs);
    expect(sleepState().remainingMs).toBe(592_000 - 15 * 15_000);
  });
});
