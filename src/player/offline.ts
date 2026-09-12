import type { Episode } from '../feeds/types';
import { cancelAllDownloads } from './download-jobs';
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

export type OfflineOutcome = 'ok' | 'no-url' | 'cors-blocked' | 'failed' | 'no-space' | 'aborted';

/** Bytes so far, and the total when the server declared one (0 when it did not). */
export interface DownloadProgress {
  received: number;
  total: number;
}

export interface DownloadOptions {
  /** A copy the app made for itself, evictable and hidden from the list. */
  ephemeral?: boolean;
  /** Abort the transfer. The partial copy is discarded, not stored. */
  signal?: AbortSignal;
  /** Called as bytes arrive. Fires on every chunk, so keep it cheap. */
  onProgress?: (p: DownloadProgress) => void;
}

/** Keep this much headroom free rather than filling the origin's quota. */
const QUOTA_HEADROOM_BYTES = 50 * 1024 * 1024;

/** Ceiling for self-managed copies, evicted oldest-first. User downloads are exempt. */
const EPHEMERAL_BUDGET_BYTES = 500 * 1024 * 1024;

/**
 * Count the bytes on their way past, without buffering any of them.
 *
 * A `TransformStream` in the middle keeps the "hand the body straight to the
 * Cache API" property that stops a 150 MB episode being a 150 MB allocation —
 * chunks are counted and forwarded, never collected.
 */
function counting(
  body: ReadableStream<Uint8Array>,
  total: number,
  onProgress: (p: DownloadProgress) => void,
): ReadableStream<Uint8Array> {
  let received = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        onProgress({ received, total });
        controller.enqueue(chunk);
      },
    }),
  );
}

/** Fetch the episode audio into the offline cache. */
export async function downloadOffline(
  ep: Episode,
  feedId: string,
  opts: DownloadOptions = {},
): Promise<OfflineOutcome> {
  const src = httpsOnly(ep.episodeUrl || '');
  if (!src) return 'no-url';
  if (opts.signal?.aborted) return 'aborted';
  try {
    const res = await fetch(src, {
      mode: 'cors',
      credentials: 'omit',
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
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
    const body =
      res.body && opts.onProgress ? counting(res.body, declared, opts.onProgress) : res.body;
    await cache.put(cacheKey(String(ep.trackId)), new Response(body, { headers }));

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
    /**
     * An abort is a decision, not a fault, and it has to be distinguishable
     * from one: reporting it as `failed` would show the listener an error for
     * something they asked for. A cancelled `cache.put` stores nothing, but the
     * key is cleared anyway — a partial entry would read as a complete download
     * with no record behind it.
     */
    if (opts.signal?.aborted || (e as Error)?.name === 'AbortError') {
      try {
        const cache = await caches.open(AUDIO_CACHE);
        await cache.delete(cacheKey(String(ep.trackId)));
      } catch {
        /* nothing was stored */
      }
      return 'aborted';
    }
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

/**
 * Re-key a downloaded episode, bytes and record together.
 *
 * The Apple→RSS archive switch changes an episode's id, and a download is
 * keyed on it twice: the Cache API entry holding the audio, and the record in
 * IndexedDB that makes it show up in the Downloads list. Without this a
 * listener's saved episodes would go invisible AND unreclaimable — eviction
 * only ever touches copies the app made for itself.
 *
 * Returns true when something actually moved.
 */
export async function remapDownload(from: string, to: string): Promise<boolean> {
  if (from === to || !from || !to) return false;
  try {
    const rec = await getDownload(from);
    if (!rec) return false;
    // A record already under the new id means this ran before.
    if (await getDownload(to)) return false;

    const cache = await caches.open(AUDIO_CACHE);
    const stored = await cache.match(cacheKey(from));
    if (stored) await cache.put(cacheKey(to), stored);
    // Bytes first, record second: a failure between them leaves an orphaned
    // copy under the new key, which the next download overwrites. Reversed, the
    // record would point at bytes that are not there.
    await putDownload({ ...rec, id: to });
    await cache.delete(cacheKey(from));
    await deleteDownload(from);
    return true;
  } catch {
    return false; // the caller keeps the old copy rather than losing it
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
  // Anything still arriving would write itself back into the bucket we are
  // about to delete, and land as a record with no bytes behind it.
  cancelAllDownloads();
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
