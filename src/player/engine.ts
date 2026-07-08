/**
 * Playback engine — the transport facade over the <audio> element and the
 * YouTube IFrame embed, so keyboard/waveform/Media Session stay agnostic.
 * Emits typed events instead of poking the DOM (UI subscribes).
 */
import { getEmbed, YT_STATE } from '../youtube/embed';

export type EngineEvent =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'ended' }
  | { type: 'timeupdate'; current: number; duration: number }
  | { type: 'error' };

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

/** True while the current track plays through the embed (not <audio>). */
let usingEmbed = false;
let ytPoll: ReturnType<typeof setInterval> | null = null;

export function setUsingEmbed(v: boolean): void {
  usingEmbed = v;
}
export function isUsingEmbed(): boolean {
  return usingEmbed;
}

function embedLive() {
  const p = getEmbed();
  return usingEmbed && p && typeof p.getPlayerState === 'function' ? p : null;
}

export function pbPaused(): boolean {
  const p = embedLive();
  return p ? p.getPlayerState() !== YT_STATE.PLAYING : audio.paused;
}
export function pbCurrent(): number {
  try {
    const p = embedLive();
    return p ? p.getCurrentTime() || 0 : audio.currentTime;
  } catch {
    return 0;
  }
}
export function pbDuration(): number {
  try {
    const p = embedLive();
    return p ? p.getDuration() || 0 : audio.duration;
  } catch {
    return 0;
  }
}
export function pbPlay(): void {
  const p = embedLive();
  if (p) p.playVideo();
  else
    audio.play().catch(() => {
      /* autoplay blocked — user will press play */
    });
}
export function pbPause(): void {
  const p = embedLive();
  if (p) p.pauseVideo();
  else audio.pause();
}
export function pbSeekTo(sec: number): void {
  const p = embedLive();
  if (p) p.seekTo(Math.max(0, sec), true);
  else audio.currentTime = sec;
}
export function pbSetRate(r: number): void {
  const p = embedLive();
  if (p) {
    // YouTube only accepts advertised rates — snap to the nearest one.
    let rates: number[] = [1];
    try {
      rates = p.getAvailablePlaybackRates() || rates;
    } catch {
      /* keep default */
    }
    const near = rates.reduce((a, b) => (Math.abs(b - r) < Math.abs(a - r) ? b : a), rates[0] ?? 1);
    try {
      p.setPlaybackRate(near);
    } catch {
      /* embed not ready */
    }
  } else {
    audio.playbackRate = r;
  }
}

/** Stop the embed + its progress poll (when leaving a YouTube feed). */
export function embedStop(): void {
  stopEmbedPoll();
  const p = getEmbed();
  if (p) {
    try {
      p.stopVideo();
    } catch {
      /* already stopped */
    }
  }
}

/** The embed has no timeupdate event — poll while playing. */
export function startEmbedPoll(): void {
  if (ytPoll) return;
  ytPoll = setInterval(() => {
    if (usingEmbed && !pbPaused()) emit({ type: 'timeupdate', current: pbCurrent(), duration: pbDuration() });
  }, 250);
}
export function stopEmbedPoll(): void {
  if (ytPoll) {
    clearInterval(ytPoll);
    ytPoll = null;
  }
}

/** Route embed state changes into engine events (wired by the player screen). */
export function handleEmbedState(state: number): void {
  if (state === YT_STATE.PLAYING) {
    emit({ type: 'play' });
    emit({ type: 'timeupdate', current: pbCurrent(), duration: pbDuration() });
    startEmbedPoll();
  } else if (state === YT_STATE.PAUSED) {
    emit({ type: 'pause' });
    emit({ type: 'timeupdate', current: pbCurrent(), duration: pbDuration() });
  } else if (state === YT_STATE.ENDED) {
    emit({ type: 'pause' });
    emit({ type: 'ended' });
  }
}

// <audio> events → engine events (throttled timeupdate ~4 fps like legacy)
let lastUi = 0;
audio.addEventListener('timeupdate', () => {
  if (usingEmbed) return;
  const now = performance.now();
  if (now - lastUi < 250) return;
  lastUi = now;
  emit({ type: 'timeupdate', current: audio.currentTime, duration: audio.duration });
});
audio.addEventListener('play', () => {
  if (!usingEmbed) emit({ type: 'play' });
});
audio.addEventListener('pause', () => {
  if (!usingEmbed) emit({ type: 'pause' });
});
audio.addEventListener('ended', () => {
  if (!usingEmbed) emit({ type: 'ended' });
});
audio.addEventListener('error', () => {
  if (!usingEmbed) emit({ type: 'error' });
});
