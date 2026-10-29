/**
 * Playback engine — the transport facade over the <audio> element, so
 * keyboard/waveform/Media Session stay agnostic. Emits typed events instead of
 * poking the DOM (UI subscribes).
 */

export type EngineEvent =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'ended' }
  | { type: 'timeupdate'; current: number; duration: number }
  /** Data ran out mid-playback, or the element is waiting on the network. */
  | { type: 'stalled' }
  /** `code` is a `MediaError` constant: 2 is NETWORK, 3 DECODE, 4 SRC_NOT_SUPPORTED. */
  | { type: 'error'; code: number };

type Listener = (e: EngineEvent) => void;

const listeners = new Set<Listener>();

export function onEngine(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(e: EngineEvent): void {
  for (const fn of [...listeners]) fn(e);
}

export const audio = new Audio();
// iOS refuses to play a media element it considers "fullscreen-capable" while
// the tab is backgrounded; `playsinline` is what opts out of that. `auto`
// preload lets the element keep reading ahead once the screen is off, which is
// exactly the window in which a network hiccup would otherwise end playback.
audio.setAttribute('playsinline', '');
audio.preload = 'auto';

export function pbPaused(): boolean {
  return audio.paused;
}
export function pbCurrent(): number {
  return audio.currentTime;
}
export function pbDuration(): number {
  return audio.duration;
}
export function pbPlay(): void {
  // `play()` predates its own promise; a browser that returns undefined here
  // would otherwise throw on `.catch` instead of merely failing to start.
  audio.play()?.catch(() => {
    /* autoplay blocked — user will press play */
  });
}
export function pbPause(): void {
  audio.pause();
}

/**
 * Volume is two independent things multiplied together: what the listener
 * chose, and the sleep timer's fade-out. Keeping them apart means a fade can
 * run without overwriting the chosen level, and moving the slider mid-fade
 * does not cancel the fade or resurrect a stale "volume before the fade".
 */
let userVolume = 1;
let fadeFactor = 1;

function applyVolume(): void {
  audio.volume = clamp01(userVolume) * clamp01(fadeFactor);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 1));
}

/** The listener's own level, 0–1 — not whatever a fade has it at right now. */
export function pbGetVolume(): number {
  return userVolume;
}
export function pbSetVolume(v: number): void {
  userVolume = clamp01(v);
  applyVolume();
}

/** Sleep-timer fade, 0–1. 1 is "no fade" and is the resting value. */
export function pbSetFade(f: number): void {
  fadeFactor = clamp01(f);
  applyVolume();
}
export function pbSetMuted(on: boolean): void {
  audio.muted = on;
}

/**
 * iOS makes `volume` read-only — the hardware buttons are the only control
 * there — so a slider would be a dead widget. Probed on a throwaway element
 * rather than the live one, which may be mid-playback.
 */
let volumeSettable: boolean | undefined;
export function pbVolumeSettable(): boolean {
  if (volumeSettable === undefined) {
    const probe = new Audio();
    probe.volume = 0.5;
    volumeSettable = probe.volume === 0.5;
  }
  return volumeSettable;
}

export function pbSeekTo(sec: number): void {
  audio.currentTime = sec;
}
export function pbSetRate(r: number): void {
  audio.playbackRate = r;
}

// <audio> events → engine events (throttled timeupdate ~4 fps like legacy)
let lastUi = 0;
audio.addEventListener('timeupdate', () => {
  const now = performance.now();
  if (now - lastUi < 250) return;
  lastUi = now;
  emit({ type: 'timeupdate', current: audio.currentTime, duration: audio.duration });
});
// A seek's own `timeupdate` can fall inside the throttle window, and the last
// step of a scrub is the one position that matters.
audio.addEventListener('seeked', () => {
  lastUi = performance.now();
  emit({ type: 'timeupdate', current: audio.currentTime, duration: audio.duration });
});
audio.addEventListener('play', () => emit({ type: 'play' }));
audio.addEventListener('pause', () => emit({ type: 'pause' }));
audio.addEventListener('ended', () => emit({ type: 'ended' }));
audio.addEventListener('error', () => emit({ type: 'error', code: audio.error?.code ?? 0 }));
// `stalled` and `waiting` are the only warning the element gives before a
// backgrounded range request dies quietly; `suspend` is deliberately NOT
// mapped here — it also fires on a healthy "buffer is full" pause.
audio.addEventListener('stalled', () => emit({ type: 'stalled' }));
audio.addEventListener('waiting', () => emit({ type: 'stalled' }));
