// @vitest-environment jsdom
/**
 * The lock's whole job is to survive a long listen with the app open. The
 * previous version tried to notice an OS-initiated drop by writing
 * `sentinel.released = false` — but `released` is a read-only getter, so the
 * assignment threw, the surrounding catch swallowed it, and the stale handle
 * stayed. `acquire()` then short-circuited on it forever: one battery-saver
 * drop and the screen was free to sleep for the rest of the session.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audio } from './engine';
import { initKeepAwake } from './keep-awake';

/** Stand-in for WakeLockSentinel: `released` is a getter, exactly as in a browser. */
class FakeSentinel {
  #released = false;
  #listeners: Array<() => void> = [];

  get released(): boolean {
    return this.#released;
  }

  addEventListener(_type: 'release', fn: () => void): void {
    this.#listeners.push(fn);
  }

  release(): Promise<void> {
    this.#drop();
    return Promise.resolve();
  }

  /** What the OS does under battery saver: releases without being asked. */
  dropFromOs(): void {
    this.#drop();
  }

  #drop(): void {
    if (this.#released) return;
    this.#released = true;
    for (const fn of this.#listeners) fn();
  }
}

let granted: FakeSentinel[] = [];
let request: ReturnType<typeof vi.fn>;
let hidden = false;

/** initKeepAwake wires module-level listeners, so it may only run once here. */
let wired = false;

function play(): void {
  audio.dispatchEvent(new Event('play'));
}
function pause(): void {
  audio.dispatchEvent(new Event('pause'));
}

/** Let the `await wl.request(...)` inside acquire() settle. */
function settle(): Promise<void> {
  return Promise.resolve().then(() => undefined);
}

beforeEach(() => {
  granted = [];
  hidden = false;
  request = vi.fn(() => {
    const s = new FakeSentinel();
    granted.push(s);
    return Promise.resolve(s);
  });
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
  Object.defineProperty(document, 'hidden', { get: () => hidden, configurable: true });
  if (!wired) {
    initKeepAwake();
    wired = true;
  }
});

afterEach(async () => {
  pause();
  await settle();
});

describe('keep-awake', () => {
  it('takes a lock when playback starts', async () => {
    play();
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not stack locks while one is held', async () => {
    play();
    await settle();
    play();
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('re-acquires after the OS drops the lock mid-playback', async () => {
    play();
    await settle();
    expect(granted).toHaveLength(1);

    (granted[0] as FakeSentinel).dropFromOs();
    await settle();

    expect(request).toHaveBeenCalledTimes(2);
    expect(granted).toHaveLength(2);
  });

  it('does not re-acquire when we released it ourselves', async () => {
    play();
    await settle();
    pause();
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not ask again while the page is hidden', async () => {
    play();
    await settle();
    hidden = true;
    (granted[0] as FakeSentinel).dropFromOs();
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('survives a platform with no wakeLock at all', async () => {
    Object.defineProperty(navigator, 'wakeLock', { value: undefined, configurable: true });
    play();
    await expect(settle()).resolves.toBeUndefined();
  });
});
