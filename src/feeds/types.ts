/** Where a feed's data comes from. Drives which resolver handles it. */
export type FeedSource = 'itunes' | 'rss';

/**
 * A single playable item. Field names intentionally match the legacy app
 * (iTunes API naming) so persisted data (`pp_prog`, `pp_last_*`) stays valid.
 */
export interface Episode {
  /** Stable id: RSS guid, iTunes trackId, or enclosure URL. */
  trackId: string;
  trackName: string;
  /** Date string (ISO or RSS pubDate); '' when unknown. */
  releaseDate: string;
  /** Direct audio URL. */
  episodeUrl: string;
  /** Duration in ms; 0 when unknown. */
  trackTimeMillis: number;
  /** Per-episode artwork: RSS `<itunes:image>`. */
  art?: string;
  /**
   * Raw show-notes markup from the feed — untrusted. Never render this; run it
   * through `parseShowNotes` (feeds/show-notes.ts), which yields text and
   * https-only links. Optional so older cached feeds stay valid.
   */
  description?: string;
  /** `<itunes:season>` / `<itunes:episode>` when the feed numbers its items. */
  season?: number;
  episode?: number;
  /**
   * `<podcast:chapters url>` — a JSON chapter list, https only. Fetched lazily
   * (see player/chapters.ts); the feed only tells us where it is.
   */
  chaptersUrl?: string;
  /** `<podcast:transcript>` alternatives in feed order, https only. */
  transcripts?: EpisodeTranscript[];
}

/** One `<podcast:transcript>` alternative. */
export interface EpisodeTranscript {
  url: string;
  /** MIME type as the feed declares it: `text/vtt`, `application/srt`, … */
  type: string;
  language?: string;
}

/**
 * Feed-level metadata. Same shape as the legacy `currentMeta` / `pp_favs`
 * entries so existing subscriptions keep working without migration.
 */
export interface FeedMeta {
  /** `<itunesId>` | `rss:<url>` */
  id: string;
  name: string;
  artist: string;
  art: string;
}

export type Subscription = FeedMeta;

/** What to load — parsed from user input or a deep link. */
export type FeedRequest = { kind: 'itunes'; id: string } | { kind: 'rss'; url: string };

/** A fully resolved feed ready for the player screen. */
export interface ResolvedFeed {
  meta: FeedMeta;
  episodes: Episode[];
  /** True when the list is only part of the show's archive. */
  limited: boolean;
  /**
   * Episodes the source says exist in total, when it says. Apple reports one
   * (`trackCount`) that is routinely far larger than the list it returns, so
   * the UI can say "41 of 2676" instead of implying the show has 41.
   */
  total?: number;
  /**
   * True when the episodes arrived without their show notes, because the
   * Worker was asked for a list rather than the whole archive. An episode's
   * notes are then fetched when something actually renders them —
   * `feeds/episode-notes.ts` — rather than for all 3000 of them up front.
   */
  notesDeferred?: boolean;
}

/** Result row from iTunes search. */
export interface SearchResult {
  collectionId: number;
  collectionName: string;
  artistName: string;
  artworkUrl100: string;
  trackCount?: number;
}
