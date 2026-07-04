/**
 * YouTube listing/stream resolution via public Piped & Invidious instances
 * (plan option B): a cron health-checks the pool and stores the responsive
 * subset in KV; requests race the healthy instances server-side and return a
 * normalized shape the client already understands.
 */
import { fetchWithTimeout } from './safe-fetch';

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

const HEALTH_KEY = 'yt:healthy';
const UPSTREAM_TIMEOUT = 9000;

export interface YtItem {
  videoId: string;
  title: string;
  published: string;
  durationSec: number;
  thumb: string;
}
export interface YtListing {
  title: string;
  author: string;
  items: YtItem[];
}

interface HealthyPool {
  piped: string[];
  invidious: string[];
}

function ytIdFrom(s: string): string {
  const m = String(s || '').match(/[\w-]{11}/);
  return m ? m[0] : '';
}

async function json<T>(url: string): Promise<T> {
  const res = await fetchWithTimeout(url, UPSTREAM_TIMEOUT);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return (await res.json()) as T;
}

/** First upstream whose JSON passes `valid` wins. */
async function firstOf<T>(
  bases: readonly string[],
  path: string,
  valid: (j: T) => boolean,
): Promise<{ base: string; json: T }> {
  return await Promise.any(
    bases.map(async (base) => {
      const j = await json<T>(base + path);
      if (!valid(j)) throw new Error('invalid');
      return { base, json: j };
    }),
  );
}

export async function healthyPool(kv: KVNamespace): Promise<HealthyPool> {
  const stored = await kv.get<HealthyPool>(HEALTH_KEY, 'json').catch(() => null);
  if (stored && (stored.piped.length || stored.invidious.length)) return stored;
  return { piped: [...PIPED_APIS], invidious: [...INV_APIS] };
}

/** Cron body: probe every instance with a cheap request, persist responders. */
export async function refreshHealth(kv: KVNamespace): Promise<HealthyPool> {
  const probe = async (base: string, path: string): Promise<boolean> => {
    try {
      const res = await fetchWithTimeout(base + path, 6000);
      return res.ok;
    } catch {
      return false;
    }
  };
  const [piped, invidious] = await Promise.all([
    Promise.all(PIPED_APIS.map(async (b) => ((await probe(b, '/trending?region=US')) ? b : null))),
    Promise.all(INV_APIS.map(async (b) => ((await probe(b, '/api/v1/stats')) ? b : null))),
  ]);
  const pool: HealthyPool = {
    piped: piped.filter((b): b is (typeof PIPED_APIS)[number] => b !== null),
    invidious: invidious.filter((b): b is (typeof INV_APIS)[number] => b !== null),
  };
  await kv.put(HEALTH_KEY, JSON.stringify(pool), { expirationTtl: 7200 });
  return pool;
}

// ── listing ─────────────────────────────────────────────────────────
interface PipedListResponse {
  name?: string;
  uploader?: string;
  relatedStreams?: Array<{
    url?: string;
    title?: string;
    uploaded?: number;
    duration?: number;
    thumbnail?: string;
  }>;
  nextpage?: string;
}
interface InvListResponse {
  title?: string;
  author?: string;
  videos?: Array<{
    videoId?: string;
    title?: string;
    published?: number;
    lengthSeconds?: number;
    videoThumbnails?: Array<{ url?: string }>;
  }>;
}

export type YtKind = 'playlist' | 'channel';

async function pipedListing(pool: string[], type: YtKind, id: string): Promise<YtListing> {
  const path = (type === 'playlist' ? '/playlists/' : '/channel/') + encodeURIComponent(id);
  const { base, json: first } = await firstOf<PipedListResponse>(
    pool,
    path,
    (j) => Array.isArray(j.relatedStreams) && j.relatedStreams.length > 0,
  );
  let streams = (first.relatedStreams ?? []).slice();
  let next = first.nextpage;
  let pages = 1;
  const npBase =
    (type === 'playlist' ? '/nextpage/playlists/' : '/nextpage/channel/') + encodeURIComponent(id);
  while (next && pages < 6 && streams.length < 500) {
    try {
      const np = await json<PipedListResponse>(base + npBase + '?nextpage=' + encodeURIComponent(next));
      if (!np.relatedStreams?.length) break;
      streams = streams.concat(np.relatedStreams);
      next = np.nextpage;
      pages++;
    } catch {
      break;
    }
  }
  return {
    title: first.name || first.uploader || 'YouTube',
    author: first.uploader || '',
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

async function invListing(pool: string[], type: YtKind, id: string): Promise<YtListing> {
  const path =
    type === 'playlist'
      ? '/api/v1/playlists/' + encodeURIComponent(id) + '?fields=title,author,videos'
      : '/api/v1/channels/' + encodeURIComponent(id) + '/videos';
  const { json: j } = await firstOf<InvListResponse>(
    pool,
    path,
    (r) => Array.isArray(r.videos) && r.videos.length > 0,
  );
  return {
    title: j.title || 'YouTube',
    author: j.author || '',
    items: (j.videos ?? [])
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

export async function ytList(kv: KVNamespace, type: YtKind, id: string): Promise<YtListing | null> {
  const pool = await healthyPool(kv);
  try {
    const r = await pipedListing(pool.piped, type, id);
    if (r.items.length) return r;
  } catch {
    /* fall through */
  }
  try {
    const r = await invListing(pool.invidious, type, id);
    if (r.items.length) return r;
  } catch {
    /* fall through */
  }
  return null;
}

// ── stream resolution ───────────────────────────────────────────────
interface PipedStreamsResponse {
  audioStreams?: Array<{ url?: string; bitrate?: number }>;
}

export async function ytResolve(kv: KVNamespace, videoId: string): Promise<string | null> {
  const pool = await healthyPool(kv);
  try {
    const { json: j } = await firstOf<PipedStreamsResponse>(
      pool.piped,
      '/streams/' + encodeURIComponent(videoId),
      (r) => Array.isArray(r.audioStreams) && r.audioStreams.length > 0,
    );
    const best = (j.audioStreams ?? []).slice().sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    return best[0]?.url || null;
  } catch {
    return null;
  }
}
