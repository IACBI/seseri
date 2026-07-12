/**
 * Read-only aggregators for the Home view. ZERO writes — this module may only
 * read subscriptions, progress, the last-feed pointer and the IndexedDB feed
 * cache. WP-A implements `continueListening()`; the shape below is frozen.
 */

import type { Episode, FeedMeta, FeedRequest, Subscription } from '../../feeds/types';
import { ytFromToken } from '../../feeds/input-parse';
import { subscriptions } from '../../storage/subscriptions';
import { getLastPlayed, getProgress } from '../../storage/progress';
import { getCachedFeed } from '../../storage/db';
import { local } from '../../storage/local';

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
export async function continueListening(limit = 6): Promise<ContinueItem[]> {
  const out: ContinueItem[] = [];
  const seen = new Set<string>();

  const collect = (item: ContinueItem | null, feedId: string): void => {
    if (item && !seen.has(feedId)) {
      seen.add(feedId);
      out.push(item);
    }
  };

  // Most-recent feed pointer first — may point at a feed that isn't subscribed.
  const lastReq = local.get<FeedRequest | null>('pp_last_feed', null);
  if (lastReq) {
    const feedId = feedIdFromRequest(lastReq);
    if (feedId) collect(await buildItem(feedId, lastReq), feedId);
  }

  // Then every subscribed feed with a resumable last-played episode.
  const subs = subscriptions();
  const built = await Promise.all(
    subs.map((sub) => {
      const req = requestFromSubscription(sub);
      return req ? buildItem(String(sub.id), req, sub) : Promise.resolve(null);
    }),
  );
  subs.forEach((sub, i) => collect(built[i] ?? null, String(sub.id)));

  return out.slice(0, limit);
}

/** Cache key / FeedMeta id for a request: `<id>` | `rss:<url>` | `yt:<type>:<id>`. */
function feedIdFromRequest(req: FeedRequest): string {
  switch (req.kind) {
    case 'itunes':
      return req.id;
    case 'rss':
      return 'rss:' + req.url;
    case 'yt':
      return `yt:${req.info.type}:${req.info.id}`;
  }
}

/**
 * Resolve one resumable episode from cached data alone. Returns null when the
 * feed was never cached, has no saved last-played position (> 5 s), the episode
 * is gone from the cache, or the item is effectively finished (>= 96%).
 */
async function buildItem(
  feedId: string,
  req: FeedRequest,
  fallbackMeta?: FeedMeta,
): Promise<ContinueItem | null> {
  const episodeId = getLastPlayed(feedId);
  if (!episodeId) return null;
  const positionSec = getProgress(episodeId);
  if (positionSec <= 5) return null;

  const cached = await getCachedFeed(feedId);
  if (!cached) return null;
  const episode = cached.feed.episodes.find((e) => String(e.trackId) === String(episodeId));
  if (!episode) return null;

  const percent =
    episode.trackTimeMillis > 0
      ? Math.min(100, ((positionSec * 1000) / episode.trackTimeMillis) * 100)
      : 0;
  if (percent >= 96) return null;

  const feed = cached.feed.meta ?? fallbackMeta;
  if (!feed) return null;

  return { feed, req, episode, positionSec, percent };
}
