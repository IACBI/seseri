/**
 * Read-only aggregators for the Home view. ZERO writes — this module may only
 * read subscriptions, progress, the last-feed pointer and the IndexedDB feed
 * cache.
 */

import type { Episode, FeedMeta, FeedRequest, Subscription } from '../../feeds/types';
import { feedIdOf, requestFromFeedId } from '../../feeds/feed-id';
import { subscriptions } from '../../storage/subscriptions';
import { isPlayed } from '../../storage/played';
import { getLastPlayed, getProgress } from '../../storage/progress';
import { getCachedFeed, getResume } from '../../storage/db';
import { local } from '../../storage/local';

/**
 * Convert a stored subscription id into a feed request (legacy id scheme).
 * Null for a subscription that can no longer be loaded — a `yt:` entry left
 * over from when the app supported YouTube; callers skip those rows.
 */
export function requestFromSubscription(sub: Subscription): FeedRequest | null {
  return requestFromFeedId(String(sub.id));
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
    const feedId = feedIdOf(lastReq);
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

  // The `resume` projection is one small record. Only fall back to the full
  // feed cache when it is missing — a feed last played before this store
  // existed, or one whose last-played episode has since changed.
  let episode: Episode | undefined;
  let meta: FeedMeta | undefined;

  const resume = await getResume(feedId);
  if (resume && String(resume.episode.trackId) === String(episodeId)) {
    episode = resume.episode;
    meta = resume.meta;
  } else {
    const cached = await getCachedFeed(feedId);
    if (!cached) return null;
    episode = cached.feed.episodes.find((e) => String(e.trackId) === String(episodeId));
    meta = cached.feed.meta;
  }
  if (!episode) return null;

  const percent =
    episode.trackTimeMillis > 0
      ? Math.min(100, ((positionSec * 1000) / episode.trackTimeMillis) * 100)
      : 0;
  // `isPlayed` rather than the percentage alone: an episode marked heard by
  // hand has to leave the rail, and one marked unheard has to come back to it.
  if (isPlayed(String(episode.trackId), episode.trackTimeMillis)) return null;

  const feed = meta ?? fallbackMeta;
  if (!feed) return null;

  return { feed, req, episode, positionSec, percent };
}
