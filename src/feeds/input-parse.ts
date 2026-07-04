import type { FeedRequest, YouTubeRef } from './types';

/** Apple podcast id from a pasted URL ("...id123456789") or a bare number. */
export function extractItunesId(s: string): string | null {
  const m = s.match(/id(\d{6,12})/);
  if (m?.[1]) return m[1];
  if (/^\d{6,12}$/.test(s.trim())) return s.trim();
  return null;
}

/**
 * Parse a YouTube link into a typed ref. Only youtube.com / youtu.be hosts
 * are accepted (no scraping, no free-text search).
 */
export function extractYouTube(input: string): YouTubeRef | null {
  const s = input.trim();
  if (!/(?:^|[/.])(?:youtube\.com|youtu\.be)\b/i.test(s)) return null;
  const pl = s.match(/[?&]list=(PL[\w-]+|UU[\w-]+|FL[\w-]+|OL[\w-]+)/i);
  if (pl?.[1]) return { type: 'playlist', id: pl[1] };
  const ch = s.match(/youtube\.com\/channel\/(UC[\w-]{20,})/i);
  if (ch?.[1]) return { type: 'channel', id: ch[1] };
  const v =
    s.match(/[?&]v=([\w-]{11})/) ??
    s.match(/youtu\.be\/([\w-]{11})/) ??
    s.match(/youtube\.com\/(?:shorts|embed|live)\/([\w-]{11})/);
  if (v?.[1]) return { type: 'video', id: v[1] };
  return null;
}

/** Decode a ?yt= deep-link token (pl_/ch_/vid_ + id). */
export function ytFromToken(tok: string): YouTubeRef | null {
  const m = String(tok).match(/^(pl|ch|vid)_(.+)$/);
  if (!m || !m[1] || !m[2]) return null;
  const type = m[1] === 'pl' ? 'playlist' : m[1] === 'ch' ? 'channel' : 'video';
  return { type, id: m[2] };
}

/** Encode a YouTube ref into its deep-link token. */
export function ytToToken(ref: YouTubeRef): string {
  return (ref.type === 'playlist' ? 'pl_' : ref.type === 'channel' ? 'ch_' : 'vid_') + ref.id;
}

/** Classify free-form search-box input into a directly-loadable request. */
export function parseDirectInput(raw: string): FeedRequest | null {
  const id = extractItunesId(raw);
  if (id) return { kind: 'itunes', id };
  const yt = extractYouTube(raw);
  if (yt) return { kind: 'yt', info: yt };
  if (/^https?:\/\//i.test(raw)) return { kind: 'rss', url: raw };
  return null;
}
