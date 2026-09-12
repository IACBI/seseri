/**
 * What is new in the shows you follow.
 *
 * Subscriptions used to refresh only when you opened one, which made the
 * feature half a feature: the app could tell you what you were subscribed to
 * but never that anything had happened. There was no answer anywhere to "what
 * came out since I last looked" — the one question a listener actually opens a
 * podcast app with.
 *
 * The sweep runs on app open, not in the background. Periodic Background Sync
 * exists but is Chromium-only, needs an installed PWA and a permission
 * prompt — a lot of surface for a partial answer — while a sweep on open works
 * on every platform the app ships to. It is deliberately cheap:
 *
 *   - A feed checked within `CHECK_EVERY_MS` is skipped.
 *   - `CONCURRENCY` requests at a time, so a 50-show library does not open 50
 *     sockets on a phone.
 *   - It goes through `resolveFeed`, so the Worker's edge cache absorbs most of
 *     it and the feed cache is warm by the time the listener taps the show.
 *
 * A newly subscribed feed records where it starts and announces nothing: a
 * 600-episode archive arriving as 600 "new episodes" is not news, it is a wall.
 */

import type { Episode, FeedRequest, Subscription } from './types';
import { requestFromFeedId } from './feed-id';
import { resolveFeed } from './resolve';
import { putCachedFeed } from '../storage/db';
import { isPlayed } from '../storage/played';
import { local } from '../storage/local';
import { settings } from '../state/settings';
import { signal } from '../state/signals';
import { transferAllowed } from '../player/connection';
import { startDownload } from '../player/download-jobs';

/** One unheard episode that appeared since this device last looked. */
export interface InboxItem {
  feedId: string;
  trackId: string;
  title: string;
  feedName: string;
  /** Release date as the feed states it; '' when it does not. */
  releaseDate: string;
  /** Duration in ms, for the row and for the played derivation. */
  trackTimeMillis: number;
  /** Episode or show artwork, whichever the feed gave. */
  art: string;
  /** When this device first saw it. */
  foundAt: number;
}

/** Where each feed was up to at the last check. */
interface SeenMark {
  /** Last check, ms epoch. */
  at: number;
  /** Newest episode id at that moment. */
  newest: string;
}

const INBOX_KEY = 'pp_inbox';
const SEEN_KEY = 'pp_feed_seen';

/** Beyond this the list stops being a list of news. Oldest finds go first. */
const MAX_INBOX = 200;

/** A feed checked more recently than this is left alone. */
export const CHECK_EVERY_MS = 30 * 60 * 1000;

/** Feeds fetched at once. Small on purpose — phones, and other people's hosts. */
const CONCURRENCY = 3;

export const inbox = signal<InboxItem[]>([]);

let seen: Record<string, SeenMark> = {};
let sweeping = false;

function asSeen(v: unknown): Record<string, SeenMark> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, SeenMark> = {};
  for (const [id, mark] of Object.entries(v as Record<string, unknown>)) {
    if (!id || !mark || typeof mark !== 'object') continue;
    const m = mark as Partial<SeenMark>;
    if (typeof m.at !== 'number' || !Number.isFinite(m.at)) continue;
    out[id] = { at: m.at, newest: typeof m.newest === 'string' ? m.newest : '' };
  }
  return out;
}

/** Reject what does not fit, never throw — the same contract as `loadQueue`. */
function asItems(v: unknown): InboxItem[] {
  if (!Array.isArray(v)) return [];
  const out: InboxItem[] = [];
  const keys = new Set<string>();
  for (const row of v) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const r = row as Partial<InboxItem>;
    if (typeof r.feedId !== 'string' || typeof r.trackId !== 'string') continue;
    if (!r.feedId || !r.trackId) continue;
    const key = r.feedId + '\u0000' + r.trackId;
    if (keys.has(key)) continue;
    keys.add(key);
    out.push({
      feedId: r.feedId,
      trackId: r.trackId,
      title: typeof r.title === 'string' ? r.title : '',
      feedName: typeof r.feedName === 'string' ? r.feedName : '',
      releaseDate: typeof r.releaseDate === 'string' ? r.releaseDate : '',
      trackTimeMillis: typeof r.trackTimeMillis === 'number' ? r.trackTimeMillis : 0,
      art: typeof r.art === 'string' ? r.art : '',
      foundAt: typeof r.foundAt === 'number' ? r.foundAt : 0,
    });
  }
  return out;
}

export function loadInbox(): void {
  inbox.set(asItems(local.get<unknown>(INBOX_KEY, [])));
  seen = asSeen(local.get<unknown>(SEEN_KEY, {}));
}

function persistInbox(list: InboxItem[]): void {
  inbox.set(list);
  local.set(INBOX_KEY, list);
}

function persistSeen(): void {
  local.set(SEEN_KEY, seen);
}

/**
 * What the badge and the Home rail show: unheard finds, newest first.
 *
 * Filtered through `isPlayed` rather than pruned on play, which is what makes
 * this work across devices without syncing the inbox itself — the played marks
 * already travel, so an episode heard on the PC is not news on the phone.
 */
export function pendingInbox(): InboxItem[] {
  return inbox()
    .filter((i) => !isPlayed(i.trackId, i.trackTimeMillis))
    .sort((a, b) => b.foundAt - a.foundAt || (a.trackId < b.trackId ? -1 : 1));
}

export function dismissInboxItem(feedId: string, trackId: string): void {
  persistInbox(inbox().filter((i) => !(i.feedId === feedId && i.trackId === trackId)));
}

export function clearInbox(): void {
  persistInbox([]);
}

/** Test seam: forget the check marks so the next sweep starts from scratch. */
export function resetSeen(): void {
  seen = {};
  persistSeen();
}

/**
 * Episodes in `list` that are newer than the recorded mark.
 *
 * Index first: finding the previously-newest id and taking everything after it
 * is exact, and survives a feed that re-dates or re-titles its back catalogue.
 * Dates are the fallback for when that id is gone — a feed that rotates its
 * window, or one whose ids changed with the Apple→RSS archive switch.
 */
export function newSince(list: readonly Episode[], mark: SeenMark): Episode[] {
  if (!list.length) return [];
  const at = mark.newest ? list.findIndex((e) => String(e.trackId) === mark.newest) : -1;
  if (at >= 0) return list.slice(at + 1);
  return list.filter((e) => {
    if (!e.releaseDate) return false;
    const t = Date.parse(e.releaseDate);
    return Number.isFinite(t) && t > mark.at;
  });
}

/** Oldest-first, so "everything after the previous newest" is a tail slice. */
function chronological(episodes: readonly Episode[]): Episode[] {
  const dated = episodes.reduce((n, e) => n + (e.releaseDate ? 1 : 0), 0);
  // Same majority rule as the episode list: a sparsely dated feed is left in
  // source order rather than having its undated items flung to one end.
  if (dated * 2 > episodes.length) {
    return episodes
      .slice()
      .sort((a, b) => +new Date(a.releaseDate || 0) - +new Date(b.releaseDate || 0));
  }
  return episodes.slice().reverse();
}

export interface SweepResult {
  checked: number;
  skipped: number;
  found: number;
  failed: number;
}

/**
 * Check one feed. Returns the items it added.
 *
 * Never throws: a feed host that is down, a feed that no longer parses and a
 * proxy configuration that cannot reach it are all "nothing new from this one".
 */
/**
 * Download what the sweep just found.
 *
 * Capped per sweep: a show that publishes daily and has not been opened for a
 * month would otherwise start thirty transfers at once on the first launch
 * after a holiday. The newest are the ones a listener wants first, and the rest
 * are one tap away in the list.
 */
const AUTO_DOWNLOAD_PER_SWEEP = 5;

async function autoDownload(found: ReadonlyArray<{ ep: Episode; feedId: string }>): Promise<void> {
  const policy = settings().autoDownload;
  if (policy === 'never' || !found.length) return;
  if (!transferAllowed(policy)) return;
  for (const { ep, feedId } of found.slice(0, AUTO_DOWNLOAD_PER_SWEEP)) {
    // Sequential on purpose: these are tens of megabytes each, and the point is
    // to have them by the time the listener looks, not to saturate the radio.
    await startDownload(ep, feedId).catch(() => undefined);
  }
}

async function checkFeed(sub: Subscription, now: number): Promise<InboxItem[]> {
  // A subscription's id IS its feed id (see feeds/feed-id.ts); the request is
  // the round trip back to something fetchable, and null for a retired source.
  const feedId = String(sub.id);
  const req: FeedRequest | null = requestFromFeedId(feedId);
  if (!req) return [];

  let episodes: Episode[];
  let feedName = sub.name;
  let feedArt = sub.art;
  try {
    const resolved = await resolveFeed(req, {});
    episodes = resolved.episodes;
    feedName = resolved.meta.name || feedName;
    feedArt = resolved.meta.art || feedArt;
    void putCachedFeed(resolved);
  } catch {
    return [];
  }
  if (!episodes.length) return [];

  const ordered = chronological(episodes);
  const newest = String(ordered[ordered.length - 1]?.trackId ?? '');
  const mark = seen[feedId];

  // First sight of this feed: remember where it starts, announce nothing.
  if (!mark) {
    seen[feedId] = { at: now, newest };
    return [];
  }

  const fresh = newSince(ordered, mark);
  seen[feedId] = { at: now, newest };

  // Kept beside the items so `autoDownload` has the enclosure URL without
  // having to look the episode up again.
  for (const ep of fresh) foundEpisodes.push({ ep, feedId });

  return fresh.map((ep) => ({
    feedId,
    trackId: String(ep.trackId),
    title: ep.trackName || '',
    feedName,
    releaseDate: ep.releaseDate,
    trackTimeMillis: ep.trackTimeMillis,
    art: ep.art || feedArt,
    foundAt: now,
  }));
}

/** Episodes this sweep found, in the order they were found. */
let foundEpisodes: Array<{ ep: Episode; feedId: string }> = [];

/**
 * Sweep the subscriptions.
 *
 * `force` ignores the per-feed interval — the pull-to-refresh case. One sweep
 * at a time: two overlapping sweeps would each see the other's un-persisted
 * marks as absent and announce the same episodes twice.
 */
export async function sweepSubscriptions(
  subs: readonly Subscription[],
  { force = false, now = Date.now() }: { force?: boolean; now?: number } = {},
): Promise<SweepResult> {
  const result: SweepResult = { checked: 0, skipped: 0, found: 0, failed: 0 };
  if (sweeping || !subs.length) return result;
  sweeping = true;
  foundEpisodes = [];
  try {
    const due = subs.filter((s) => {
      const feedId = String(s.id);
      // A `yt:` leftover cannot be fetched at all; skipping it here keeps it
      // out of the failure count, where it would look like a broken feed.
      if (!requestFromFeedId(feedId)) return false;
      const mark = seen[feedId];
      if (force || !mark) return true;
      const fresh = now - mark.at < CHECK_EVERY_MS;
      if (fresh) result.skipped++;
      return !fresh;
    });

    const found: InboxItem[] = [];
    for (let i = 0; i < due.length; i += CONCURRENCY) {
      const batch = due.slice(i, i + CONCURRENCY);
      const settled = await Promise.all(
        batch.map(async (sub) => {
          try {
            return await checkFeed(sub, now);
          } catch {
            return null; // counted as a failure below
          }
        }),
      );
      for (const items of settled) {
        if (items === null) result.failed++;
        else {
          result.checked++;
          found.push(...items);
        }
      }
    }

    if (found.length) {
      const have = new Set(inbox().map((i) => i.feedId + '\u0000' + i.trackId));
      const added = found.filter((i) => !have.has(i.feedId + '\u0000' + i.trackId));
      result.found = added.length;
      if (added.length) {
        // Newest first, then trimmed: an overflowing list should lose the
        // oldest news rather than refuse the newest.
        const next = [...added, ...inbox()].slice(0, MAX_INBOX);
        persistInbox(next);
      }
    }
    persistSeen();
    // After the marks are written: a download that fails must not make the
    // sweep announce the same episodes again next time.
    await autoDownload(foundEpisodes);
    return result;
  } finally {
    sweeping = false;
    foundEpisodes = [];
  }
}

/**
 * Show the count on the app icon.
 *
 * Installed PWAs and the Tauri shell both surface it; a browser tab quietly
 * ignores it, which is why this is a one-line best-effort rather than a
 * capability the UI branches on.
 */
export function applyAppBadge(count: number): void {
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (count > 0) void nav.setAppBadge?.(count)?.catch(() => undefined);
    else void nav.clearAppBadge?.()?.catch(() => undefined);
  } catch {
    /* unsupported */
  }
}
