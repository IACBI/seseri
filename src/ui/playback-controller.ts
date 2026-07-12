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

import type { Episode, FeedMeta, FeedRequest } from '../feeds/types';
import { signal, type Signal } from '../state/signals';

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
 * WP-0 skeleton — keeps the shell navigable until WP-D lands the real port.
 */
export function createPlaybackController(): PlaybackController {
  const session = signal<PlaybackSession>(emptySession());
  const noop = (): void => undefined;
  return {
    session,
    openFeed(req) {
      session.update((s) => ({ ...s, req, status: { kind: 'loading', message: '' } }));
    },
    retry: noop,
    playEpisode: noop,
    next: noop,
    prev: noop,
    togglePlay: noop,
    seekRel: noop,
    toggleSort: noop,
    setFilter: noop,
    toggleQueued: noop,
    downloadToggle: () => Promise.resolve(),
    episodeTitle: () => '',
    reset: () => session.set(emptySession()),
  };
}
