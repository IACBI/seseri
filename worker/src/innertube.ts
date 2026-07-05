/**
 * Direct YouTube access via youtubei.js (plan option A). The ANDROID_VR/IOS
 * clients return direct (uncipherd) stream URLs, but those are bound to the
 * resolver's IP — so the audio itself is streamed through /v1/yt/audio rather
 * than handed to the browser. Search/listing come from the same session.
 */
import { Innertube } from 'youtubei.js';
import { fetchWithTimeout } from './safe-fetch';

let tube: Promise<Innertube> | null = null;

export function innertube(): Promise<Innertube> {
  if (!tube) {
    tube = Innertube.create({
      // Server-generated session: locally-generated visitor data now trips
      // YouTube's "Sign in to confirm you're not a bot" wall on most videos.
      generate_session_locally: false,
      // No player JS: the clients below hand out direct URLs, and running
      // YouTube's cipher code needs a JS evaluator workerd doesn't allow.
      // (Format.decipher without a player passes the direct URL through.)
      retrieve_player: false,
      // workerd rejects unbound fetch ("Illegal invocation") — rebind it
      fetch: (input, init) => globalThis.fetch(input as RequestInfo, init),
    });
    // A failed create must not poison the cache for the isolate's lifetime.
    tube.catch(() => {
      tube = null;
    });
  }
  return tube;
}

/** YouTube often hands out protocol-relative thumbnail URLs. */
function absThumb(u: string): string {
  return u.startsWith('//') ? 'https:' + u : u;
}

export interface YtSearchRow {
  kind: 'video' | 'channel' | 'playlist';
  id: string;
  title: string;
  author: string;
  thumb: string;
  /** videos: duration (s); playlists: item count; channels: 0 */
  extra: number;
}

export async function tubeSearch(q: string): Promise<YtSearchRow[]> {
  const yt = await innertube();
  const res = await yt.search(q);
  const out: YtSearchRow[] = [];
  for (const item of res.results ?? []) {
    const it = item as unknown as Record<string, unknown>;
    const type = String(it.type ?? '');
    try {
      if (type === 'Video' || type === 'CompactVideo') {
        const v = it as {
          video_id?: string;
          title?: { text?: string };
          author?: { name?: string };
          thumbnails?: Array<{ url?: string }>;
          duration?: { seconds?: number };
        };
        if (v.video_id) {
          out.push({
            kind: 'video',
            id: v.video_id,
            title: v.title?.text ?? '',
            author: v.author?.name ?? '',
            thumb: absThumb(v.thumbnails?.[0]?.url ?? ""),
            extra: v.duration?.seconds ?? 0,
          });
        }
      } else if (type === 'Channel') {
        const c = it as {
          id?: string;
          author?: { name?: string; thumbnails?: Array<{ url?: string }> };
        };
        if (c.id) {
          out.push({
            kind: 'channel',
            id: c.id,
            title: c.author?.name ?? '',
            author: '',
            thumb: absThumb(c.author?.thumbnails?.[0]?.url ?? ""),
            extra: 0,
          });
        }
      } else if (type === 'Playlist' || type === 'LockupView') {
        const p = it as {
          id?: string;
          content_id?: string;
          title?: { text?: string };
          author?: { name?: string };
          thumbnails?: Array<{ url?: string }>;
          video_count?: { text?: string };
          metadata?: { title?: { text?: string } };
          content_image?: { primary_thumbnail?: { image?: Array<{ url?: string }> } };
        };
        const id = p.id ?? p.content_id;
        if (id && /^(PL|UU|OL|RD)/.test(id)) {
          out.push({
            kind: 'playlist',
            id,
            title: p.title?.text ?? p.metadata?.title?.text ?? '',
            author: p.author?.name ?? '',
            thumb: absThumb(
              p.thumbnails?.[0]?.url ??
                p.content_image?.primary_thumbnail?.image?.[0]?.url ??
                '',
            ),
            extra: parseInt(p.video_count?.text ?? '0') || 0,
          });
        }
      }
    } catch {
      /* skip malformed rows */
    }
    if (out.length >= 20) break;
  }
  return out;
}

export interface TubeAudio {
  url: string;
  mime: string;
  bitrate: number;
  contentLength: number;
  /** googlevideo expects the UA of the client that minted the URL */
  ua: string;
}

const WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const CLIENT_UA: Record<string, string> = {
  ANDROID_VR:
    'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
  IOS: 'com.google.ios.youtube/20.20.7 (iPhone16,2; U; CPU iOS 18_1_1 like Mac OS X;)',
};

/**
 * Best audio-only format for a video (URL usable from THIS worker's IP).
 * Clients are tried in order until one yields a direct-URL format that also
 * serves MID-FILE ranges — under PO-token enforcement most clients only get
 * the first ~2 MB, which breaks streaming/seek.
 * ANDROID_VR (Meta Quest) is the one remaining PO-token-exempt client; IOS
 * resolves everywhere but its URLs are usually range-capped, so it's only a
 * fallback for the videos where the cap isn't applied.
 * The TV/embedded/WEB clients were dropped: they now require a JS evaluator
 * to decipher (unavailable in workerd) or fail playability outright.
 */
const STREAM_CLIENTS = ['ANDROID_VR', 'IOS'] as const;

export async function tubeAudio(videoId: string): Promise<TubeAudio | null> {
  const yt = await innertube();
  for (const client of STREAM_CLIENTS) {
    try {
      const info = await yt.getBasicInfo(videoId, { client });
      if (info.playability_status?.status !== 'OK') continue;
      // Direct-URL formats only — with no player, ciphered ones can't be used
      const formats = (info.streaming_data?.adaptive_formats ?? []).filter(
        (f) => f.has_audio && !f.has_video && f.url,
      );
      const best = formats.slice().sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
      if (!best) continue;
      // no player → passes the direct URL through; String() guards URL instances
      const url = String((await best.decipher(yt.session.player)) ?? '');
      if (!/^https?:\/\//.test(url)) continue;
      const ua = CLIENT_UA[client] ?? WEB_UA;
      const len = Number(best.content_length ?? 0);

      // Mid-file probe: only accept URLs that stream beyond the first chunk
      if (len > 4096) {
        const mid = Math.floor(len / 2);
        const probe = await fetchWithTimeout(`${url}&range=${mid}-${mid + 1023}`, 8000, {
          headers: { 'user-agent': ua },
        });
        await probe.body?.cancel().catch(() => {});
        if (!probe.ok) {
          console.error(`tubeAudio[${client}]: mid-range probe ${probe.status}`);
          continue;
        }
      }

      return {
        url,
        mime: (best.mime_type ?? 'audio/mp4').split(';')[0] ?? 'audio/mp4',
        bitrate: best.bitrate ?? 0,
        contentLength: len,
        ua,
      };
    } catch (e) {
      console.error(`tubeAudio[${client}]:`, (e as Error).message);
    }
  }
  return null;
}
