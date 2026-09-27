/**
 * Playback recovery — the watchdog that keeps a backgrounded episode alive.
 *
 * Streaming an episode is a series of range requests, and any one of them can
 * fail: the CDN drops the connection, the phone's radio is asleep and the
 * request times out, the network changes mid-listen. The element's answer to
 * all of that is to fire `stalled`, then `error`, and stop forever.
 *
 * That is how playback dies with the screen off. Nothing in the element or the
 * Media Session retries, so this module is the retry. It distinguishes a pause
 * the USER asked for from one the network imposed, and only ever resumes
 * something that was meant to be playing.
 */

import { audio, onEngine } from './engine';

export interface RecoveryHooks {
  /** Fresh playable URL for whatever is loaded now, or null when unresolvable. */
  reresolve: () => Promise<string | null>;
  /** Load `url` and continue from `positionSec`. Owns blob bookkeeping. */
  resume: (url: string, positionSec: number) => void;
  /** Every attempt is spent; show the user an error. */
  onGiveUp: () => void;
}

/** Backoff between attempts. Its length is also the attempt budget. */
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];
/** A `stalled` that never turns back into a `timeupdate` within this is a death. */
const STALL_GRACE_MS = 8000;
/** Foregrounding after this long without progress is treated as a stall. */
const STALE_PROGRESS_MS = 30000;

let hooks: RecoveryHooks | null = null;
/** The user's last explicit transport intent, not the element's `paused`. */
let wantsPlayback = false;
let attempt = 0;
let stallTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let lastProgressAt = 0;
/** Set while `resume()` reloads the element, so its own events don't re-trigger. */
let recovering = false;

function clearTimers(): void {
  if (stallTimer) clearTimeout(stallTimer);
  if (retryTimer) clearTimeout(retryTimer);
  stallTimer = retryTimer = null;
}

/** New source loaded, or playback confirmed healthy — forget the failure history. */
export function resetRecovery(): void {
  clearTimers();
  attempt = 0;
  inFlight = false;
  recovering = false;
  lastProgressAt = Date.now();
}

/**
 * Record what the user asked for. Called from every transport entry point
 * (play/pause button, keyboard, Media Session, queue advance) — an OS- or
 * network-induced `pause` never reaches this, which is the whole point.
 */
export function noteUserIntent(playing: boolean): void {
  wantsPlayback = playing;
  if (!playing) clearTimers();
}

/** The intent `noteUserIntent` last recorded — not whether the element is paused. */
export function userWantsPlayback(): boolean {
  return wantsPlayback;
}

async function attemptRecovery(): Promise<void> {
  if (!hooks || inFlight || !wantsPlayback) return;
  if (attempt >= BACKOFF_MS.length) {
    hooks.onGiveUp();
    return;
  }
  // Offline is not a failure worth spending an attempt on — the `online`
  // listener below retries the moment the radio comes back.
  if (navigator.onLine === false) return;

  inFlight = true;
  clearTimers();
  const position = audio.currentTime;
  const n = attempt++;
  try {
    const url = await hooks.reresolve();
    if (!wantsPlayback) return; // user pressed pause while we were resolving
    if (url) {
      recovering = true;
      hooks.resume(url, position);
      // Give the reload a stall grace of its own; a successful `timeupdate`
      // clears it and resets the attempt counter.
      stallTimer = setTimeout(() => void attemptRecovery(), STALL_GRACE_MS);
      return;
    }
  } catch {
    /* fall through to the backoff */
  } finally {
    inFlight = false;
  }
  retryTimer = setTimeout(() => void attemptRecovery(), BACKOFF_MS[n] ?? 15000);
}

/**
 * Verify that something which is supposed to be playing actually is. Cheap
 * enough to call on every foreground transition — on iOS that is the only
 * moment the page is running again after WebKit suspended it.
 */
export function checkPlaybackHealth(): void {
  if (!hooks || !wantsPlayback || inFlight) return;
  const stale = Date.now() - lastProgressAt > STALE_PROGRESS_MS;
  if (audio.paused || stale) void attemptRecovery();
}

/**
 * Wire the watchdog to the engine. Called once from the playback controller;
 * returns a disposer so a second wiring (only tests do this) can retire the
 * first instead of leaving two listeners driving one set of hooks.
 */
export function initRecovery(h: RecoveryHooks): () => void {
  hooks = h;
  resetRecovery();

  const offEngine = onEngine((e) => {
    switch (e.type) {
      case 'timeupdate':
        // Real progress is the only proof of health, and it retires the
        // failure history: a stream that hiccups hourly should get a full
        // budget each time, not run out over a long listen.
        lastProgressAt = Date.now();
        recovering = false;
        if (stallTimer) {
          clearTimeout(stallTimer);
          stallTimer = null;
        }
        attempt = 0;
        break;
      case 'stalled':
        if (!wantsPlayback || stallTimer || inFlight) break;
        stallTimer = setTimeout(() => void attemptRecovery(), STALL_GRACE_MS);
        break;
      case 'error':
        // MEDIA_ERR_DECODE (3) is not a network problem and re-fetching the
        // same bytes will decode the same way; everything else is worth a
        // fresh URL. `recovering` suppresses the error our own reload emits.
        if (recovering || e.code === 3) break;
        void attemptRecovery();
        break;
      case 'ended':
        wantsPlayback = false;
        resetRecovery();
        break;
    }
  });

  const onOnline = (): void => {
    if (wantsPlayback) void attemptRecovery();
  };
  window.addEventListener('online', onOnline);

  return () => {
    offEngine();
    window.removeEventListener('online', onOnline);
    clearTimers();
  };
}

/** Test seam: retire a previous wiring and drop all state between cases. */
export function __resetRecoveryForTests(dispose?: () => void): void {
  dispose?.();
  hooks = null;
  wantsPlayback = false;
  resetRecovery();
}
