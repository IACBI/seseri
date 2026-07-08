import type { FeedRequest, ResolvedFeed } from './types';
import { lookupPodcast } from './itunes';
import { fetchTextProxied } from './proxy-chain';
import { parseRss } from './rss-parser';
import { resolveYouTube, type PlaylistIdsFn } from '../youtube/resolver';

export interface ResolveOptions {
  signal?: AbortSignal;
  /** Localized placeholder for a single-video pseudo-feed. */
  ytVideoTitle: string;
  /** IFrame playlist enumeration (injected from the embed module). */
  playlistIds?: PlaylistIdsFn;
}

/**
 * One entry point for every feed source — replaces the legacy trio of
 * loadPodcast / loadRss / loadYouTube data paths.
 */
export async function resolveFeed(req: FeedRequest, opts: ResolveOptions): Promise<ResolvedFeed> {
  switch (req.kind) {
    case 'itunes': {
      const { meta, episodes } = await lookupPodcast(req.id, opts.signal);
      return { meta, episodes, limited: false };
    }
    case 'rss': {
      const feedId = 'rss:' + req.url;
      const xml = await fetchTextProxied(req.url, opts.signal);
      const parsed = parseRss(xml);
      return {
        meta: { id: feedId, name: parsed.title, artist: parsed.author, art: parsed.art },
        episodes: parsed.episodes,
        limited: false,
      };
    }
    case 'yt': {
      const resolveOpts: Parameters<typeof resolveYouTube>[2] = {
        placeholderTitle: opts.ytVideoTitle,
        ...(opts.playlistIds ? { playlistIds: opts.playlistIds } : {}),
      };
      return resolveYouTube(req.info, opts.signal, resolveOpts);
    }
  }
}
