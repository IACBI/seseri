/**
 * Read-only aggregators for the Home view. ZERO writes — this module may only
 * read subscriptions, progress, the last-feed pointer and the IndexedDB feed
 * cache. WP-A implements `continueListening()`; the shape below is frozen.
 */

import type { Episode, FeedMeta, FeedRequest, Subscription } from '../../feeds/types';
import { ytFromToken } from '../../feeds/input-parse';

/** Convert a stored subscription id into a feed request (legacy id scheme). */
export function requestFromSubscription(sub: Subscription): FeedRequest | null {
  const s = String(sub.id);
  if (s.startsWith('yt:')) {
    const p = s.split(':'); // yt:<type>:<id>
    const type = p[1];
    const id = p.slice(2).join(':');
    if ((type === 'playlist' || type === 'channel' || type === 'video') && id) {
      return { kind: 'yt', info: { type, id } };
    }
    // Older entries may carry the token instead
    const ref = sub.yt ? ytFromToken(sub.yt) : null;
    return ref ? { kind: 'yt', info: ref } : null;
  }
  if (s.startsWith('rss:')) return { kind: 'rss', url: s.slice(4) };
  return { kind: 'itunes', id: s };
}

/** One "continue listening" row: an episode with saved progress + its feed. */
export interface ContinueItem {
  feed: FeedMeta;
  req: FeedRequest;
  episode: Episode;
  /** Saved position in seconds. */
  positionSec: number;
  /** 0–100 (0 when the duration is unknown). */
  percent: number;
}

/**
 * Collect resumable episodes across subscribed feeds using ONLY cached data:
 * for each subscription → getLastPlayed(feedId) → getProgress(episodeId) →
 * episode metadata from getCachedFeed(feedId). Feeds never cached are skipped
 * (no network). Sorted most-recently-meaningful first, capped at `limit`.
 *
 * WP-0 stub — WP-A lands the real implementation.
 */
export function continueListening(limit = 6): Promise<ContinueItem[]> {
  void limit;
  return Promise.resolve([]);
}
