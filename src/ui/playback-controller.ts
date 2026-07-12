/**
 * Playback controller — the single owner of the playback session: feed
 * loading (stale-while-revalidate), episode selection, source selection
 * (offline blob → direct URL → YouTube embed fallback), blob-URL lifecycle,
 * queue/auto-next, progress persistence and Media Session metadata.
 *
 * INTERFACE CONTRACT (frozen in WP-0): the types below are consumed by the
 * podcast, now-playing and queue views. WP-D replaces the stub factory body
 * with the behavior-preserving port of the legacy screens/player.ts
 * (`git show ed59840:src/ui/screens/player.ts`) WITHOUT changing these types.
 */

import type { Episode, FeedMeta, FeedRequest, ResolvedFeed } from '../feeds/types';
import { signal, type Signal } from '../state/signals';
import { resolveFeed } from '../feeds/resolve';
import { t, currentLang } from '../i18n';
import { httpsOnly } from '../lib/safe';
import {
  audio,
  embedStop,
  handleEmbedState,
  isUsingEmbed,
  onEngine,
  pbCurrent,
  pbDuration,
  pbPause,
  pbPaused,
  pbPlay,
  pbSeekTo,
  pbSetRate,
  setUsingEmbed,
} from '../player/engine';
import { downloadEpisode } from '../player/downloads';
import { downloadOffline, offlineAudioUrl, removeDownload } from '../player/offline';
import { getCachedFeed, putCachedFeed, listDownloads } from '../storage/db';
import { setMediaMetadata } from '../player/media-session';
import { getLastPlayed, getProgress, setLastPlayed, setProgress } from '../storage/progress';
import { nowPlaying } from '../state/now-playing';
import { clearQueue, dequeueNext, enqueue, queuePosition, removeFromQueue } from '../state/queue';
import { settings } from '../state/settings';
import {
  ensureEmbed,
  getEmbed,
  onEmbedError,
  onEmbedStateChange,
  ytPlaylistIds,
} from '../youtube/embed';
import { ytServiceAudioUrl } from '../youtube/piped';
import { svcJson } from '../feeds/proxy-chain';
import { toast } from './toast';

export interface PlaybackStatus {
  kind: 'idle' | 'loading' | 'ok' | 'error';
  /** Human-readable, already translated. */
  message: string;
}

export interface PlaybackSession {
  meta: FeedMeta | null;
  /** The request that produced this session (null before the first feed). */
  req: FeedRequest | null;
  /** All episodes, in the current sort order. */
  episodes: Episode[];
  /** Episodes after sort + text filter — indexes below point into this. */
  filtered: Episode[];
  /** Index of the loaded episode in `filtered`, -1 when none. */
  currentIndex: number;
  currentTrackId: string | null;
  isYT: boolean;
  /** True when only the latest ~15 items could be listed (YT Atom fallback). */
  limited: boolean;
  sortAsc: boolean;
  filter: string;
  downloadedIds: ReadonlySet<string>;
  status: PlaybackStatus;
}

export interface PlaybackController {
  /** Reactive session snapshot — views subscribe and re-render from this. */
  readonly session: Signal<PlaybackSession>;
  /** Load a feed (SWR: cached copy paints instantly, network refreshes). */
  openFeed(req: FeedRequest): void;
  /** Retry the last failed openFeed. */
  retry(): void;
  /** Load + (optionally) play an episode by its index in `filtered`. */
  playEpisode(idx: number, autoplay?: boolean): void;
  next(): void;
  prev(): void;
  togglePlay(): void;
  seekRel(seconds: number): void;
  toggleSort(): void;
  setFilter(q: string): void;
  /** Add/remove an episode (by `filtered` index) from the up-next queue. */
  toggleQueued(idx: number): void;
  /** Download an episode offline, or remove the downloaded copy on 2nd tap. */
  downloadToggle(idx: number): Promise<void>;
  /** Title lookup for queue rows (falls back to a localized placeholder). */
  episodeTitle(id: string): string;
  /** Stop playback and clear the session. */
  reset(): void;
}

export function emptySession(): PlaybackSession {
  return {
    meta: null,
    req: null,
    episodes: [],
    filtered: [],
    currentIndex: -1,
    currentTrackId: null,
    isYT: false,
    limited: false,
    sortAsc: true,
    filter: '',
    downloadedIds: new Set(),
    status: { kind: 'idle', message: '' },
  };
}

/**
 * The real playback controller — a behaviour-preserving port of the legacy
 * combined player screen (`src/ui/screens/player.ts`), stripped of all view
 * concerns. Everything the views need to render lives in the `session` signal;
 * everything else (blob-URL lifecycle, abort controllers, embed notice) is
 * private closure state.
 */
export function createPlaybackController(): PlaybackController {
  const session = signal<PlaybackSession>(emptySession());

  // ── private, non-reactive state ──────────────────────────────────
  let loadAbort: AbortController | null = null;
  let currentBlobUrl: string | null = null;
  let embedNoticeShown = false;

  // ── session helpers ──────────────────────────────────────────────
  const patch = (p: Partial<PlaybackSession>): void => session.update((s) => ({ ...s, ...p }));
  /** Force a re-emit (list rows read queue/progress/settings out of band). */
  const bump = (): void => session.update((s) => ({ ...s }));

  function okStatus(count: number, limited: boolean): PlaybackStatus {
    return {
      kind: 'ok',
      message: t('status_ok', count) + (limited ? ' · ' + t('yt_limit_note') : ''),
    };
  }

  function feedIdOf(req: FeedRequest): string {
    switch (req.kind) {
      case 'itunes':
        return req.id;
      case 'rss':
        return 'rss:' + req.url;
      case 'yt':
        return 'yt:' + req.info.type + ':' + req.info.id;
    }
  }

  // ── feed opening (stale-while-revalidate) ────────────────────────
  function openFeed(req: FeedRequest): void {
    const cur = session();
    // Re-entering the already-loaded feed (e.g. via the mini player): keep it
    // — reloading would interrupt playback.
    if (cur.meta?.id === feedIdOf(req) && cur.episodes.length) return;

    loadAbort?.abort();
    loadAbort = new AbortController();
    const sig = loadAbort.signal;
    const timeout = setTimeout(() => loadAbort?.abort(), req.kind === 'itunes' ? 10000 : 25000);

    embedStop();
    setUsingEmbed(false);
    clearQueue();

    // Fresh session for this feed, preserving only the sticky filter text.
    session.set({
      ...emptySession(),
      req,
      isYT: req.kind === 'yt',
      sortAsc: cur.sortAsc,
      filter: cur.filter,
      status: { kind: 'loading', message: t('status_loading') },
    });

    const feedId = feedIdOf(req);
    let painted = false; // true once a list (cache or network) is on screen

    const applyResolved = (resolved: ResolvedFeed): void => {
      const eps = resolved.episodes;
      if (!eps.length) throw new Error(t('ep_not_found'));

      const S = settings();
      const sortAsc = S.defaultSort === 'asc';
      const hasDates = eps.some((e) => e.releaseDate);
      const sorted = hasDates
        ? eps.slice().sort((a, b) => +new Date(a.releaseDate || 0) - +new Date(b.releaseDate || 0))
        : eps.slice().reverse(); // newest-first source order → oldest-first
      if (!sortAsc) sorted.reverse();

      const q = session().filter.trim().toLowerCase();
      const filtered = q
        ? sorted.filter((e) => (e.trackName || '').toLowerCase().includes(q))
        : sorted.slice();

      const trackId = session().currentTrackId;
      const currentIndex = trackId != null
        ? filtered.findIndex((e) => String(e.trackId) === trackId)
        : -1;

      patch({
        meta: resolved.meta,
        limited: resolved.limited,
        episodes: sorted,
        filtered,
        currentIndex,
        sortAsc,
        status: okStatus(sorted.length, resolved.limited),
      });

      if (painted) return; // refresh under an already-visible list — done above
      painted = true;
      audio.playbackRate = S.defaultSpeed;

      const lastId = getLastPlayed(resolved.meta.id);
      if (lastId) {
        const idx = filtered.findIndex((e) => String(e.trackId) === lastId);
        if (idx >= 0) playEpisode(idx, false);
      }
    };

    void (async () => {
      const dl = new Set((await listDownloads()).map((d) => d.id));
      patch({ downloadedIds: dl });

      // Paint the cached copy instantly, then refresh from the network.
      const cached = await getCachedFeed(feedId);
      if (cached && !sig.aborted) {
        try {
          applyResolved(cached.feed);
        } catch {
          /* unusable cache entry — skeleton stays until network */
        }
      }

      try {
        const resolved = await resolveFeed(req, {
          signal: sig,
          ytVideoTitle: t('yt_video'),
          playlistIds: ytPlaylistIds,
        });
        clearTimeout(timeout);
        if (sig.aborted) return;
        applyResolved(resolved);
        void putCachedFeed(resolved);

        // Embed fallback may leave title-less items — fill real titles in bg.
        if (session().isYT && session().episodes.some((e) => e.ytId && !e.trackName)) {
          void fillEmbedTitles(sig);
        }
      } catch (e) {
        clearTimeout(timeout);
        const err = e as Error;
        if (err.name === 'AbortError') return;
        if (painted) return; // cached list stays usable offline
        patch({ status: { kind: 'error', message: t('status_err') + (err.message || String(err)) } });
      }
    })();
  }

  /** Background-fill real titles via noembed (embed fallback items). */
  async function fillEmbedTitles(sig: AbortSignal): Promise<void> {
    const targets = session().episodes.filter((e) => e.ytId && !e.trackName);
    if (!targets.length) return;
    let i = 0;
    let since = 0;
    const reRender = (): void => {
      if (session().isYT && !sig.aborted) bump();
    };
    const worker = async (): Promise<void> => {
      while (i < targets.length) {
        if (sig.aborted) return;
        const ep = targets[i++];
        if (!ep) break;
        try {
          const r = await svcJson<{ title?: string }>(
            'https://noembed.com/embed?url=https://www.youtube.com/watch?v=' +
              encodeURIComponent(ep.ytId ?? ''),
            sig,
            8000,
          );
          if (r?.title) {
            ep.trackName = r.title;
            if (++since >= 6) {
              since = 0;
              reRender();
            }
          }
        } catch {
          /* title stays a fallback */
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    reRender();
  }

  // ── playback ─────────────────────────────────────────────────────
  function playEpisode(idx: number, autoplay = false): void {
    const s = session();
    if (idx < 0 || idx >= s.filtered.length) return;
    const ep = s.filtered[idx];
    if (!ep) return;
    const id = String(ep.trackId);
    const meta = s.meta;

    cancelEmbedRescue();
    patch({ currentIndex: idx, currentTrackId: id });

    if (s.isYT) {
      void ytResolveAndPlay(ep, id, autoplay);
    } else {
      void startAudioPreferOffline(ep.episodeUrl || '', id, autoplay);
    }

    setMediaMetadata({
      title: ep.trackName || '',
      artist: meta?.artist || '',
      album: meta?.name || '',
      artworkUrl: meta ? httpsOnly(meta.art) : '',
    });
    nowPlaying.set({
      title: ep.trackName || t('ep_fallback', idx + 1),
      feedName: meta?.name || '',
      art: ep.art || (meta ? httpsOnly(meta.art) : ''),
    });

    if (meta) setLastPlayed(meta.id, id);
    bump();
  }

  /** Play the downloaded copy when one exists, otherwise the stream URL. */
  async function startAudioPreferOffline(src: string, id: string, autoplay: boolean): Promise<void> {
    const local = session().downloadedIds.has(id) ? await offlineAudioUrl(id) : null;
    if (session().currentTrackId !== id) {
      if (local) URL.revokeObjectURL(local); // user moved on during the lookup
      return;
    }
    startAudio(local ?? src, id, autoplay);
  }

  function startAudio(src: string, id: string, autoplay: boolean): void {
    embedStop();
    setUsingEmbed(false);
    if (currentBlobUrl && currentBlobUrl !== src) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }
    if (src.startsWith('blob:')) currentBlobUrl = src;
    audio.src = src;
    audio.load();
    const applyPrefs = (): void => {
      const S = settings();
      audio.playbackRate = S.defaultSpeed;
      if (S.resumePos) {
        const saved = getProgress(id);
        if (saved > 5 && isFinite(audio.duration) && saved < audio.duration - 2) {
          audio.currentTime = saved;
        }
      }
    };
    if (audio.readyState >= 2) applyPrefs();
    else audio.addEventListener('canplay', applyPrefs, { once: true });
    if (autoplay) {
      audio.play().catch(() => {
        /* autoplay blocked */
      });
    }
  }

  async function ytResolveAndPlay(ep: Episode, id: string, autoplay: boolean): Promise<void> {
    audio.pause();
    // Downloaded copy wins — no network resolution needed.
    if (session().downloadedIds.has(id)) {
      const local = await offlineAudioUrl(id);
      if (!session().isYT || session().currentTrackId !== id) {
        if (local) URL.revokeObjectURL(local);
        return;
      }
      if (local) {
        startAudio(local, id, autoplay);
        patch({ status: okStatus(session().episodes.length, session().limited) });
        return;
      }
    }
    patch({ status: { kind: 'loading', message: t('status_loading') } });
    let url: string | null = null;
    try {
      url = await ytServiceAudioUrl(ep.ytId ?? '', loadAbort?.signal);
    } catch {
      url = null;
    }
    if (!session().isYT || session().currentTrackId !== id) return; // user moved on
    if (url) {
      ep.episodeUrl = url; // real media URL → download works too
      startAudio(url, id, autoplay);
      patch({ status: okStatus(session().episodes.length, session().limited) });
    } else {
      setUsingEmbed(true);
      // The iframe can't keep playing on a locked phone — be upfront about it.
      if (!embedNoticeShown) {
        embedNoticeShown = true;
        toast(t('yt_embed_bg'), 'info');
      }
      await embedLoadEp(ep, autoplay);
      // …but keep hunting for a real audio stream in the background: the
      // instant one resolves we hot-swap to <audio>, which DOES keep playing
      // with the screen locked (plus lock-screen Media Session controls).
      scheduleEmbedRescue(ep, id);
    }
  }

  // ── embed → audio background rescue ──────────────────────────────
  let rescueTimer: ReturnType<typeof setTimeout> | null = null;
  let rescueTry = 0;
  const RESCUE_DELAYS = [8000, 30000, 60000, 120000, 180000];

  function cancelEmbedRescue(): void {
    if (rescueTimer) {
      clearTimeout(rescueTimer);
      rescueTimer = null;
    }
    rescueTry = 0;
  }

  /** Retry audio resolution while the embed fallback plays; on success swap
   *  to <audio> at the embed's current position, preserving play state. */
  function scheduleEmbedRescue(ep: Episode, id: string): void {
    cancelEmbedRescue();
    const stillOnEmbed = (): boolean =>
      session().isYT && session().currentTrackId === id && isUsingEmbed();
    const attempt = async (): Promise<void> => {
      rescueTimer = null;
      if (!stillOnEmbed()) return;
      let url: string | null = null;
      try {
        url = await ytServiceAudioUrl(ep.ytId ?? '', loadAbort?.signal);
      } catch {
        url = null;
      }
      if (!stillOnEmbed()) return;
      if (url) {
        ep.episodeUrl = url; // real media URL → download works too
        const pos = pbCurrent();
        const wasPlaying = !pbPaused();
        startAudio(url, id, wasPlaying);
        // Land where the embed was (applyPrefs' saved-progress seek targets
        // roughly the same second; this exact seek wins on loadedmetadata).
        const seekBack = (): void => {
          if (pos > 0 && isFinite(audio.duration) && pos < audio.duration - 2) {
            audio.currentTime = pos;
          }
        };
        if (audio.readyState >= 1) seekBack();
        else audio.addEventListener('loadedmetadata', seekBack, { once: true });
        return;
      }
      if (rescueTry < RESCUE_DELAYS.length - 1) {
        rescueTry++;
        rescueTimer = setTimeout(() => void attempt(), RESCUE_DELAYS[rescueTry]);
      }
    };
    rescueTimer = setTimeout(() => void attempt(), RESCUE_DELAYS[0]);
  }

  async function embedLoadEp(ep: Episode, autoplay: boolean): Promise<void> {
    patch({ status: { kind: 'loading', message: t('status_loading') } });
    try {
      await ensureEmbed();
    } catch {
      patch({ status: { kind: 'error', message: t('yt_embed_blocked') } });
      return;
    }
    if (!session().isYT || session().currentTrackId !== String(ep.trackId)) return;
    const S = settings();
    const savedPos = S.resumePos && getProgress(String(ep.trackId)) > 5 ? getProgress(String(ep.trackId)) : 0;
    const p = getEmbed();
    if (!p) return;
    try {
      const opts = { videoId: ep.ytId ?? '', startSeconds: savedPos, suggestedQuality: 'small' };
      if (autoplay) p.loadVideoById(opts);
      else p.cueVideoById(opts);
      try {
        p.setPlaybackQuality('small');
      } catch {
        /* older API */
      }
      pbSetRate(S.defaultSpeed);
    } catch {
      patch({ status: { kind: 'error', message: t('yt_embed_blocked') } });
      return;
    }
    patch({ status: okStatus(session().episodes.length, session().limited) });
  }

  function togglePlay(): void {
    const s = session();
    if (!s.isYT && !audio.src) return;
    if (s.currentTrackId == null) return;
    if (pbPaused()) pbPlay();
    else pbPause();
  }

  function seekRel(seconds: number): void {
    const dur = pbDuration();
    if (!session().isYT && !audio.src) return;
    if (!Number.isFinite(dur) || !dur) return;
    pbSeekTo(Math.max(0, Math.min(pbCurrent() + seconds, dur)));
  }

  function prev(): void {
    const s = session();
    if (s.currentIndex > 0) playEpisode(s.currentIndex - 1, !pbPaused());
  }
  function next(): void {
    const s = session();
    if (s.currentIndex >= 0 && s.currentIndex < s.filtered.length - 1) {
      playEpisode(s.currentIndex + 1, !pbPaused());
    }
  }

  // ── sort & filter ────────────────────────────────────────────────
  function toggleSort(): void {
    const s = session();
    const sortAsc = !s.sortAsc;
    const episodes = s.episodes.slice().reverse();
    const filtered = s.filtered.slice().reverse();
    const currentIndex = s.currentTrackId != null
      ? filtered.findIndex((e) => String(e.trackId) === s.currentTrackId)
      : -1;
    patch({ sortAsc, episodes, filtered, currentIndex });
  }

  function setFilter(q: string): void {
    const s = session();
    const query = q.trim().toLowerCase();
    const filtered = query
      ? s.episodes.filter((e) => (e.trackName || '').toLowerCase().includes(query))
      : s.episodes.slice();
    const currentIndex = s.currentTrackId != null
      ? filtered.findIndex((e) => String(e.trackId) === s.currentTrackId)
      : -1;
    patch({ filter: q, filtered, currentIndex });
  }

  // ── queue ────────────────────────────────────────────────────────
  function toggleQueued(idx: number): void {
    const ep = session().filtered[idx];
    if (!ep) return;
    const id = String(ep.trackId);
    if (queuePosition(id)) {
      removeFromQueue(id);
    } else {
      enqueue(id);
      toast(t('queued'));
    }
    bump();
  }

  // ── downloads ────────────────────────────────────────────────────
  async function downloadToggle(idx: number): Promise<void> {
    const s = session();
    const ep = s.filtered[idx];
    if (!ep) return;
    const id = String(ep.trackId);

    // Second tap on a downloaded episode removes the offline copy.
    if (s.downloadedIds.has(id)) {
      await removeDownload(id);
      const dl = new Set(session().downloadedIds);
      dl.delete(id);
      patch({ downloadedIds: dl });
      toast(t('dl_removed'));
      return;
    }

    const outcome = await downloadOffline(ep, s.meta?.id ?? '', s.isYT);
    if (outcome === 'ok') {
      const dl = new Set(session().downloadedIds);
      dl.add(id);
      patch({ downloadedIds: dl });
      toast(t('dl_saved'));
      return;
    }
    if (outcome === 'no-url') {
      toast(t('dl_not_found'), 'error');
      bump();
      return;
    }
    // CORS-blocked CDN etc. → legacy browser file download still works.
    const fb = await downloadEpisode(ep, s.isYT);
    toast(fb === 'ok' ? t('dl_fallback_file') : t('dl_not_found'), fb === 'ok' ? 'info' : 'error');
    bump();
  }

  function episodeTitle(id: string): string {
    const eps = session().episodes;
    const i = eps.findIndex((e) => String(e.trackId) === id);
    const ep = eps[i];
    return ep ? ep.trackName || t('ep_fallback', i + 1) : '';
  }

  function retry(): void {
    const req = session().req;
    if (req) openFeed(req);
  }

  function reset(): void {
    cancelEmbedRescue();
    audio.pause();
    if (currentBlobUrl) {
      audio.removeAttribute('src');
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }
    nowPlaying.set(null);
    embedStop();
    setUsingEmbed(false);
    loadAbort?.abort();
    document.body.classList.remove('is-playing');
    session.set(emptySession());
  }

  // ── engine wiring ────────────────────────────────────────────────
  onEngine((e) => {
    switch (e.type) {
      case 'play': {
        document.body.classList.add('is-playing');
        // Fill title from embed video data when missing (single-video feeds).
        if (isUsingEmbed()) {
          try {
            const s = session();
            const ep = s.currentIndex >= 0 ? s.filtered[s.currentIndex] : undefined;
            const d = getEmbed()?.getVideoData?.();
            if (ep && !ep.trackName && d?.title) {
              ep.trackName = d.title;
              const np = nowPlaying();
              if (np) nowPlaying.set({ ...np, title: d.title });
              bump();
            }
          } catch {
            /* embed data unavailable */
          }
        }
        break;
      }
      case 'pause':
        document.body.classList.remove('is-playing');
        break;
      case 'ended': {
        const s = session();
        // Queue wins over plain list order.
        const nextQueued = dequeueNext(s.currentTrackId ?? undefined);
        if (nextQueued) {
          const qi = s.filtered.findIndex((x) => String(x.trackId) === nextQueued);
          if (qi >= 0) {
            playEpisode(qi, true);
            break;
          }
        }
        if (settings().autoNext && s.currentIndex < s.filtered.length - 1) {
          playEpisode(s.currentIndex + 1, true);
        }
        break;
      }
      case 'timeupdate': {
        // Progress persistence only — the visual scrubber is WP-E's job.
        const s = session();
        const ep = s.currentIndex >= 0 ? s.filtered[s.currentIndex] : undefined;
        if (ep && e.current > 5) setProgress(String(ep.trackId), e.current);
        break;
      }
      case 'error':
        patch({ status: { kind: 'error', message: t('audio_err') } });
        document.body.classList.remove('is-playing');
        break;
    }
  });
  onEmbedStateChange(handleEmbedState);
  onEmbedError(() => patch({ status: { kind: 'error', message: t('yt_embed_blocked') } }));

  // ── global keyboard shortcuts (feed view / Now Playing sheet) ─────
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const tag = (target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea' || target.isContentEditable) return;
    const sheetOpen = document.getElementById('npSheet')?.classList.contains('open');
    if (!document.body.classList.contains('feed-open') && !sheetOpen) return;
    switch (e.key) {
      case ' ':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        seekRel(-settings().skipBack);
        break;
      case 'ArrowRight':
        e.preventDefault();
        seekRel(settings().skipForward);
        break;
      case 'ArrowUp':
        e.preventDefault();
        prev();
        break;
      case 'ArrowDown':
        e.preventDefault();
        next();
        break;
    }
  });

  // Language change → refresh translated status text (list dates/labels are
  // re-rendered by the views' own currentLang subscription).
  currentLang.subscribe(() => {
    const s = session();
    if (s.status.kind === 'ok') patch({ status: okStatus(s.episodes.length, s.limited) });
    else if (s.status.kind === 'loading') patch({ status: { kind: 'loading', message: t('status_loading') } });
  });

  // Settings change → re-emit so lists pick up showDl / row metrics.
  settings.subscribe(() => {
    if (session().episodes.length) bump();
  });

  return {
    session,
    openFeed,
    retry,
    playEpisode,
    next,
    prev,
    togglePlay,
    seekRel,
    toggleSort,
    setFilter,
    toggleQueued,
    downloadToggle,
    episodeTitle,
    reset,
  };
}
