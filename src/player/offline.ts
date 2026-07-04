import type { Episode } from '../feeds/types';
import { httpsOnly } from '../lib/safe';
import { deleteDownload, getDownload, listDownloads, putDownload } from '../storage/db';
import { ytServiceAudioUrl } from '../youtube/piped';

/**
 * Offline episode audio: bytes live in the Cache API bucket `seseri-audio`
 * under a synthetic same-origin key; playback creates a blob URL from the
 * cached response (native seeking — no SW range-request handling needed).
 */
const AUDIO_CACHE = 'seseri-audio';

function cacheKey(episodeId: string): string {
  return '/__offline/' + encodeURIComponent(episodeId);
}

async function resolveAudioUrl(ep: Episode, feedIsYT: boolean): Promise<string> {
  let src = httpsOnly(ep.episodeUrl || '');
  if (!src && feedIsYT && ep.ytId) {
    try {
      const u = await ytServiceAudioUrl(ep.ytId);
      if (u) {
        ep.episodeUrl = u;
        src = httpsOnly(u);
      }
    } catch {
      /* no stream */
    }
  }
  return src;
}

export async function isDownloaded(episodeId: string): Promise<boolean> {
  return (await getDownload(episodeId)) !== undefined;
}

export type OfflineOutcome = 'ok' | 'no-url' | 'cors-blocked' | 'failed';

/** Fetch the episode audio into the offline cache. */
export async function downloadOffline(
  ep: Episode,
  feedId: string,
  feedIsYT: boolean,
): Promise<OfflineOutcome> {
  const src = await resolveAudioUrl(ep, feedIsYT);
  if (!src) return 'no-url';
  try {
    const res = await fetch(src, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return 'failed';
    const blob = await res.blob();
    const cache = await caches.open(AUDIO_CACHE);
    await cache.put(
      cacheKey(String(ep.trackId)),
      new Response(blob, {
        headers: {
          'content-type': res.headers.get('content-type') || 'audio/mpeg',
          'content-length': String(blob.size),
        },
      }),
    );
    await putDownload({
      id: String(ep.trackId),
      feedId,
      title: ep.trackName || '',
      bytes: blob.size,
      addedAt: Date.now(),
    });
    return 'ok';
  } catch (e) {
    // Typical failure: podcast CDN without CORS headers.
    return e instanceof TypeError ? 'cors-blocked' : 'failed';
  }
}

/** Blob URL for a downloaded episode, or null. Caller revokes when done. */
export async function offlineAudioUrl(episodeId: string): Promise<string | null> {
  try {
    if (!(await isDownloaded(episodeId))) return null;
    const cache = await caches.open(AUDIO_CACHE);
    const res = await cache.match(cacheKey(episodeId));
    if (!res) return null;
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}

export async function removeDownload(episodeId: string): Promise<void> {
  try {
    const cache = await caches.open(AUDIO_CACHE);
    await cache.delete(cacheKey(episodeId));
  } catch {
    /* ignore */
  }
  await deleteDownload(episodeId);
}

export async function clearAllDownloads(): Promise<void> {
  try {
    await caches.delete(AUDIO_CACHE);
  } catch {
    /* ignore */
  }
  for (const rec of await listDownloads()) await deleteDownload(rec.id);
}

export interface StorageInfo {
  usageBytes: number;
  quotaBytes: number;
  downloadCount: number;
  downloadBytes: number;
}

export async function storageInfo(): Promise<StorageInfo> {
  let usageBytes = 0;
  let quotaBytes = 0;
  try {
    const est = await navigator.storage?.estimate?.();
    usageBytes = est?.usage ?? 0;
    quotaBytes = est?.quota ?? 0;
  } catch {
    /* unsupported */
  }
  const dls = await listDownloads();
  return {
    usageBytes,
    quotaBytes,
    downloadCount: dls.length,
    downloadBytes: dls.reduce((a, d) => a + d.bytes, 0),
  };
}

/** Ask the browser not to evict our data under pressure. */
export function requestPersistence(): void {
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* unsupported */
  }
}
