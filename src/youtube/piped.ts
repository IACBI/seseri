import type { YouTubeRef } from '../feeds/types';
import { API_BASE, fetchWithTimeout, svcFirst, svcJson } from '../feeds/proxy-chain';

/**
 * Public Piped / Invidious instances. Preferred path: a real audio stream →
 * the <audio> element (ad-free, background, downloadable). These public
 * servers are frequently rate-limited or down, so several are raced and the
 * whole thing falls back to the official embed if none work.
 * The Worker (P4) proxies a health-checked list and is tried first.
 */
export const PIPED_APIS = [
  'https://pipedapi.kavin.rocks',
  'https://api.piped.private.coffee',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.reallyaweso.me',
  'https://pipedapi.r4fo.com',
  'https://piapi.ggtyler.dev',
] as const;

export const INV_APIS = [
  'https://invidious.nerdvpn.de',
  'https://inv.nadeko.net',
  'https://invidious.jing.rocks',
  'https://invidious.f5.si',
  'https://yewtu.be',
] as const;

export interface YtItem {
  videoId: string;
  title: string;
  /** ISO date string; '' unknown. */
  published: string;
  durationSec: number;
  thumb: string;
}

export interface YtListing {
  title: string;
  author: string;
  items: YtItem[];
}

export function ytIdFrom(s: string): string {
  const m = String(s || '').match(/[\w-]{11}/);
  return m ? m[0] : '';
}

interface PipedStreamRow {
  url?: string;
  title?: string;
  uploaded?: number;
  duration?: number;
  thumbnail?: string;
}
interface PipedListResponse {
  name?: string;
  uploader?: string;
  relatedStreams?: PipedStreamRow[];
  nextpage?: string;
}

/** List a playlist/channel via Piped (full list + dates + durations), paginated. */
export async function pipedList(info: YouTubeRef, signal?: AbortSignal): Promise<YtListing> {
  const path = (info.type === 'playlist' ? '/playlists/' : '/channel/') + encodeURIComponent(info.id);
  const { base, json } = await svcFirst<PipedListResponse>(
    PIPED_APIS,
    path,
    signal,
    (j) => Array.isArray(j.relatedStreams) && j.relatedStreams.length > 0,
  );
  let streams = (json.relatedStreams ?? []).slice();
  let next = json.nextpage;
  let pages = 1;
  const npBase =
    (info.type === 'playlist' ? '/nextpage/playlists/' : '/nextpage/channel/') +
    encodeURIComponent(info.id);
  while (next && pages < 6 && streams.length < 500) {
    try {
      const np = await svcJson<PipedListResponse>(
        base + npBase + '?nextpage=' + encodeURIComponent(next),
        signal,
      );
      if (!np.relatedStreams || !np.relatedStreams.length) break;
      streams = streams.concat(np.relatedStreams);
      next = np.nextpage;
      pages++;
    } catch {
      break;
    }
  }
  return {
    title: json.name || json.uploader || 'YouTube',
    author: json.uploader || '',
    items: streams
      .map((s) => ({
        videoId: ytIdFrom(s.url ?? ''),
        title: s.title || '',
        published: s.uploaded && s.uploaded > 0 ? new Date(s.uploaded).toISOString() : '',
        durationSec: s.duration || 0,
        thumb: s.thumbnail || '',
      }))
      .filter((x) => x.videoId),
  };
}

interface InvVideoRow {
  videoId?: string;
  title?: string;
  published?: number;
  lengthSeconds?: number;
  videoThumbnails?: Array<{ url?: string }>;
}
interface InvListResponse {
  title?: string;
  author?: string;
  videos?: InvVideoRow[];
}

/** List via Invidious (list-only fallback — its stream URLs aren't browser-playable). */
export async function invList(info: YouTubeRef, signal?: AbortSignal): Promise<YtListing> {
  const path =
    info.type === 'playlist'
      ? '/api/v1/playlists/' + encodeURIComponent(info.id) + '?fields=title,author,videos'
      : '/api/v1/channels/' + encodeURIComponent(info.id) + '/videos';
  const { json } = await svcFirst<InvListResponse>(
    INV_APIS,
    path,
    signal,
    (j) => Array.isArray(j.videos) && j.videos.length > 0,
  );
  return {
    title: json.title || 'YouTube',
    author: json.author || '',
    items: (json.videos ?? [])
      .map((v) => ({
        videoId: v.videoId ?? '',
        title: v.title || '',
        published: v.published ? new Date(v.published * 1000).toISOString() : '',
        durationSec: v.lengthSeconds || 0,
        thumb: v.videoThumbnails?.[0]?.url || '',
      }))
      .filter((x) => x.videoId),
  };
}

/** Full episode list via the services (Worker → Piped → Invidious). null on failure. */
export async function ytServiceList(
  info: YouTubeRef,
  signal?: AbortSignal,
): Promise<YtListing | null> {
  if (API_BASE) {
    try {
      const res = await fetchWithTimeout(
        `${API_BASE}/v1/yt/list?type=${info.type}&id=${encodeURIComponent(info.id)}`,
        signal,
        12000,
      );
      if (res.ok) {
        const j = (await res.json()) as YtListing;
        if (Array.isArray(j.items) && j.items.length) return j;
      }
    } catch (e) {
      if (signal?.aborted) throw e;
    }
  }
  try {
    const r = await pipedList(info, signal);
    if (r.items.length) return r;
  } catch (e) {
    if (signal?.aborted) throw e;
  }
  try {
    const r = await invList(info, signal);
    if (r.items.length) return r;
  } catch (e) {
    if (signal?.aborted) throw e;
  }
  return null;
}

interface PipedStreamsResponse {
  audioStreams?: Array<{ url?: string; bitrate?: number }>;
}

/**
 * Resolve a browser-playable audio stream URL (highest bitrate) for a video.
 * Worker first, then public Piped. Returns null if nothing serves it.
 */
export async function ytServiceAudioUrl(
  videoId: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (API_BASE) {
    try {
      const res = await fetchWithTimeout(
        `${API_BASE}/v1/yt/resolve?id=${encodeURIComponent(videoId)}`,
        signal,
        12000,
      );
      if (res.ok) {
        const j = (await res.json()) as { audioUrl?: string };
        if (j.audioUrl) return j.audioUrl;
      }
    } catch (e) {
      if (signal?.aborted) throw e;
    }
  }
  try {
    const { json } = await svcFirst<PipedStreamsResponse>(
      PIPED_APIS,
      '/streams/' + encodeURIComponent(videoId),
      signal,
      (j) => Array.isArray(j.audioStreams) && j.audioStreams.length > 0,
    );
    const a = (json.audioStreams ?? []).slice().sort((x, y) => (y.bitrate || 0) - (x.bitrate || 0));
    return a[0]?.url || null;
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  }
}
