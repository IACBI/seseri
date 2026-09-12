/**
 * Chapters, from the Podcasting 2.0 `<podcast:chapters>` file.
 *
 * The parsing is separate from the fetching and has no platform dependencies,
 * because the interesting part is the shapes real publishers emit: times as
 * numbers, times as strings, chapters out of order, an "end of episode" marker
 * with no title, and `toc: false` entries that exist to carry artwork rather
 * than to be listed.
 *
 * Everything a chapter can point at — its image, its link — is https-only, the
 * same rule enclosures follow. A chapter file is fetched from whatever host a
 * feed names, so it is exactly as untrusted as the feed itself.
 */

import { httpsOnly } from '../lib/safe';
import { API_BASE, fetchWithTimeout } from '../feeds/proxy-chain';

export interface Chapter {
  /** Seconds from the start of the episode. */
  startTime: number;
  /** Seconds; 0 when the file does not say, meaning "until the next one". */
  endTime: number;
  title: string;
  /** Chapter artwork, https only. */
  img?: string;
  /** A link the chapter points at, https only. */
  url?: string;
}

/** A file bigger than this is not a chapter list. */
const MAX_BYTES = 512 * 1024;
const MAX_CHAPTERS = 500;

/**
 * "01:02:03.5" | "62:03" | 3723 → seconds.
 *
 * The spec says a number, and publishers send strings anyway.
 */
export function chapterTime(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : -1;
  if (typeof raw !== 'string') return -1;
  const text = raw.trim();
  if (!text) return -1;
  const parts = text.split(':');
  if (parts.some((p) => p === '' || !/^\d+(\.\d+)?$/.test(p))) return -1;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return -1;
  const seconds =
    nums.length === 3
      ? (nums[0] ?? 0) * 3600 + (nums[1] ?? 0) * 60 + (nums[2] ?? 0)
      : nums.length === 2
        ? (nums[0] ?? 0) * 60 + (nums[1] ?? 0)
        : (nums[0] ?? 0);
  return seconds >= 0 ? seconds : -1;
}

/**
 * Parse a chapters document.
 *
 * Sorted by start time and de-duplicated, because a list that is out of order
 * makes "which chapter am I in" a search rather than a lookup — and because a
 * publisher's export tool having a bad day is not the listener's problem.
 */
export function parseChapters(json: unknown): Chapter[] {
  const doc = json as { chapters?: unknown } | null;
  const raw = doc && typeof doc === 'object' ? doc.chapters : null;
  if (!Array.isArray(raw)) return [];

  const out: Chapter[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    // `toc: false` marks a chapter that exists to carry artwork for a stretch
    // of the episode, not to be offered as a place to jump to.
    if (row['toc'] === false) continue;
    const startTime = chapterTime(row['startTime']);
    if (startTime < 0) continue;
    const endTime = chapterTime(row['endTime']);
    const title = typeof row['title'] === 'string' ? row['title'].trim() : '';
    const chapter: Chapter = { startTime, endTime: endTime > startTime ? endTime : 0, title };
    const img = httpsOnly(typeof row['img'] === 'string' ? row['img'] : '');
    if (img) chapter.img = img;
    const url = httpsOnly(typeof row['url'] === 'string' ? row['url'] : '');
    if (url) chapter.url = url;
    out.push(chapter);
    if (out.length >= MAX_CHAPTERS) break;
  }

  // `Array.prototype.sort` is stable, so entries claiming the same second stay
  // in file order and the LAST of them wins below — which is what a file that
  // patches an earlier line means.
  out.sort((a, b) => a.startTime - b.startTime);
  return out.filter((c, i) => i === out.length - 1 || c.startTime !== out[i + 1]?.startTime);
}

/**
 * Which chapter a position is in, or -1.
 *
 * A binary search rather than a scan: this runs on every `timeupdate`, four
 * times a second, against a list that can be hundreds long.
 */
export function chapterAt(chapters: readonly Chapter[], seconds: number): number {
  if (!chapters.length || !Number.isFinite(seconds)) return -1;
  let lo = 0;
  let hi = chapters.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const start = chapters[mid]?.startTime ?? 0;
    if (start <= seconds) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) return -1;
  // An explicit end means the chapter can run out before the next one starts.
  const end = chapters[found]?.endTime ?? 0;
  if (end > 0 && seconds >= end) {
    const next = chapters[found + 1];
    if (!next || seconds < next.startTime) return -1;
  }
  return found;
}

/**
 * Fetch and parse an episode's chapters.
 *
 * Direct first, then through the Worker. A chapter file is hosted wherever the
 * publisher put it, and plenty of those hosts send no CORS headers — which the
 * browser reports as an indistinguishable network failure, so the proxy is the
 * only way to tell "not allowed" from "not there".
 */
export async function fetchChapters(url: string, signal?: AbortSignal): Promise<Chapter[]> {
  const safe = httpsOnly(url);
  if (!safe) return [];

  const read = async (target: string): Promise<Chapter[] | null> => {
    try {
      const res = await fetchWithTimeout(target, signal, 10000);
      if (!res.ok) return null;
      const length = Number(res.headers.get('content-length') || 0);
      if (length > MAX_BYTES) return null;
      const text = await res.text();
      if (text.length > MAX_BYTES) return null;
      return parseChapters(JSON.parse(text));
    } catch {
      return null;
    }
  };

  const direct = await read(safe);
  if (direct?.length) return direct;
  if (signal?.aborted) return [];
  if (!API_BASE) return direct ?? [];
  const proxied = await read(`${API_BASE}/v1/feed?url=${encodeURIComponent(safe)}`);
  return proxied ?? direct ?? [];
}
