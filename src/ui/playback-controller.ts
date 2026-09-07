/**
 * Playback controller — the seam between BROWSING a feed and PLAYING an
 * episode. These were one object until they were split: a single `session`
 * meant both "the feed on screen" and "the thing playing", so every navigation
 * reached into the live transport. Opening any feed called `embedStop()`,
 * `clearQueue()` and then `audio.load()` for that feed's last-played episode —
 * which stops whatever is playing even with `autoplay: false`.
 *
 * The split:
 *   - `session`  (here)                — the browsed feed: list, sort, filter,
 *                                        downloads, status. Never touches audio.
 *   - `playing`  (player/session.ts)   — the loaded episode and the feed it
 *                                        belongs to. Written only by playEpisode
 *                                        and friends; owns prev/next/auto-next.
 *
 * `session.currentIndex` / `currentTrackId` are derived: they point at the
 * playing episode's row only while the browsed feed IS the playing feed, so the
 * list can still highlight it without owning it.
 */

import type { Episode, FeedMeta, FeedRequest, ResolvedFeed } from '../feeds/types';
import { signal, type Signal } from '../state/signals';
import { resolveFeed } from '../feeds/resolve';
import { feedIdOf, requestFromFeedId } from '../feeds/feed-id';
import { t, currentLang } from '../i18n';
import { httpsOnly } from '../lib/safe';
import {
  audio,
  onEngine,
  pbCurrent,
  pbDuration,
  pbPause,
  pbPaused,
  pbPlay,
  pbSeekTo,
} from '../player/engine';
import { initRecovery, noteUserIntent, resetRecovery } from '../player/recovery';
import { initPrefetch, prefetchEpisode } from '../player/prefetch';
import { downloadEpisode } from '../player/downloads';
import { downloadOffline, offlineAudioUrl, removeDownload } from '../player/offline';
import { getCachedFeed, putCachedFeed, putResume, listDownloads } from '../storage/db';
import { setMediaMetadata, setMediaPosition, setPlaybackState } from '../player/media-session';
import { getLastPlayed, getProgress, setLastPlayed, setProgress } from '../storage/progress';
import { playing, nowPlayingLabel, type PlayingSession } from '../player/session';
import { dequeueNext, enqueue, queuePosition, removeFromQueue, type QueueItem } from '../state/queue';
import { settings } from '../state/settings';
import { refreshSubscription } from '../storage/subscriptions';
import { consumeSleepAtEpisodeEnd } from '../player/sleep-timer';
import { PRIVATE_FEED_ERROR } from '../feeds/credential-url';
import { API_BASE, PROXIES_DISABLED_ERROR } from '../feeds/proxy-chain';
import { toast } from './toast';

/**
 * Below this, a position is noise rather than progress: it is not saved, not
 * resumed to, and a listener who has passed it is under way rather than
 * resuming.
 */
const RESUME_FLOOR_SEC = 5;

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
  /** Index of the PLAYING episode in `filtered`, -1 when it is another feed's. */
  currentIndex: number;
  currentTrackId: string | null;
  /** True when the list is only part of the show's archive. */
  limited: boolean;
  /** Episodes the source says exist in total, when it says. */
  total?: number;
  sortAsc: boolean;
  filter: string;
  downloadedIds: ReadonlySet<string>;
  status: PlaybackStatus;
}

export interface PlaybackController {
  /** Reactive browse snapshot — the feed views subscribe and render from this. */
  readonly session: Signal<PlaybackSession>;
  /** Reactive playing snapshot — the transport surfaces render from this. */
  readonly playing: Signal<PlayingSession | null>;
  /** Load a feed for browsing (SWR). Never interrupts playback. */
  openFeed(req: FeedRequest): void;
  /**
   * Explicit "continue where I left off": loads (without playing) the next
   * opened feed's last-played episode. Browsing deliberately no longer does
   * this on its own — call it from the Home continue rail and the resume
   * shortcut, the two places the user actually asked to resume.
   */
  resumeLastPlayed(): void;
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
  /** Stop playback and clear the playing session (the browsed feed stays). */
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
    limited: false,
    total: 0,
    sortAsc: true,
    filter: '',
    downloadedIds: new Set(),
    status: { kind: 'idle', message: '' },
  };
}

/**
 * Feed order for the list: chronological when the feed actually carries dates,
 * otherwise the source order (which every source we use hands over newest-first).
 *
 * The threshold matters. `some()` was enough to switch to date sorting, so a
 * feed where only a handful of items are dated sorted every undated one as
 * epoch 0 and scattered them to one end. A majority rule keeps a fully dated
 * feed chronological and leaves a sparsely dated one in source order.
 */
function sortEpisodes(eps: readonly Episode[], sortAsc: boolean): Episode[] {
  const dated = eps.reduce((n, e) => n + (e.releaseDate ? 1 : 0), 0);
  const sorted =
    dated * 2 > eps.length
      ? eps.slice().sort((a, b) => +new Date(a.releaseDate || 0) - +new Date(b.releaseDate || 0))
      : eps.slice().reverse(); // newest-first source order → oldest-first
  if (!sortAsc) sorted.reverse();
  return sorted;
}

export function createPlaybackController(): PlaybackController {
  const session = signal<PlaybackSession>(emptySession());

  // ── private, non-reactive state ──────────────────────────────────
  /** Aborts feed LOADING only. Never cancels an in-flight audio resolution. */
  let loadAbort: AbortController | null = null;
  /** Aborts the PLAYING track's source resolution. */
  let playAbort: AbortController | null = null;
  let currentBlobUrl: string | null = null;
  /** One-shot: consumed by the next feed that paints. See resumeLastPlayed. */
  let resumeOnPaint = false;

  // ── session helpers ──────────────────────────────────────────────
  const patch = (p: Partial<PlaybackSession>): void => session.update((s) => ({ ...s, ...p }));
  /** Force a re-emit (list rows read queue/progress/settings out of band). */
  const bump = (): void => session.update((s) => ({ ...s }));

  /**
   * "41 episodes ✓ · of 2676 in the archive" when the source admits it handed
   * back only part of the show, so a truncated list never reads as the whole.
   */
  function okStatus(count: number, limited: boolean, total?: number): PlaybackStatus {
    const note = !limited ? '' : total ? t('limit_of_total', total) : t('limit_note');
    return { kind: 'ok', message: t('status_ok', count) + (note ? ' · ' + note : '') };
  }

  /**
   * Re-derive where the playing episode sits in the browsed list. -1 whenever
   * the user is looking at a different feed than the one playing.
   */
  function markPlayingRow(): void {
    const s = session();
    const p = playing();
    const onThisFeed = !!p && !!s.meta && p.feedId === s.meta.id;
    const currentTrackId = onThisFeed ? (p as PlayingSession).trackId : null;
    const currentIndex = currentTrackId
      ? s.filtered.findIndex((e) => String(e.trackId) === currentTrackId)
      : -1;
    if (s.currentTrackId === currentTrackId && s.currentIndex === currentIndex) return;
    patch({ currentIndex, currentTrackId });
  }

  // ── feed opening (stale-while-revalidate) ────────────────────────
  function openFeed(req: FeedRequest): void {
    const cur = session();
    const feedId = feedIdOf(req);
    // Re-entering the already-loaded feed: keep the list (and its scroll state).
    if (cur.meta?.id === feedId && cur.episodes.length) return;

    loadAbort?.abort();
    loadAbort = new AbortController();
    const sig = loadAbort.signal;
    const timeout = setTimeout(() => loadAbort?.abort(), req.kind === 'itunes' ? 10000 : 25000);

    // NOTE: no embedStop(), no clearQueue(), no audio.src write here. Browsing a
    // feed is not a playback action — that conflation is the bug this split fixes.
    session.set({
      ...emptySession(),
      req,
      sortAsc: cur.sortAsc,
      filter: cur.filter,
      status: { kind: 'loading', message: t('status_loading') },
    });

    let painted = false; // true once a list (cache or network) is on screen

    const applyResolved = (resolved: ResolvedFeed): void => {
      const eps = resolved.episodes;
      if (!eps.length) throw new Error(t('ep_not_found'));

      const S = settings();
      const sortAsc = S.defaultSort === 'asc';
      const sorted = sortEpisodes(eps, sortAsc);

      const q = session().filter.trim().toLowerCase();
      const filtered = q
        ? sorted.filter((e) => (e.trackName || '').toLowerCase().includes(q))
        : sorted.slice();

      patch({
        meta: resolved.meta,
        limited: resolved.limited,
        total: resolved.total ?? 0,
        episodes: sorted,
        filtered,
        sortAsc,
        status: okStatus(sorted.length, resolved.limited, resolved.total),
      });
      markPlayingRow();
      // A refresh of the feed that is playing picks up new items and background
      // title fills, so prev/next keep walking a current list.
      adoptRefreshedEpisodes(resolved.meta, filtered);

      // OPML imports carry only a title, so backfill the real artwork/author
      // for a feed the user is already subscribed to.
      refreshSubscription(resolved.meta);

      // Never steals the transport from something already playing.
      if (resumeOnPaint && !playing()) {
        resumeOnPaint = false;
        const lastId = getLastPlayed(resolved.meta.id);
        const idx = lastId ? filtered.findIndex((e) => String(e.trackId) === lastId) : -1;
        if (idx >= 0) playEpisode(idx, false);
      }

      painted = true;
    };

    void (async () => {
      // Only user downloads light up the row's download state; a copy the
      // prefetcher made is invisible bookkeeping.
      const dl = new Set((await listDownloads()).filter((d) => !d.ephemeral).map((d) => d.id));
      if (!sig.aborted) patch({ downloadedIds: dl });

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
        const resolved = await resolveFeed(req, { signal: sig });
        clearTimeout(timeout);
        if (sig.aborted) return;
        applyResolved(resolved);
        void putCachedFeed(resolved);
      } catch (e) {
        clearTimeout(timeout);
        const err = e as Error;
        if (err.name === 'AbortError') return;
        if (painted) return; // cached list stays usable offline
        const message =
          err.message === PRIVATE_FEED_ERROR
            ? t('private_feed_err')
            : err.message === PROXIES_DISABLED_ERROR
              ? t('proxies_disabled_err')
              : t('status_err') + (err.message || String(err));
        patch({ status: { kind: 'error', message } });
      }
    })();
  }

  /**
   * A refreshed copy of the PLAYING feed replaces its episode snapshot, as long
   * as the playing track is still in it (so the index can be remapped). Any
   * other feed's refresh is ignored — that is the whole point of the split.
   */
  function adoptRefreshedEpisodes(meta: FeedMeta, episodes: Episode[]): void {
    const p = playing();
    if (!p || p.feedId !== meta.id) return;
    const index = episodes.findIndex((e) => String(e.trackId) === p.trackId);
    if (index < 0) return;
    playing.set({ ...p, meta, episodes, index });
  }

  // ── playback ─────────────────────────────────────────────────────

  /** Play from the browsed list (the only entry point the feed view needs). */
  function playEpisode(idx: number, autoplay = false): void {
    const s = session();
    if (idx < 0 || idx >= s.filtered.length || !s.meta) return;
    start(
      {
        feedId: s.meta.id,
        meta: s.meta,
        // Snapshot of what the user is looking at: "next" means the next row.
        episodes: s.filtered.slice(),
        index: idx,
        trackId: String(s.filtered[idx]?.trackId ?? ''),
      },
      autoplay,
    );
  }

  /** Move within the PLAYING feed — independent of what is on screen. */
  function playAt(p: PlayingSession, index: number, autoplay: boolean): void {
    const ep = p.episodes[index];
    if (!ep) return;
    start({ ...p, index, trackId: String(ep.trackId) }, autoplay);
  }

  /**
   * The single place that writes the playing session and touches the transport.
   */
  function start(next: PlayingSession, autoplay: boolean): void {
    const ep = next.episodes[next.index];
    if (!ep || !next.trackId) return;

    playAbort?.abort();
    playAbort = new AbortController();
    noteUserIntent(autoplay);
    playing.set(next);
    markPlayingRow();

    void startAudioPreferOffline(ep.episodeUrl || '', next.trackId, autoplay);

    const label = nowPlayingLabel(next);
    setMediaMetadata({
      title: label?.title ?? '',
      artist: next.meta.artist || '',
      album: next.meta.name || '',
      artworkUrl: label?.art ?? '',
    });

    setLastPlayed(next.feedId, next.trackId);
    // Small projection for Home, so it never has to deserialize a whole archive
    // just to render one row.
    void putResume({ id: next.feedId, meta: next.meta, episode: ep, updatedAt: Date.now() });
    bump();
  }

  /** Play the downloaded copy when one exists, otherwise the stream URL. */
  async function startAudioPreferOffline(src: string, id: string, autoplay: boolean): Promise<void> {
    // Asks storage directly rather than the browsed feed's `downloadedIds`,
    // which is the wrong set for a queued episode from another feed.
    const local = await offlineAudioUrl(id);
    if (playing()?.trackId !== id) {
      if (local) URL.revokeObjectURL(local); // user moved on during the lookup
      return;
    }
    startAudio(local ?? src, id, autoplay);
  }

  /**
   * Guard for the app's only media sink: an enclosure URL comes from an
   * untrusted feed, so only https and our own blob: copies get through.
   *
   * The API base is the deliberate exception: in local dev the worker is plain
   * http on loopback, which is also why the CSP lists it under media-src.
   */
  function safeMediaSrc(src: string): string {
    if (src.startsWith('blob:')) return src;
    const https = httpsOnly(src);
    if (https) return https;
    if (API_BASE && src.startsWith(API_BASE + '/')) return src;
    return '';
  }

  function startAudio(src: string, id: string, autoplay: boolean): void {
    const isBlob = src.startsWith('blob:');
    const safe = safeMediaSrc(src);
    if (!safe) {
      patch({ status: { kind: 'error', message: t('audio_err') } });
      return;
    }
    if (currentBlobUrl && currentBlobUrl !== safe) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }
    if (isBlob) currentBlobUrl = safe;
    resetRecovery(); // a new source starts with a clean failure budget
    if (!isBlob) {
      // Streaming from the network — start pulling a local copy alongside it.
      // A blob source is already local, so there is nothing to prefetch.
      const p = playing();
      const ep = p?.episodes[p.index];
      if (p && ep && String(ep.trackId) === id) prefetchEpisode(ep, p.feedId);
    }
    audio.src = safe;
    audio.load();
    /**
     * `canplay` can fire before the element will accept a seek: until the first
     * range request lands, `seekable` is still empty and `currentTime = saved`
     * is silently dropped. Playback then starts from the top, and the next
     * `timeupdate` writes that position over the saved one — the resume is not
     * just skipped, it is destroyed. So keep trying until the seek takes.
     *
     * It stops as soon as the listener is genuinely under way (past the same
     * floor the position is saved at), because past that point a jump is an
     * interruption rather than a restore.
     */
    const resumeTo = (target: number): void => {
      const forSrc = audio.src;

      function attempt(): boolean {
        const ranges = audio.seekable;
        if (!ranges.length || ranges.end(ranges.length - 1) < target) return false;
        audio.currentTime = target;
        return true;
      }

      function stop(): void {
        audio.removeEventListener('progress', retry);
        audio.removeEventListener('canplaythrough', retry);
        audio.removeEventListener('timeupdate', retry);
      }

      function retry(): void {
        // A new episode reuses the element; its listeners must not seek it.
        if (audio.src !== forSrc || audio.currentTime > RESUME_FLOOR_SEC || attempt()) stop();
      }

      if (attempt()) return;
      audio.addEventListener('progress', retry);
      audio.addEventListener('canplaythrough', retry);
      audio.addEventListener('timeupdate', retry);
    };

    const applyPrefs = (): void => {
      const S = settings();
      audio.playbackRate = S.defaultSpeed;
      if (S.resumePos) {
        const saved = getProgress(id);
        if (saved > RESUME_FLOOR_SEC && isFinite(audio.duration) && saved < audio.duration - 2) {
          resumeTo(saved);
        }
      }
    };
    if (audio.readyState >= 2) applyPrefs();
    else audio.addEventListener('canplay', applyPrefs, { once: true });
    if (autoplay) {
      audio.play()?.catch(() => {
        /* autoplay blocked */
      });
    }
  }

  /**
   * Swap in a freshly resolved URL without disturbing the session, the queue or
   * the Media Session notification: same track, same position, same rate. Used
   * only by the recovery watchdog.
   */
  function resumeAudioAt(url: string, positionSec: number): void {
    const safe = safeMediaSrc(url);
    if (!safe) return;
    // `reresolve` may hand back a blob: URL when a download landed mid-episode,
    // so this path owes the same revocation bookkeeping as `startAudio`.
    if (currentBlobUrl && currentBlobUrl !== safe) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }
    if (safe.startsWith('blob:')) currentBlobUrl = safe;
    const rate = audio.playbackRate;
    audio.src = safe;
    audio.load();
    audio.addEventListener(
      'loadedmetadata',
      () => {
        if (Number.isFinite(positionSec) && positionSec > 0) audio.currentTime = positionSec;
        audio.playbackRate = rate;
        // Recovery only ever runs while the user's intent is "playing", so
        // there is no paused case to preserve here.
        audio.play()?.catch(() => {
          /* the OS may refuse while backgrounded; the next attempt retries */
        });
      },
      { once: true },
    );
  }

  function togglePlay(): void {
    if (!playing() || !audio.src) return;
    if (pbPaused()) {
      noteUserIntent(true);
      pbPlay();
    } else {
      noteUserIntent(false);
      pbPause();
    }
  }

  function seekRel(seconds: number): void {
    if (!playing()) return;
    const dur = pbDuration();
    if (!Number.isFinite(dur) || !dur) return;
    pbSeekTo(Math.max(0, Math.min(pbCurrent() + seconds, dur)));
  }

  function prev(): void {
    const p = playing();
    if (p && p.index > 0) playAt(p, p.index - 1, !pbPaused());
  }
  function next(): void {
    const p = playing();
    if (p && p.index < p.episodes.length - 1) playAt(p, p.index + 1, !pbPaused());
  }

  // ── sort & filter ────────────────────────────────────────────────
  function toggleSort(): void {
    const s = session();
    patch({
      sortAsc: !s.sortAsc,
      episodes: s.episodes.slice().reverse(),
      filtered: s.filtered.slice().reverse(),
    });
    markPlayingRow();
  }

  function setFilter(q: string): void {
    const s = session();
    const query = q.trim().toLowerCase();
    const filtered = query
      ? s.episodes.filter((e) => (e.trackName || '').toLowerCase().includes(query))
      : s.episodes.slice();
    patch({ filter: q, filtered });
    markPlayingRow();
  }

  // ── queue ────────────────────────────────────────────────────────
  function toggleQueued(idx: number): void {
    const s = session();
    const ep = s.filtered[idx];
    if (!ep || !s.meta) return;
    const ref = { feedId: s.meta.id, trackId: String(ep.trackId) };
    if (queuePosition(ref)) {
      removeFromQueue(ref);
    } else {
      const item: QueueItem = {
        ...ref,
        title: ep.trackName || t('ep_fallback', idx + 1),
        feedName: s.meta.name || '',
      };
      enqueue(item);
      toast(t('queued'));
    }
    bump();
  }

  /**
   * Play a queued episode, which may belong to a feed that is neither playing
   * nor on screen: the playing session is rebuilt from the cached feed, or from
   * the network when it was never cached.
   */
  async function playQueueItem(item: QueueItem): Promise<void> {
    const fromList = (meta: FeedMeta, episodes: Episode[]): boolean => {
      const index = episodes.findIndex((e) => String(e.trackId) === item.trackId);
      if (index < 0) return false;
      start({ feedId: meta.id, meta, episodes, index, trackId: item.trackId }, true);
      return true;
    };

    const p = playing();
    if (p && p.feedId === item.feedId && fromList(p.meta, p.episodes)) return;
    const s = session();
    if (s.meta && s.meta.id === item.feedId && fromList(s.meta, s.filtered)) return;

    const sortAsc = settings().defaultSort === 'asc';

    const cached = await getCachedFeed(item.feedId);
    if (cached && fromList(cached.feed.meta, sortEpisodes(cached.feed.episodes, sortAsc))) {
      return;
    }

    const req = requestFromFeedId(item.feedId);
    if (!req) return;
    try {
      const resolved = await resolveFeed(req, {});
      void putCachedFeed(resolved);
      if (fromList(resolved.meta, sortEpisodes(resolved.episodes, sortAsc))) return;
    } catch {
      /* reported below */
    }
    toast(t('ep_not_found'), 'error');
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

    const outcome = await downloadOffline(ep, s.meta?.id ?? '');
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
    if (outcome === 'no-space') {
      // A browser file download would hit the same limit — say so instead.
      toast(t('dl_no_space'), 'error');
      bump();
      return;
    }
    // CORS-blocked CDN etc. → hand the URL to the browser instead.
    const fb = downloadEpisode(ep);
    toast(fb === 'opened' ? t('dl_opened_tab') : t('dl_not_found'), fb === 'opened' ? 'info' : 'error');
    bump();
  }

  function resumeLastPlayed(): void {
    resumeOnPaint = true;
    // Already on the feed (openFeed short-circuits), so act on what is painted.
    const s = session();
    if (s.meta && s.filtered.length && !playing()) {
      resumeOnPaint = false;
      const lastId = getLastPlayed(s.meta.id);
      const idx = lastId ? s.filtered.findIndex((e) => String(e.trackId) === lastId) : -1;
      if (idx >= 0) playEpisode(idx, false);
    }
  }

  function retry(): void {
    const req = session().req;
    if (req) openFeed(req);
  }

  function reset(): void {
    playAbort?.abort();
    noteUserIntent(false);
    audio.pause();
    if (currentBlobUrl) {
      audio.removeAttribute('src');
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }
    playing.set(null);
    setPlaybackState('none');
    document.body.classList.remove('is-playing');
    markPlayingRow();
  }

  // ── recovery watchdog ────────────────────────────────────────────
  // Re-mints the proxied URL and continues from the same second when a range
  // request dies mid-episode — the failure mode that ends backgrounded
  // playback. RSS enclosures get the same treatment with their original URL,
  // which is enough for a CDN blip.
  // Same `resumeAudioAt` seam as recovery: the handoff to a completed local
  // copy is exactly a source swap that must not disturb anything else.
  initPrefetch({
    handoff: resumeAudioAt,
    currentTrackId: () => playing()?.trackId ?? null,
    currentPosition: () => audio.currentTime,
  });

  initRecovery({
    reresolve: async () => {
      const p = playing();
      if (!p) return null;
      const ep = p.episodes[p.index];
      if (!ep) return null;
      const local = await offlineAudioUrl(p.trackId);
      if (local) return local; // a download landed meanwhile — best possible answer
      return httpsOnly(ep.episodeUrl || '') || null;
    },
    resume: resumeAudioAt,
    onGiveUp: () => {
      patch({ status: { kind: 'error', message: t('audio_err') } });
      setPlaybackState('paused');
      document.body.classList.remove('is-playing');
    },
  });

  // ── engine wiring ────────────────────────────────────────────────
  onEngine((e) => {
    switch (e.type) {
      case 'play':
        document.body.classList.add('is-playing');
        setPlaybackState('playing');
        break;
      case 'pause':
        document.body.classList.remove('is-playing');
        setPlaybackState('paused');
        break;
      case 'ended': {
        // "Sleep at end of episode" must win over both the queue and auto-next.
        if (consumeSleepAtEpisodeEnd()) break;
        const p = playing();
        if (!p) break;
        // Queue wins over plain list order, and may point at another feed.
        const nextQueued = dequeueNext({ feedId: p.feedId, trackId: p.trackId });
        if (nextQueued) {
          void playQueueItem(nextQueued);
          break;
        }
        if (settings().autoNext && p.index < p.episodes.length - 1) {
          playAt(p, p.index + 1, true);
        }
        break;
      }
      case 'timeupdate': {
        const p = playing();
        if (p && e.current > RESUME_FLOOR_SEC) setProgress(p.trackId, e.current);
        // The real rate, not the stored preference: a speed change applied to
        // the element must move the lock-screen bar with it.
        setMediaPosition(e.current, e.duration, audio.playbackRate);
        break;
      }
      case 'error':
        // Deliberately quiet: the recovery watchdog gets the same event and is
        // already re-resolving. Only `onGiveUp` below surfaces a failure, so a
        // survivable hiccup no longer paints a dead player.
        setPlaybackState('paused');
        document.body.classList.remove('is-playing');
        break;
    }
  });
  // ── global keyboard shortcuts ─────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return; // scrubber/rows already handled this key
    const target = e.target as HTMLElement;
    const tag = (target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea' || target.isContentEditable) return;
    // Space must activate a focused button (e.g. #npClose), not toggle playback.
    if (e.key === ' ' && target.closest('button, [role="button"], a')) return;
    // Transport keys follow what is PLAYING, so they keep working on Home,
    // Search and Library — they used to require the feed view to be open.
    if (!playing()) return;
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
    if (s.status.kind === 'ok') patch({ status: okStatus(s.episodes.length, s.limited, s.total) });
    else if (s.status.kind === 'loading') patch({ status: { kind: 'loading', message: t('status_loading') } });
  });

  // Settings change → re-emit so lists pick up showDl / row metrics.
  settings.subscribe(() => {
    if (session().episodes.length) bump();
  });

  return {
    session,
    playing,
    openFeed,
    resumeLastPlayed,
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
    reset,
  };
}
