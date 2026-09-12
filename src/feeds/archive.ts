/**
 * The full archive for a show opened through Apple.
 *
 * Apple's lookup endpoint does not return a show's episodes — it returns a
 * slice of them, and it does not say so. Measured 2026-07-30: The Daily reports
 * `trackCount` 2676 and hands back 41; Radiolab reports 859 and hands back 200.
 * Asking for a higher `limit` changes nothing. So for the shows people actually
 * listen to, opening the podcast showed about 1.5% of it, and the only honest
 * thing the UI could do was admit it ("41 episodes · of 2676 in the archive").
 *
 * The archive is right there in the show's own RSS feed, whose URL Apple gives
 * us in the same response (`feedUrl`). What kept the app from using it is that
 * the two sources name the same episode differently — Apple's numeric
 * `trackId` versus the feed's `<guid>` — so switching sources orphans every
 * resume position, every queued item and every downloaded file.
 *
 * This module is that migration. The join key is the enclosure URL, which both
 * sources carry and which identifies the audio rather than the catalogue entry.
 *
 * Two deliberate limits:
 *
 *   - The feed keeps its Apple identity (`meta.id` stays the numeric id), so
 *     subscriptions, the last-played pointer, the feed cache key and queued
 *     items all keep working. Only the per-episode ids move.
 *   - It only runs when Apple admits the list is short, so a show whose whole
 *     archive fits in the lookup response costs no extra request.
 */

import type { Episode, ResolvedFeed } from './types';
import { remapDownload } from '../player/offline';
import { remapLastPlayed, remapProgressIds } from '../storage/progress';
import { remapQueueIds } from '../state/queue';

/**
 * Enclosure URLs are the join key, but the two sources do not always spell
 * them identically: tracking prefixes and analytics parameters get added and
 * removed over time. Matching drops the query string and keeps the rest, which
 * is the part that names the file.
 */
function audioKey(url: string): string {
  if (!url) return '';
  const q = url.indexOf('?');
  const base = (q === -1 ? url : url.slice(0, q)).toLowerCase();
  // Protocol-relative and scheme differences are not identity either.
  return base.replace(/^https?:\/\//, '');
}

export type IdPair = readonly [from: string, to: string];

/**
 * Episode id pairs to migrate: Apple's id → the feed's id, for every episode
 * both lists describe. Pairs where the id is unchanged are left out.
 */
export function buildEpisodeRemap(apple: readonly Episode[], archive: readonly Episode[]): IdPair[] {
  const byAudio = new Map<string, string>();
  for (const ep of apple) {
    const key = audioKey(ep.episodeUrl || '');
    const id = String(ep.trackId ?? '');
    // First one wins: a duplicate enclosure in the lookup response is a
    // catalogue artefact, and guessing between them would migrate at random.
    if (key && id && !byAudio.has(key)) byAudio.set(key, id);
  }

  const pairs: IdPair[] = [];
  const seen = new Set<string>();
  for (const ep of archive) {
    const key = audioKey(ep.episodeUrl || '');
    const to = String(ep.trackId ?? '');
    const from = key ? byAudio.get(key) : undefined;
    if (!from || !to || from === to || seen.has(from)) continue;
    seen.add(from);
    pairs.push([from, to]);
  }
  return pairs;
}

export interface MigrationReport {
  positions: number;
  queued: number;
  downloads: number;
  lastPlayed: boolean;
}

/**
 * Move everything keyed on an episode id onto the archive's ids.
 *
 * Order matters only in that nothing here can partially corrupt a store: each
 * helper either moves an entry or leaves it, and every one of them is safe to
 * run twice — the second pass finds nothing at the old id.
 */
export async function applyEpisodeRemap(
  feedId: string,
  pairs: readonly IdPair[],
): Promise<MigrationReport> {
  const report: MigrationReport = { positions: 0, queued: 0, downloads: 0, lastPlayed: false };
  if (!pairs.length) return report;

  report.positions = remapProgressIds(pairs);
  report.lastPlayed = remapLastPlayed(feedId, pairs);
  report.queued = remapQueueIds(feedId, pairs);

  // Downloads touch two stores each, so only the pairs that could possibly
  // have one are attempted — `remapDownload` returns false for the rest, but
  // 2700 pointless IndexedDB reads is not the way to find that out.
  for (const [from, to] of pairs) {
    if (await remapDownload(from, to)) report.downloads++;
  }
  return report;
}

/**
 * Should we go to the show's own feed for this one?
 *
 * `limited` is Apple's own admission that it returned less than the show has.
 */
export function needsArchive(feed: ResolvedFeed): boolean {
  return feed.limited === true;
}
