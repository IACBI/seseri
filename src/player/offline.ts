import type { Episode } from '../feeds/types';
import { httpsOnly } from '../lib/safe';
import { deleteDownload, getDownload, listDownloads, putDownload } from '../storage/db';

/**
 * Offline episode audio: bytes live in the Cache API bucket `seseri-audio`
 * under a synthetic same-origin key; playback creates a blob URL from the
 * cached response (native seeking — no SW range-request handling needed).
 */
const AUDIO_CACHE = 'seseri-audio';

function cacheKey(episodeId: string): string {
  return '/__offline/' + encodeURIComponent(episodeId);
}

/** Exported for its own unit test; production callers go through `offlineAudioUrl`. */
export async function isDownloaded(episodeId: string): Promise<boolean> {
  return (await getDownload(episodeId)) !== undefined;
}

export type OfflineOutcome = 'ok' | 'no-url' | 'cors-blocked' | 'failed' | 'no-space';

/** Keep this much headroom free rather than filling the origin's quota. */
const QUOTA_HEADROOM_BYTES = 50 * 1024 * 1024;

/** Ceiling for self-managed copies, evicted oldest-first. User downloads are exempt. */
const EPHEMERAL_BUDGET_BYTES = 500 * 1024 * 1024;

/** Fetch the episode audio into the offline cache. */
export async function downloadOffline(
  ep: Episode,
  feedId: string,
  opts: { ephemeral?: boolean } = {},
): Promise<OfflineOutcome> {
  const src = httpsOnly(ep.episodeUrl || '');
  if (!src) return 'no-url';
  try {
    const res = await fetch(src, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return 'failed';

    // Refuse up front when the episode obviously will not fit — the estimate is
    // right here and was previously only used for the settings readout.
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > 0 && !(await hasRoomFor(declared))) return 'no-space';

    // Hand the body straight to the Cache API instead of `await res.blob()`:
    // that materialised the whole episode in the JS heap, so a 150 MB download
    // was a 150 MB allocation on a phone.
    const cache = await caches.open(AUDIO_CACHE);
    const headers: Record<string, string> = {
      'content-type': res.headers.get('content-type') || 'audio/mpeg',
    };
    if (declared > 0) headers['content-length'] = String(declared);
    await cache.put(cacheKey(String(ep.trackId)), new Response(res.body, { headers }));

    // Trust the stored entry over the declared length for the size record.
    const stored = await cache.match(cacheKey(String(ep.trackId)));
    const bytes = Number(stored?.headers.get('content-length') || declared) || 0;

    await putDownload({
      id: String(ep.trackId),
      feedId,
      title: ep.trackName || '',
      bytes,
      addedAt: Date.now(),
      ephemeral: opts.ephemeral === true,
    });
    if (opts.ephemeral) await evictEphemeral(String(ep.trackId));
    return 'ok';
  } catch (e) {
    // Typical failure: podcast CDN without CORS headers.
    return e instanceof TypeError ? 'cors-blocked' : 'failed';
  }
}

/**
 * Trim self-managed copies back under the budget, oldest first. `keepId` is
 * whatever is playing right now — evicting that would undo the very reason the
 * copy exists.
 *
 * It is therefore also exempt from the accounting, so the real ceiling is the
 * budget plus one episode. That is deliberate: counting it could only ever
 * evict something else to make room for a file that is already on disk.
 */
async function evictEphemeral(keepId: string): Promise<void> {
  try {
    const own = (await listDownloads())
      .filter((d) => d.ephemeral === true && d.id !== keepId)
      .sort((a, b) => b.addedAt - a.addedAt);
    let kept = 0;
    for (const rec of own) {
      kept += rec.bytes;
      if (kept > EPHEMERAL_BUDGET_BYTES) await removeDownload(rec.id);
    }
  } catch {
    /* eviction is best effort — a full cache fails the next download instead */
  }
}

/** Quota check; permissive when the browser gives us no estimate. */
async function hasRoomFor(bytes: number): Promise<boolean> {
  try {
    const est = await navigator.storage?.estimate?.();
    const quota = est?.quota ?? 0;
    const usage = est?.usage ?? 0;
    if (!quota) return true;
    return usage + bytes + QUOTA_HEADROOM_BYTES <= quota;
  } catch {
    return true;
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
  // `usageBytes` is the honest total (prefetched copies included); the
  // download counters describe what the USER saved, which is what the
  // Downloads list shows.
  const dls = (await listDownloads()).filter((d) => !d.ephemeral);
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
