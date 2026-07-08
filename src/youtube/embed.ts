/**
 * Official YouTube IFrame embed — the per-track fallback when no Piped
 * instance serves a real audio stream. Loaded lazily on first use.
 */

export interface YtPlayer {
  getPlayerState(): number;
  getCurrentTime(): number;
  getDuration(): number;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(sec: number, allowSeekAhead: boolean): void;
  getAvailablePlaybackRates(): number[];
  setPlaybackRate(rate: number): void;
  loadVideoById(opts: { videoId: string; startSeconds?: number; suggestedQuality?: string }): void;
  cueVideoById(opts: { videoId: string; startSeconds?: number; suggestedQuality?: string }): void;
  cuePlaylist(opts: { list: string; listType: string; suggestedQuality?: string }): void;
  getPlaylist(): string[] | null;
  setPlaybackQuality(q: string): void;
  getVideoData?(): { title?: string } | undefined;
}

interface YtNamespace {
  Player: new (
    host: string,
    opts: {
      host?: string;
      playerVars?: Record<string, unknown>;
      events?: {
        onReady?: () => void;
        onStateChange?: (e: { data: number }) => void;
        onError?: () => void;
      };
    },
  ) => YtPlayer;
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
}

declare global {
  interface Window {
    YT?: YtNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export const YT_STATE = { PLAYING: 1, PAUSED: 2, ENDED: 0 } as const;

let apiLoading: Promise<void> | null = null;

function loadYtApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (apiLoading) return apiLoading;
  apiLoading = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') {
        try {
          prev();
        } catch {
          /* third-party handler — not our problem */
        }
      }
      resolve();
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => reject(new Error('yt api load failed'));
    document.head.appendChild(s);
  });
  return apiLoading;
}

let player: YtPlayer | null = null;
let ready: Promise<void> | null = null;
let stateHandler: ((state: number) => void) | null = null;

export function onEmbedStateChange(fn: (state: number) => void): void {
  stateHandler = fn;
}

let errorHandler: (() => void) | null = null;
export function onEmbedError(fn: () => void): void {
  errorHandler = fn;
}

/** Create the YT.Player once (into #ytHost); resolves when usable. */
export function ensureEmbed(): Promise<YtPlayer> {
  if (ready && player) return ready.then(() => player as YtPlayer);
  ready = loadYtApi().then(
    () =>
      new Promise<void>((resolve) => {
        const YTNS = window.YT as YtNamespace;
        player = new YTNS.Player('ytHost', {
          host: 'https://www.youtube-nocookie.com',
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
          events: {
            onReady: () => resolve(),
            onStateChange: (e) => stateHandler?.(e.data),
            onError: () => errorHandler?.(),
          },
        });
      }),
  );
  ready.catch(() => {
    // Don't poison the cached promise — allow a later retry.
    ready = null;
    apiLoading = null;
    player = null;
  });
  return ready.then(() => player as YtPlayer);
}

export function getEmbed(): YtPlayer | null {
  return player;
}

/**
 * Enumerate a full playlist's video ids (up to ~200) via the IFrame player:
 * cue the playlist (no autoplay) and poll getPlaylist() until populated.
 */
export async function ytPlaylistIds(
  playlistId: string,
  signal?: AbortSignal,
  timeoutMs = 10000,
): Promise<string[]> {
  const p = await ensureEmbed();
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn: (v: never) => void, val: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(to);
      clearInterval(iv);
      signal?.removeEventListener('abort', onAbort);
      (fn as (v: unknown) => void)(val);
    };
    const onAbort = () => finish(reject as never, new DOMException('aborted', 'AbortError'));
    const to = setTimeout(() => finish(reject as never, new Error('playlist timeout')), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      p.cuePlaylist({ list: playlistId, listType: 'playlist', suggestedQuality: 'small' });
    } catch (e) {
      finish(reject as never, e);
      return;
    }
    const iv = setInterval(() => {
      let ids: string[] | null = null;
      try {
        ids = p.getPlaylist();
      } catch {
        /* player not ready yet — keep polling */
      }
      if (Array.isArray(ids) && ids.length) finish(resolve as never, ids.slice());
    }, 300);
  });
}
