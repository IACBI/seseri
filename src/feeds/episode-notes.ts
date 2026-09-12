/**
 * Show notes, fetched when something is about to render them.
 *
 * The Worker sends an episode list without notes, because notes are most of a
 * feed's bytes and none of a list's content: The Daily's archive is 1.31 MB of
 * brotli as XML, 1.06 MB as JSON with notes, and 0.28 MB as a notes-free JSON
 * list. Only the Now Playing sheet ever shows them, and only for one episode
 * at a time, so that is when they are fetched.
 *
 * Three things keep this from being a network request per sheet open:
 *
 *   - An answer is remembered for the session, including the empty one. A feed
 *     with no notes at all must not be asked again on every episode change.
 *   - The fetched text is written back into the cached feed in IndexedDB, so
 *     an episode whose notes have been read once keeps them offline and across
 *     reloads.
 *   - The Worker answers from the document it already parsed and edge-cached,
 *     so the request never reaches the feed host.
 */

import type { Episode } from './types';
import { fetchEpisodeNotes } from './proxy-chain';
import { patchCachedEpisode } from '../storage/db';

/** `feedId + '\u0000' + trackId` → notes ('' when there are none). */
const cache = new Map<string, string>();
/** In-flight requests, so two renders of the same episode share one fetch. */
const pending = new Map<string, Promise<string>>();

function key(feedId: string, trackId: string): string {
  return feedId + '\u0000' + trackId;
}

/** The `rss:`-prefixed feed id carries the feed URL; nothing else can be asked. */
function feedUrlOf(feedId: string): string | null {
  return feedId.startsWith('rss:') ? feedId.slice(4) : null;
}

/**
 * Notes for one episode, or `''`.
 *
 * Resolves immediately when the episode already carries them — an iTunes feed
 * always does, and so does an RSS feed parsed on the device through the public
 * proxies. Only a list that came from `/v1/parse` reaches the network here.
 */
export async function loadEpisodeNotes(feedId: string, ep: Episode): Promise<string> {
  if (ep.description) return ep.description;
  const trackId = String(ep.trackId ?? '');
  if (!feedId || !trackId) return '';

  const k = key(feedId, trackId);
  const known = cache.get(k);
  if (known !== undefined) return known;
  const inFlight = pending.get(k);
  if (inFlight) return inFlight;

  const url = feedUrlOf(feedId);
  if (!url) {
    cache.set(k, '');
    return '';
  }

  const task = (async () => {
    const notes = await fetchEpisodeNotes(url, trackId);
    cache.set(k, notes);
    // Best-effort: the point is that a reload (or going offline) keeps them.
    if (notes) await patchCachedEpisode(feedId, trackId, { description: notes });
    return notes;
  })().finally(() => pending.delete(k));

  pending.set(k, task);
  return task;
}

/** Test seam: forget everything remembered this session. */
export function resetEpisodeNotesCache(): void {
  cache.clear();
  pending.clear();
}
