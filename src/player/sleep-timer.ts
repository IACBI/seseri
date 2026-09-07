/**
 * Sleep timer.
 *
 * Previously a bare `setTimeout(pause, minutes * 60000)`: it kept counting down
 * while playback was paused, was lost on reload, offered three fixed presets,
 * showed no remaining time, and cut the audio dead at zero.
 *
 * Now it decrements only while playback is actually running, survives a reload,
 * accepts any duration, can stop at the end of the episode instead, and fades
 * out over the last stretch. State lives in `state/sleep.ts` so both player
 * surfaces render from one source instead of poking each other's DOM.
 */

import { local } from '../storage/local';
import { pbPause, pbPaused, pbSetFade } from './engine';
import { sleepState, SLEEP_EXTEND_MS, SLEEP_OFF, type SleepState } from '../state/sleep';

/** Fade the last stretch instead of cutting the audio dead. */
const FADE_MS = 30_000;
const TICK_MS = 1000;
/** One crash-recovery write per 15 counted ticks of actual playback. */
const PERSIST_EVERY_TICKS = 15;

interface Persisted {
  mode: SleepState['mode'];
  minutes: number;
  remainingMs: number;
}

let ticker: ReturnType<typeof setInterval> | null = null;
let lastTickAt = 0;
/** Ticks since the last crash-recovery write. See the note in `tick`. */
let sincePersist = 0;
/** Notifier for "the timer stopped playback", supplied once at boot. */
let notifyDone: (() => void) | null = null;

function persist(): void {
  const s = sleepState();
  if (s.mode === 'off') {
    local.remove('pp_sleep');
    return;
  }
  const data: Persisted = { mode: s.mode, minutes: s.minutes, remainingMs: s.remainingMs };
  local.set('pp_sleep', data);
}

function restoreVolume(): void {
  pbSetFade(1);
}

function stopTicker(): void {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

function clearState(): void {
  stopTicker();
  // Must always run: a cancelled fade would otherwise leave every later
  // episode playing at near-zero volume.
  restoreVolume();
  sleepState.set({ ...SLEEP_OFF });
  persist();
}

/** Clear the timer without touching playback. */
export function cancelSleepTimer(): void {
  clearState();
}

function tick(): void {
  const s = sleepState();
  if (s.mode !== 'minutes') return;

  const now = Date.now();
  const elapsed = Math.max(0, now - lastTickAt);
  lastTickAt = now;

  // Elapsed time only counts while playback runs, so a timer set at bedtime
  // survives a long pause instead of expiring against the wall clock.
  if (pbPaused()) {
    if (!s.held) sleepState.set({ ...s, held: true });
    return;
  }

  const remainingMs = Math.max(0, s.remainingMs - elapsed);
  if (remainingMs <= FADE_MS) pbSetFade(remainingMs / FADE_MS);
  if (remainingMs === 0) {
    pbPause();
    clearState();
    notifyDone?.();
    return;
  }
  sleepState.set({ ...s, remainingMs, held: false });
  // Coarse: this is crash recovery, not a hot path. Counted rather than
  // derived from the remaining time — `Math.round(remainingMs / 1000) % 15`
  // skipped the write entirely whenever a tick drifted past the multiple,
  // which is exactly what a throttled tab does.
  if (++sincePersist >= PERSIST_EVERY_TICKS) {
    sincePersist = 0;
    persist();
  }
}

function startTicker(): void {
  stopTicker();
  lastTickAt = Date.now();
  sincePersist = 0;
  ticker = setInterval(tick, TICK_MS);
}

/** Stop after `minutes` of playback. 0 clears the timer. */
export function setSleepMinutes(minutes: number): void {
  clearState();
  if (minutes <= 0) return;
  sleepState.set({ mode: 'minutes', minutes, remainingMs: minutes * 60_000, held: false });
  persist();
  startTicker();
}

/** Stop when the current episode finishes. */
export function setSleepEndOfEpisode(): void {
  clearState();
  sleepState.set({ mode: 'episode', minutes: 0, remainingMs: 0, held: false });
  persist();
}

/** Add five minutes; only meaningful in `minutes` mode. */
export function extendSleepTimer(): void {
  const s = sleepState();
  if (s.mode !== 'minutes') return;
  // Leaving the fade window — undo the ducking so the extension is audible.
  restoreVolume();
  sleepState.set({
    ...s,
    minutes: s.minutes + SLEEP_EXTEND_MS / 60_000,
    remainingMs: s.remainingMs + SLEEP_EXTEND_MS,
  });
  persist();
}

export function sleepTimerActive(): boolean {
  return sleepState().mode !== 'off';
}

/**
 * Called by the playback controller when an episode ends, *before* it considers
 * the queue or auto-next. Returns true when the sleep timer wants playback to
 * stop here, in which case the controller must not advance.
 *
 * Deliberately a pull rather than an engine listener: both modules listen for
 * `ended`, and relying on listener registration order to beat auto-next would
 * be fragile.
 */
export function consumeSleepAtEpisodeEnd(): boolean {
  if (sleepState().mode !== 'episode') return false;
  clearState();
  notifyDone?.();
  return true;
}

/** Restore any persisted timer and register the "timer finished" notifier. */
export function initSleepTimer(done: () => void): void {
  notifyDone = done;
  const saved = local.get<Persisted | null>('pp_sleep', null);
  if (!saved) return;
  if (saved.mode === 'minutes' && saved.remainingMs > 0) {
    // `held` until the first tick observes playback actually running.
    sleepState.set({
      mode: 'minutes',
      minutes: saved.minutes,
      remainingMs: saved.remainingMs,
      held: true,
    });
    startTicker();
  } else if (saved.mode === 'episode') {
    sleepState.set({ mode: 'episode', minutes: 0, remainingMs: 0, held: false });
  } else {
    local.remove('pp_sleep');
  }
}
