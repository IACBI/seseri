// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { audio } from './engine';
import {
  __resetRecoveryForTests,
  checkPlaybackHealth,
  initRecovery,
  noteUserIntent,
  resetRecovery,
} from './recovery';

/**
 * The watchdog is a module singleton wired to the one `<audio>` element, so
 * every case re-arms it rather than constructing a new one, retiring the
 * previous wiring first.
 */
let dispose: (() => void) | undefined;

function arm(reresolve: () => Promise<string | null>) {
  const resume = vi.fn();
  const onGiveUp = vi.fn();
  dispose = initRecovery({ reresolve, resume, onGiveUp });
  return { resume, onGiveUp };
}

const fire = (type: string): void => {
  audio.dispatchEvent(new Event(type));
};

describe('playback recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetRecoveryForTests(dispose);
    dispose = undefined;
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  it('re-resolves and resumes at the same position after a stall', async () => {
    const { resume } = arm(async () => 'https://x/fresh.m4a');
    noteUserIntent(true);
    audio.currentTime = 0; // jsdom keeps whatever we set
    fire('stalled');

    expect(resume).not.toHaveBeenCalled(); // still inside the grace window
    await vi.advanceTimersByTimeAsync(8000);
    expect(resume).toHaveBeenCalledWith('https://x/fresh.m4a', 0);
  });

  it('leaves a pause the user asked for alone', async () => {
    const { resume, onGiveUp } = arm(async () => 'https://x/fresh.m4a');
    noteUserIntent(true);
    noteUserIntent(false);
    fire('stalled');
    fire('error');

    await vi.advanceTimersByTimeAsync(60000);
    expect(resume).not.toHaveBeenCalled();
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it('does not retry a decode error', async () => {
    const { resume, onGiveUp } = arm(async () => 'https://x/fresh.m4a');
    noteUserIntent(true);
    // The engine reads `audio.error`; jsdom never populates it, so the constant
    // is set directly. 3 is MEDIA_ERR_DECODE — refetching decodes the same way.
    Object.defineProperty(audio, 'error', { value: { code: 3 }, configurable: true });
    fire('error');
    await vi.advanceTimersByTimeAsync(60000);
    expect(resume).not.toHaveBeenCalled();
    expect(onGiveUp).not.toHaveBeenCalled();
    Object.defineProperty(audio, 'error', { value: null, configurable: true });
  });

  it('keeps retrying a resume that never produces progress, then gives up', async () => {
    const { resume, onGiveUp } = arm(async () => 'https://x/fresh.m4a');
    noteUserIntent(true);
    fire('error');
    await vi.advanceTimersByTimeAsync(120000);
    // One per attempt in the budget: a reload that stalls again is still a
    // failure, and the stall grace paces the next try.
    expect(resume).toHaveBeenCalledTimes(5);
    expect(onGiveUp).toHaveBeenCalled();
  });

  it('keeps the place when the reload it started never gets going', async () => {
    const { resume } = arm(async () => 'https://x/fresh.m4a');
    // A real `resume` ends in `audio.load()`, which puts the element back at 0.
    resume.mockImplementation(() => {
      audio.currentTime = 0;
    });
    noteUserIntent(true);
    audio.currentTime = 600;
    fire('error');
    await vi.advanceTimersByTimeAsync(0);
    expect(resume).toHaveBeenNthCalledWith(1, 'https://x/fresh.m4a', 600);

    // No `loadedmetadata`, no progress: the stall grace expires and tries again.
    await vi.advanceTimersByTimeAsync(8000);
    expect(resume).toHaveBeenNthCalledWith(2, 'https://x/fresh.m4a', 600);
  });

  it('gives up after the attempt budget and stops trying', async () => {
    const { resume, onGiveUp } = arm(async () => null); // never resolvable
    noteUserIntent(true);
    fire('error');

    // 5 attempts, each behind its own backoff step.
    await vi.advanceTimersByTimeAsync(60000);
    expect(resume).not.toHaveBeenCalled();
    expect(onGiveUp).toHaveBeenCalled();
  });

  it('does not spend an attempt while the device is offline', async () => {
    const reresolve = vi.fn(async () => 'https://x/fresh.m4a');
    arm(reresolve);
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    noteUserIntent(true);
    fire('error');
    await vi.advanceTimersByTimeAsync(30000);
    expect(reresolve).not.toHaveBeenCalled();

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(reresolve).toHaveBeenCalled();
  });

  it('treats a foregrounded but stalled element as needing repair', async () => {
    const { resume } = arm(async () => 'https://x/fresh.m4a');
    noteUserIntent(true);
    resetRecovery(); // marks progress as of now
    checkPlaybackHealth(); // paused in jsdom -> repair
    await vi.advanceTimersByTimeAsync(0);
    expect(resume).toHaveBeenCalled();
  });

  it('stays quiet when nothing is meant to be playing', async () => {
    const { resume } = arm(async () => 'https://x/fresh.m4a');
    noteUserIntent(false);
    checkPlaybackHealth();
    await vi.advanceTimersByTimeAsync(30000);
    expect(resume).not.toHaveBeenCalled();
  });
});
