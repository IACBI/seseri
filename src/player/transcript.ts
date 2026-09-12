/**
 * Transcripts, from the Podcasting 2.0 `<podcast:transcript>` alternatives.
 *
 * WebVTT and SRT only. Both are line-based and cheap to parse; the namespace
 * also allows HTML and JSON, and those are skipped rather than half-supported —
 * an HTML transcript would have to go through the same "text plus https links"
 * reduction the show notes do, which is a different job for a different day.
 *
 * The cues are plain text. Nothing here produces markup, so there is no
 * sanitising question: a transcript is fetched from whatever host a feed names
 * and is exactly as untrusted as the feed.
 */

import { httpsOnly } from '../lib/safe';
import type { EpisodeTranscript } from '../feeds/types';
import { API_BASE, fetchWithTimeout } from '../feeds/proxy-chain';

export interface Cue {
  /** Seconds from the start of the episode. */
  start: number;
  end: number;
  text: string;
}

/** A transcript longer than this is not going to be read on a phone. */
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CUES = 5000;

/** Types we can actually read, best first. */
const READABLE = [/vtt/i, /srt|subrip/i];

/**
 * Pick the transcript to fetch.
 *
 * Prefers the listener's own language when the feed labels one, then VTT over
 * SRT — VTT carries speaker labels and positioning that SRT does not, and
 * throws them away more gracefully.
 */
export function pickTranscript(
  list: readonly EpisodeTranscript[] | undefined,
  lang: string,
): EpisodeTranscript | null {
  if (!list?.length) return null;
  const readable = list.filter((t) => READABLE.some((re) => re.test(t.type || '')) || isSubtitleUrl(t.url));
  if (!readable.length) return null;
  const sameLang = readable.filter((t) => (t.language || '').toLowerCase().startsWith(lang));
  const pool = sameLang.length ? sameLang : readable;
  return pool.find((t) => /vtt/i.test(t.type || '') || /\.vtt(\?|$)/i.test(t.url)) ?? pool[0] ?? null;
}

/** A host that mislabels the type but names the file honestly. */
function isSubtitleUrl(url: string): boolean {
  return /\.(vtt|srt)(\?|$)/i.test(url);
}

/** "00:01:02.500" | "01:02,500" | "62.5" → seconds; -1 when unreadable. */
export function cueTime(raw: string): number {
  const text = raw.trim().replace(',', '.');
  if (!text) return -1;
  const parts = text.split(':');
  if (parts.some((p) => p === '' || !/^\d+(\.\d+)?$/.test(p))) return -1;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return -1;
  return nums.length === 3
    ? (nums[0] ?? 0) * 3600 + (nums[1] ?? 0) * 60 + (nums[2] ?? 0)
    : nums.length === 2
      ? (nums[0] ?? 0) * 60 + (nums[1] ?? 0)
      : (nums[0] ?? 0);
}

const ARROW = /\s*-->\s*/;

/**
 * Parse WebVTT or SRT into cues.
 *
 * One function for both because the difference that matters is punctuation: SRT
 * separates with a comma and numbers its cues, VTT uses a dot and may carry
 * `NOTE` blocks, a `WEBVTT` header and cue settings after the timestamps. Both
 * are "a timing line followed by text", and everything else in either format is
 * something to step over.
 */
export function parseCues(text: string): Cue[] {
  const out: Cue[] = [];
  // A stray \r would end up inside the cue text and render as a box.
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  for (let i = 0; i < lines.length && out.length < MAX_CUES; i++) {
    const line = lines[i] ?? '';
    if (!ARROW.test(line)) continue;
    const [rawStart, rest] = line.split(ARROW);
    if (rawStart === undefined || rest === undefined) continue;
    const start = cueTime(rawStart);
    // VTT puts cue settings (`align:start line:90%`) after the end time.
    const end = cueTime((rest.split(/\s+/)[0] ?? '').trim());
    if (start < 0 || end < 0) continue;

    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j] ?? '';
      if (!next.trim()) break;
      if (ARROW.test(next)) break; // a cue with no blank line before the next
      body.push(next);
      i = j;
    }
    const cueText = body
      .join(' ')
      // `<v Speaker>`, `<c.loud>` and friends are VTT markup, not speech.
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cueText) out.push({ start, end: end > start ? end : start, text: cueText });
  }

  out.sort((a, b) => a.start - b.start);
  return out;
}

/** Which cue a position is in, or the one just before it. -1 when there is none. */
export function cueAt(cues: readonly Cue[], seconds: number): number {
  if (!cues.length || !Number.isFinite(seconds)) return -1;
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((cues[mid]?.start ?? 0) <= seconds) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Fetch and parse a transcript. Direct first, then through the Worker, for the
 * same reason chapters do: a host without CORS headers is indistinguishable
 * from one that is down.
 */
export async function fetchTranscript(url: string, signal?: AbortSignal): Promise<Cue[]> {
  const safe = httpsOnly(url);
  if (!safe) return [];

  const read = async (target: string): Promise<Cue[] | null> => {
    try {
      const res = await fetchWithTimeout(target, signal, 15000);
      if (!res.ok) return null;
      const length = Number(res.headers.get('content-length') || 0);
      if (length > MAX_BYTES) return null;
      const text = await res.text();
      if (text.length > MAX_BYTES) return null;
      return parseCues(text);
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
