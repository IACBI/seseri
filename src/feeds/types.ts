/** Where a feed's data comes from. Drives which resolver handles it. */
export type FeedSource = 'itunes' | 'rss' | 'youtube';

/** A single playable item in a feed. */
export interface Episode {
  /** Stable id: RSS guid, YouTube video id, or enclosure URL as fallback. */
  id: string;
  title: string;
  /** Direct audio URL. Empty when only an embed fallback exists (YouTube). */
  audioUrl: string;
  /** Publication date, ms epoch. 0 when unknown. */
  publishedAt: number;
  /** Duration in seconds. 0 when unknown. */
  duration: number;
  description?: string;
  artworkUrl?: string;
  /** YouTube-only: video id for the iframe embed fallback. */
  ytVideoId?: string;
}

/** A resolved feed: podcast, raw RSS feed, or YouTube playlist/channel. */
export interface Podcast {
  /** Stable id: `itunes:<id>`, `rss:<url>`, or `yt:<token>`. */
  id: string;
  source: FeedSource;
  title: string;
  author?: string;
  artworkUrl?: string;
  feedUrl?: string;
  episodes: Episode[];
}

/** A saved subscription (favorites list on the home screen). */
export interface Subscription {
  id: string;
  source: FeedSource;
  title: string;
  author?: string;
  artworkUrl?: string;
  /** What to re-open when tapped: itunes id, rss url, or yt token. */
  openToken: string;
  addedAt: number;
}

/** Result row from iTunes search. */
export interface SearchResult {
  itunesId: number;
  title: string;
  author: string;
  artworkUrl: string;
  feedUrl?: string;
  episodeCount?: number;
}

export type ThemeName = 'auto' | 'dark' | 'light' | 'oled';
export type SortOrder = 'newest' | 'oldest';

export interface Settings {
  speed: number;
  skipBack: number;
  skipFwd: number;
  autoNext: boolean;
  resume: boolean;
  accent: string;
  fontSize: number;
  rowHeight: number;
  theme: ThemeName;
  sort: SortOrder;
  showDownload: boolean;
  lang: string;
}

export interface PlaybackProgress {
  episodeId: string;
  positionSec: number;
  updatedAt: number;
}
