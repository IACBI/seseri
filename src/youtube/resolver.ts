import type { Episode, ResolvedFeed, YouTubeRef } from '../feeds/types';
import { ytToToken } from '../feeds/input-parse';
import { fetchYtFeed } from './atom';
import { ytServiceList, type YtItem } from './piped';

/**
 * Injected by the embed module: enumerate a full playlist's video ids via the
 * IFrame player (no key needed). Optional — resolver degrades without it.
 */
export type PlaylistIdsFn = (playlistId: string, signal?: AbortSignal) => Promise<string[]>;

function thumbOf(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function epFromItem(it: YtItem): Episode {
  return {
    trackId: it.videoId,
    trackName: it.title,
    releaseDate: it.published,
    episodeUrl: '',
    trackTimeMillis: (it.durationSec || 0) * 1000,
    ytId: it.videoId,
    art: it.thumb || thumbOf(it.videoId),
  };
}

/**
 * Resolve a YouTube playlist/channel/video into a feed.
 * Preferred: full list via Worker/Piped/Invidious. Fallback: keyless Atom
 * feed (latest ~15) + optional player playlist enumeration.
 * `placeholderTitle` fills the single-video pseudo-feed name (localized).
 */
export async function resolveYouTube(
  info: YouTubeRef,
  signal: AbortSignal | undefined,
  opts: { placeholderTitle: string; playlistIds?: PlaylistIdsFn },
): Promise<ResolvedFeed> {
  let eps: Episode[] = [];
  let title = 'YouTube';
  let author = '';
  let limited = false;

  if (info.type === 'video') {
    title = opts.placeholderTitle;
    eps = [
      {
        trackId: info.id,
        trackName: '', // filled from player data / noembed later
        releaseDate: '',
        episodeUrl: '',
        trackTimeMillis: 0,
        ytId: info.id,
        art: thumbOf(info.id),
      },
    ];
  } else {
    let svc = null;
    try {
      svc = await ytServiceList(info, signal);
    } catch (e) {
      if (signal?.aborted) throw e;
      svc = null;
    }

    if (svc && svc.items.length) {
      title = svc.title || 'YouTube';
      author = svc.author || '';
      eps = svc.items.map(epFromItem);
    } else {
      const feedUrl =
        'https://www.youtube.com/feeds/videos.xml?' +
        (info.type === 'playlist' ? 'playlist_id=' : 'channel_id=') +
        encodeURIComponent(info.id);
      const parsed = await fetchYtFeed(feedUrl, signal);
      title = parsed.title || 'YouTube';
      author = parsed.author || '';
      const metaById = new Map(parsed.items.map((it) => [it.videoId, it]));
      const feedNewestId = parsed.items[0]?.videoId;

      let fullIds: string[] | null = null;
      if (info.type === 'playlist' && opts.playlistIds) {
        try {
          fullIds = await opts.playlistIds(info.id, signal);
        } catch (e) {
          if (signal?.aborted) throw e;
          fullIds = null;
        }
      }

      const mk = (id: string): Episode => {
        const it = metaById.get(id);
        return {
          trackId: id,
          trackName: it?.title ?? '',
          releaseDate: it?.published ?? '',
          episodeUrl: '',
          trackTimeMillis: 0,
          ytId: id,
          art: it?.thumb || thumbOf(id),
        };
      };
      if (fullIds && fullIds.length > parsed.items.length) {
        const newestFirst = fullIds.slice();
        if (!(feedNewestId && fullIds[0] === feedNewestId)) newestFirst.reverse();
        eps = newestFirst.map(mk);
      } else {
        limited = true;
        eps = parsed.items.map((it) => mk(it.videoId));
      }
    }
  }

  if (!eps.length) throw new Error('no episodes');

  const art = eps[0]?.art ?? '';
  return {
    meta: {
      id: 'yt:' + info.type + ':' + info.id,
      name: title,
      artist: author,
      art,
      kind: 'yt',
      yt: ytToToken(info),
    },
    episodes: eps,
    limited,
  };
}
