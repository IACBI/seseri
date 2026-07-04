/** Where a feed's data comes from. Drives which resolver handles it. */
export type FeedSource = 'itunes' | 'rss' | 'youtube';

/**
 * A single playable item. Field names intentionally match the legacy app
 * (iTunes API naming) so persisted data (`pp_prog`, `pp_last_*`) stays valid.
 */
export interface Episode {
  /** Stable id: RSS guid, YouTube video id, iTunes trackId, or enclosure URL. */
  trackId: string;
  trackName: string;
  /** Date string (ISO or RSS pubDate); '' when unknown. */
  releaseDate: string;
  /** Direct audio URL; '' when only the YouTube embed fallback exists. */
  episodeUrl: string;
  /** Duration in ms; 0 when unknown. */
  trackTimeMillis: number;
  /** YouTube-only: video id for Piped resolution / iframe fallback. */
  ytId?: string;
  /** Per-episode artwork (YouTube thumbnails). */
  art?: string;
}

/**
 * Feed-level metadata. Same shape as the legacy `currentMeta` / `pp_favs`
 * entries so existing subscriptions keep working without migration.
 */
export interface FeedMeta {
  /** `<itunesId>` | `rss:<url>` | `yt:<type>:<id>` */
  id: string;
  name: string;
  artist: string;
  art: string;
  /** 'yt' marks YouTube subscriptions (legacy flag). */
  kind?: 'yt';
  /** YouTube deep-link token (pl_/ch_/vid_ + id). */
  yt?: string;
}

export type Subscription = FeedMeta;

/** What to load — parsed from user input or a deep link. */
export type FeedRequest =
  | { kind: 'itunes'; id: string }
  | { kind: 'rss'; url: string }
  | { kind: 'yt'; info: YouTubeRef };

export interface YouTubeRef {
  type: 'playlist' | 'channel' | 'video';
  id: string;
}

/** A fully resolved feed ready for the player screen. */
export interface ResolvedFeed {
  meta: FeedMeta;
  episodes: Episode[];
  /** True when only the latest ~15 items could be listed (YT Atom fallback). */
  limited: boolean;
}

/** Result row from iTunes search. */
export interface SearchResult {
  collectionId: number;
  collectionName: string;
  artistName: string;
  artworkUrl100: string;
  trackCount?: number;
}
