import type { Episode, FeedRequest, ResolvedFeed } from './types';
import { applyEpisodeRemap, buildEpisodeRemap } from './archive';
import { lookupPodcast } from './itunes';
import { fetchParsedFeed, fetchTextProxied } from './proxy-chain';
import { parseRss } from './rss-parser';

export interface ResolveOptions {
  signal?: AbortSignal;
}

/** Episodes and channel metadata from a feed URL, however we can get them. */
interface FeedContents {
  name: string;
  artist: string;
  art: string;
  episodes: Episode[];
  /** True when the list arrived without show notes (see episode-notes.ts). */
  notesDeferred: boolean;
}

/**
 * Fetch and parse a feed URL.
 *
 * Preferred route is the Worker's `/v1/parse`: it parses at the edge and sends
 * compact JSON, so an archive that is tens of megabytes of XML never reaches
 * the device and no DOM is built here. `fetchParsedFeed` answers null — rather
 * than throwing — whenever that route cannot serve (no Worker configured, one
 * that is down, or one deployed before `/v1/parse` existed), and the raw XML
 * path below is the one the app has always had.
 */
async function loadFeedUrl(url: string, opts: ResolveOptions): Promise<FeedContents> {
  const parsedByWorker = await fetchParsedFeed(url, opts.signal);
  if (parsedByWorker) {
    return { ...parsedByWorker.meta, episodes: parsedByWorker.episodes, notesDeferred: true };
  }
  const xml = await fetchTextProxied(url, opts.signal);
  const parsed = parseRss(xml);
  return {
    name: parsed.title,
    artist: parsed.author,
    art: parsed.art,
    episodes: parsed.episodes,
    notesDeferred: false,
  };
}

/**
 * Replace a truncated Apple listing with the show's own archive.
 *
 * Everything here is best-effort on purpose: a feed host that is down, a feed
 * that no longer parses, or public proxies the user has not opted into must
 * leave the listener with the short list rather than with an error. The only
 * outcome that changes anything is a longer archive we could actually read.
 */
async function withFullArchive(
  apple: { meta: ResolvedFeed['meta']; episodes: Episode[]; total: number },
  feedUrl: string,
  opts: ResolveOptions,
): Promise<ResolvedFeed | null> {
  let archive: FeedContents;
  try {
    archive = await loadFeedUrl(feedUrl, opts);
  } catch (e) {
    // An abort is the user moving on and must propagate; anything else is just
    // a route that did not work.
    if ((e as Error).name === 'AbortError') throw e;
    return null;
  }
  if (archive.episodes.length <= apple.episodes.length) return null;

  // The same episode is a numeric `trackId` to Apple and a `<guid>` in the
  // feed, so every saved position, queued item and downloaded file has to move
  // with it. The feed keeps its Apple id, so subscriptions and the last-played
  // pointer keep working.
  const pairs = buildEpisodeRemap(apple.episodes, archive.episodes);
  if (pairs.length) await applyEpisodeRemap(apple.meta.id, pairs);

  return {
    // Apple's own name and artwork are better curated than most feeds'; the
    // feed only supplies what Apple did not.
    meta: {
      id: apple.meta.id,
      name: apple.meta.name || archive.name,
      artist: apple.meta.artist || archive.artist,
      art: apple.meta.art || archive.art,
    },
    episodes: archive.episodes,
    // No longer a slice of anything.
    limited: false,
    total: archive.episodes.length,
    ...(archive.notesDeferred ? { notesDeferred: true } : {}),
  };
}

/** One entry point for every feed source. */
export async function resolveFeed(req: FeedRequest, opts: ResolveOptions): Promise<ResolvedFeed> {
  switch (req.kind) {
    case 'itunes': {
      const { meta, episodes, limited, total, feedUrl } = await lookupPodcast(req.id, opts.signal);
      if (limited && feedUrl) {
        const full = await withFullArchive({ meta, episodes, total }, feedUrl, opts);
        if (full) return full;
      }
      return { meta, episodes, limited, ...(total ? { total } : {}) };
    }
    case 'rss': {
      const contents = await loadFeedUrl(req.url, opts);
      return {
        meta: {
          id: 'rss:' + req.url,
          name: contents.name,
          artist: contents.artist,
          art: contents.art,
        },
        episodes: contents.episodes,
        limited: false,
        ...(contents.notesDeferred ? { notesDeferred: true } : {}),
      };
    }
  }
}
