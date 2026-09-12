import type { Episode, FeedMeta, SearchResult } from './types';
import { httpsOnly } from '../lib/safe';
import { itunesFetch } from './proxy-chain';
import { settings } from '../state/settings';
import type { LangCode } from '../i18n/types';

/**
 * Apple's catalogue is per-storefront: results, titles and availability all
 * differ. `country=tr` used to be hardcoded, so a German or Japanese user
 * searched the Turkish store and simply could not find shows listed elsewhere.
 * Derived from the UI language, which is the only region signal the app has
 * (it asks for no location and stores no account).
 */
const LANG_STOREFRONT: Record<LangCode, string> = {
  tr: 'tr',
  en: 'us',
  de: 'de',
  fr: 'fr',
  es: 'es',
  ar: 'sa',
  ja: 'jp',
  ru: 'ru',
};

/** Exported: the chart endpoint is per-storefront too (see feeds/charts.ts). */
export function storefront(): string {
  return LANG_STOREFRONT[settings().lang] ?? 'us';
}

interface ItunesLookupRow {
  wrapperType?: string;
  kind?: string;
  collectionId?: number;
  collectionName?: string;
  trackName?: string;
  artistName?: string;
  artworkUrl100?: string;
  /** Also returned for podcasts, and a safer base than the 100px thumbnail. */
  artworkUrl600?: string;
  trackCount?: number;
  trackId?: number;
  releaseDate?: string;
  episodeUrl?: string;
  previewUrl?: string;
  trackTimeMillis?: number;
  /** Episode show notes. Present on podcastEpisode rows; HTML, untrusted. */
  description?: string;
  shortDescription?: string;
  /** The show's own RSS feed — where the episodes Apple withheld live. */
  feedUrl?: string;
}

interface ItunesResponse {
  results?: ItunesLookupRow[];
}

export async function searchPodcasts(term: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const data = await itunesFetch<ItunesResponse>(
    `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=podcast&limit=8&country=${storefront()}`,
    signal,
  );
  if (!data.results) return [];
  return data.results.map((p) => ({
    collectionId: p.collectionId ?? 0,
    collectionName: p.collectionName ?? '—',
    artistName: p.artistName ?? '',
    artworkUrl100: p.artworkUrl100 ?? '',
    ...(p.trackCount !== undefined ? { trackCount: p.trackCount } : {}),
  }));
}

export interface ItunesFeed {
  meta: FeedMeta;
  episodes: Episode[];
  /** True when Apple reports more episodes than it handed back. */
  limited: boolean;
  /** Apple's own episode count for the show (0 when absent). */
  total: number;
  /**
   * The show's own RSS feed, from the collection row. `resolve.ts` goes here
   * for the rest of the archive when `limited` is true — see feeds/archive.ts.
   */
  feedUrl: string;
}

/**
 * Ceiling we ask for. It is NOT what actually bounds the result: Apple returns
 * its own, much smaller slice regardless — measured 2026-07-30, The Daily
 * reports `trackCount` 2676 and returns 41 episodes; Radiolab reports 859 and
 * returns 200. So truncation is detected by comparing against `trackCount`
 * rather than against this number.
 *
 * The rest of the archive is fetched from the collection row's `feedUrl`, and
 * the episode ids that changes are migrated across every store that keys on
 * them — see feeds/archive.ts. That used to be an open question here; the two
 * things that made it one (re-keying saved positions, and pulling a
 * multi-megabyte feed onto the device) are answered by the migration and by
 * the Worker's `/v1/parse` respectively.
 */
const LOOKUP_LIMIT = 300;

export async function lookupPodcast(id: string, signal?: AbortSignal): Promise<ItunesFeed> {
  const data = await itunesFetch<ItunesResponse>(
    `https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=podcastEpisode&limit=${LOOKUP_LIMIT}&country=${storefront()}`,
    signal,
  );
  if (!data.results || !Array.isArray(data.results)) throw new Error('invalid api response');

  const metaRow = data.results.find((r) => r.wrapperType === 'collection' || r.kind === 'podcast');
  const meta: FeedMeta = {
    id: String(id),
    name: metaRow?.collectionName || metaRow?.trackName || '',
    artist: metaRow?.artistName || '',
    // Prefer the 600px rendition: `artAt()` upgrades either one at render time,
    // but starting from 600 keeps the artwork usable if Apple ever changes the
    // URL scheme the rewrite depends on.
    art: metaRow?.artworkUrl600 || metaRow?.artworkUrl100 || '',
  };

  const episodes: Episode[] = data.results
    .filter((r) => r.wrapperType === 'podcastEpisode' || r.kind === 'podcast-episode')
    .map((r) => {
      // The lookup response carries notes; nothing read them, so the Now
      // Playing sheet's "episode notes" was permanently empty for every
      // podcast opened through Apple rather than a direct RSS URL.
      const description = r.description || r.shortDescription || '';
      return {
        trackId: String(r.trackId ?? r.episodeUrl ?? ''),
        trackName: r.trackName ?? '',
        releaseDate: r.releaseDate ?? '',
        episodeUrl: r.episodeUrl || r.previewUrl || '',
        trackTimeMillis: r.trackTimeMillis ?? 0,
        ...(description ? { description } : {}),
      };
    });

  // `trackCount` is the show's real episode count, and it is routinely far
  // larger than the list Apple returns with it.
  const total = metaRow?.trackCount ?? 0;
  return {
    meta,
    episodes,
    limited: total > episodes.length,
    total,
    feedUrl: httpsOnly(metaRow?.feedUrl ?? ''),
  };
}
