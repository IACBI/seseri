import type { Episode, FeedRequest, ResolvedFeed } from './types';
import { applyEpisodeRemap, buildEpisodeRemap } from './archive';
import { lookupPodcast } from './itunes';
import { fetchParsedFeed, fetchTextProxied } from './proxy-chain';
import { parseRss } from './rss-parser';

export interface ResolveOptions {
  signal?: AbortSignal;
  /**
   * False skips reading the feed of a complete Apple listing just for the
   * show's description and type. The background sweep wants new episodes
   * only, and would otherwise fetch every such subscription's feed each pass.
   */
  showExtras?: boolean;
}

/** Episodes and channel metadata from a feed URL, however we can get them. */
interface FeedContents {
  name: string;
  artist: string;
  art: string;
  episodes: Episode[];
  /** True when the list arrived without show notes (see episode-notes.ts). */
  notesDeferred: boolean;
  /** Episodes the feed contains; more than `episodes.length` when partial. */
  total: number;
  about?: string;
  serial?: boolean;
}

/** The show-level extras, checked: the Worker's JSON is input like any other. */
function showExtras(about: unknown, serial: unknown): Pick<FeedContents, 'about' | 'serial'> {
  return {
    ...(typeof about === 'string' && about ? { about } : {}),
    ...(serial === true ? { serial: true } : {}),
  };
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
    const { name, artist, art, about, serial } = parsedByWorker.meta;
    return {
      name,
      artist,
      art,
      ...showExtras(about, serial),
      episodes: parsedByWorker.episodes,
      notesDeferred: true,
      total: Math.max(parsedByWorker.total, parsedByWorker.episodes.length),
    };
  }
  const xml = await fetchTextProxied(url, opts.signal);
  const parsed = parseRss(xml);
  return {
    name: parsed.title,
    artist: parsed.author,
    art: parsed.art,
    ...showExtras(parsed.about, parsed.serial),
    episodes: parsed.episodes,
    notesDeferred: false,
    total: parsed.episodes.length,
  };
}

/**
 * How long a complete Apple listing waits for its feed. The feed is read only
 * for the show's description and type there, so a slow host must not hold the
 * page: past this the show opens without them, as it did before.
 */
const EXTRAS_DEADLINE_MS = 4000;

/**
 * The show's own feed, or null when it cannot be read.
 *
 * Everything here is best-effort on purpose: a feed host that is down, a feed
 * that no longer parses, or public proxies the user has not opted into must
 * leave the listener with Apple's list rather than with an error. An abort is
 * the user moving on and propagates; running out of `deadlineMs` does not.
 */
async function readArchive(
  feedUrl: string,
  opts: ResolveOptions,
  deadlineMs?: number,
): Promise<FeedContents | null> {
  if (deadlineMs === undefined) {
    try {
      return await loadFeedUrl(feedUrl, opts);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      return null;
    }
  }
  const ctrl = new AbortController();
  const forward = (): void => ctrl.abort();
  opts.signal?.addEventListener('abort', forward, { once: true });
  const timer = setTimeout(() => ctrl.abort(), deadlineMs);
  try {
    return await loadFeedUrl(feedUrl, { signal: ctrl.signal });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    return null;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', forward);
  }
}

/**
 * Replace a truncated Apple listing with the show's own archive, when the
 * archive is longer. The only outcome that changes the list is a longer
 * archive we could actually read.
 */
async function withFullArchive(
  apple: { meta: ResolvedFeed['meta']; episodes: Episode[]; total: number },
  archive: FeedContents,
): Promise<ResolvedFeed | null> {
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
      ...(apple.meta.feedUrl ? { feedUrl: apple.meta.feedUrl } : {}),
    },
    episodes: archive.episodes,
    // A slice only if even the feed's own archive could not be read whole.
    limited: archive.total > archive.episodes.length,
    total: archive.total,
    ...(archive.notesDeferred ? { notesDeferred: true } : {}),
    ...showExtras(archive.about, archive.serial),
  };
}

/** One entry point for every feed source. */
export async function resolveFeed(req: FeedRequest, opts: ResolveOptions): Promise<ResolvedFeed> {
  switch (req.kind) {
    case 'itunes': {
      const { meta, episodes, limited, total, feedUrl } = await lookupPodcast(req.id, opts.signal);
      const apple: ResolvedFeed = { meta, episodes, limited, ...(total ? { total } : {}) };
      if (!feedUrl || (!limited && opts.showExtras === false)) return apple;
      // Apple's listing carries neither the show's description nor whether it
      // is a serial, and "by podcast" ordering needs the latter, so the feed is
      // read even when Apple's list is complete — on a deadline then, since
      // the list itself does not depend on it.
      const archive = await readArchive(feedUrl, opts, limited ? undefined : EXTRAS_DEADLINE_MS);
      if (!archive) return apple;
      if (limited) {
        const full = await withFullArchive({ meta, episodes, total }, archive);
        if (full) return full;
      }
      return { ...apple, ...showExtras(archive.about, archive.serial) };
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
        limited: contents.total > contents.episodes.length,
        ...(contents.total > contents.episodes.length ? { total: contents.total } : {}),
        ...(contents.notesDeferred ? { notesDeferred: true } : {}),
        ...showExtras(contents.about, contents.serial),
      };
    }
  }
}
