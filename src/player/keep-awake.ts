/**
 * Screen Wake Lock while audio is playing.
 *
 * This does NOT keep audio alive with the screen off — that is not what the API
 * does, and claiming otherwise is the usual mistake. What it prevents is the
 * cheaper failure: the user leaves the app open, the phone dims and sleeps on
 * its own, and the tab gets throttled hard enough that the next range request
 * never completes. The lock is dropped the moment playback stops or the page is
 * hidden, so it costs nothing when it is not helping.
 */

import { onEngine } from './engine';

type Sentinel = {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', fn: () => void): void;
};

let sentinel: Sentinel | null = null;
let wanted = false;
/**
 * A request is out and unanswered. Without it a second `acquire()` (the `play`
 * event and a visibility change land together) made a second request, and the
 * handle it returned replaced the first, which then could never be released.
 */
let requesting = false;

async function acquire(): Promise<void> {
  if (sentinel || requesting || !wanted || document.hidden) return;
  requesting = true;
  try {
    const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<Sentinel> } })
      .wakeLock;
    if (!wl) return;
    const held = await wl.request('screen');
    // The platform takes a moment to answer, and playback may have stopped or
    // the page been hidden meanwhile. `release()` ran before there was a handle
    // to release, so a lock kept now would hold the screen on with nothing
    // playing until the next play/pause cycle.
    if (!wanted || document.hidden) {
      void held.release().catch(() => {
        /* already gone */
      });
      return;
    }
    sentinel = held;
    /**
     * The OS drops the lock on its own — battery saver, a system dialog, the
     * tab losing focus — without telling anything but this event. Forgetting
     * the handle is what lets the next `acquire()` ask again; while it sat
     * there stale, `acquire()` short-circuited on the `sentinel` check above
     * and the lock was never retaken for the rest of the session.
     *
     * This used to be `sentinel.released = false`, which is a no-op at best:
     * `released` is a read-only getter, so the assignment throws in strict mode
     * and the catch below swallowed it.
     */
    held.addEventListener('release', () => {
      // Our own `release()` nulls the handle first, so this guard means the
      // drop came from the OS — ask again while playback still wants it.
      if (sentinel !== held) return;
      sentinel = null;
      void acquire();
    });
  } catch {
    /* denied, unsupported, or not a secure context */
  } finally {
    requesting = false;
  }
}

function release(): void {
  const s = sentinel;
  sentinel = null;
  void s?.release().catch(() => {
    /* already gone */
  });
}

export function initKeepAwake(): void {
  onEngine((e) => {
    if (e.type === 'play') {
      wanted = true;
      void acquire();
    } else if (e.type === 'pause' || e.type === 'ended' || e.type === 'error') {
      wanted = false;
      release();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) release();
    else void acquire();
  });
}
