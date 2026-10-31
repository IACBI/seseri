/**
 * The waveform's bar heights, measured from the episode's own audio.
 *
 * The sheet used to draw a seeded random shape per episode: it looked like a
 * waveform and said nothing about the sound, so a silent stretch or a loud
 * ad break was invisible. Decoding a whole episode to find out is out of the
 * question on a phone (hundreds of MB of PCM), so this samples it instead —
 * one short window per bar, spread evenly through the file, each decoded on its
 * own and reduced to a loudness (RMS). Fifty-six 16 KB windows are under a
 * megabyte against an episode of tens of MB.
 *
 * MP3 decodes from any byte offset (the decoder resyncs on the next frame
 * header); containers that need their index first (AAC in MP4) fail every
 * window, and the answer is then `null` — the waveform stays flat rather than
 * inventing a shape. Byte position is used as time, which is exact for CBR and
 * close for VBR.
 */

import { local } from '../storage/local';
import { offlineAudioBlob } from './offline';

/** One bar per window. Matches the waveform's bar count. */
export const PEAK_BARS = 56;
/** Bytes per window: about a second of 128 kbps MP3, enough for several frames. */
export const WINDOW_BYTES = 16 * 1024;
/** Below this share of decoded windows the shape is mostly guesswork. */
const MIN_DECODED = 0.6;
/** Windows in flight at once over the network. */
const CONCURRENCY = 6;
/** Shortest bar, so a silent stretch still reads as part of the line. */
const FLOOR = 0.08;

const STORE_KEY = 'pp_peaks';
/** Entries kept across sessions; each is ~170 bytes. */
const STORE_MAX = 150;

type Store = Record<string, number[]>;
let memo: Store | null = null;

function store(): Store {
  if (!memo) {
    const raw = local.get<unknown>(STORE_KEY, {});
    memo = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (
          Array.isArray(v) &&
          v.length === PEAK_BARS &&
          v.every((n) => typeof n === 'number' && n >= 0 && n <= 100)
        ) {
          memo[k] = v as number[];
        }
      }
    }
  }
  return memo;
}

function remember(id: string, peaks: number[]): void {
  const s = store();
  delete s[id]; // re-inserted last, so key order is recency
  s[id] = peaks.map((p) => Math.round(p * 100));
  const keys = Object.keys(s);
  for (let i = 0; i < keys.length - STORE_MAX; i++) delete s[keys[i]!];
  local.set(STORE_KEY, s);
}

/** Heights already measured for this episode, as 0–1 fractions. */
export function cachedPeaks(id: string): number[] | null {
  const hit = store()[id];
  return hit ? hit.map((p) => p / 100) : null;
}

/** Test seam: the module memoises the store. */
export function resetPeaksForTests(): void {
  memo = null;
}

/** Where window `k` of `n` starts, centred in its slice of the file. */
export function windowStart(k: number, n: number, size: number): number {
  const centre = Math.floor(((k + 0.5) / n) * size);
  return Math.max(0, Math.min(size - WINDOW_BYTES, centre - WINDOW_BYTES / 2));
}

function rms(buf: AudioBuffer): number {
  const ch = buf.getChannelData(0);
  if (!ch.length) return NaN;
  let sum = 0;
  for (let i = 0; i < ch.length; i++) sum += ch[i]! * ch[i]!;
  return Math.sqrt(sum / ch.length);
}

/**
 * Loudness per window → bar heights. Missing windows take the mean of their
 * nearest measured neighbours. Normalised to the loudest window, then given a
 * gentle curve: RMS of speech sits in a narrow band and raw ratios draw a
 * line of near-identical bars.
 */
export function shapePeaks(levels: (number | null)[]): number[] | null {
  const known = levels.filter((v): v is number => v !== null && Number.isFinite(v));
  if (known.length < Math.ceil(levels.length * MIN_DECODED)) return null;
  const max = Math.max(...known);
  if (!(max > 0)) return null;
  const filled = levels.map((v, i) => {
    if (v !== null && Number.isFinite(v)) return v;
    let a: number | null = null;
    let b: number | null = null;
    for (let j = i - 1; j >= 0 && a === null; j--) {
      const x = levels[j];
      if (x !== null && x !== undefined && Number.isFinite(x)) a = x;
    }
    for (let j = i + 1; j < levels.length && b === null; j++) {
      const x = levels[j];
      if (x !== null && x !== undefined && Number.isFinite(x)) b = x;
    }
    return ((a ?? b ?? 0) + (b ?? a ?? 0)) / 2;
  });
  return filled.map((v) => FLOOR + (1 - FLOOR) * Math.pow(v / max, 0.6));
}

type Decoder = (bytes: ArrayBuffer) => Promise<AudioBuffer>;

function makeDecoder(): Decoder | null {
  const Ctx =
    typeof OfflineAudioContext !== 'undefined'
      ? OfflineAudioContext
      : (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
          .webkitOfflineAudioContext;
  if (!Ctx) return null;
  let ctx: OfflineAudioContext;
  try {
    // 8 kHz is plenty for loudness and keeps each decode's output small.
    ctx = new Ctx(1, 1, 8000);
  } catch {
    return null;
  }
  return (bytes) => ctx.decodeAudioData(bytes);
}

/**
 * Where the audio starts: past an ID3v2 tag, if the file opens with one.
 *
 * The tag holds the cover art, and podcast hosts embed it at full size — a
 * real episode measured here opened with 5.6 MB of JPEG, so windows spread over
 * the whole file landed in the picture for the first sixteen bars and none of
 * them decoded.
 */
export function audioStart(head: Uint8Array): number {
  if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return 0;
  // Synchsafe: seven bits per byte.
  const size =
    ((head[6]! & 0x7f) << 21) |
    ((head[7]! & 0x7f) << 14) |
    ((head[8]! & 0x7f) << 7) |
    (head[9]! & 0x7f);
  const footer = head[5]! & 0x10 ? 10 : 0;
  return 10 + size + footer;
}

type Reader = (start: number, end: number) => Promise<ArrayBuffer | null>;

async function measure(
  read: Reader,
  size: number,
  decode: Decoder,
  signal: AbortSignal,
): Promise<(number | null)[] | null> {
  const head = await read(0, 9);
  if (!head || signal.aborted) return null;
  const from = audioStart(new Uint8Array(head));
  const span = size - from;
  if (span < WINDOW_BYTES * 4) return null;
  const levels: (number | null)[] = new Array<number | null>(PEAK_BARS).fill(null);
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < PEAK_BARS && !signal.aborted) {
      const k = next++;
      const start = from + windowStart(k, PEAK_BARS, span);
      try {
        const bytes = await read(start, start + WINDOW_BYTES - 1);
        if (bytes && bytes.byteLength && !signal.aborted) levels[k] = rms(await decode(bytes));
      } catch {
        /* one undecodable window is filled from its neighbours */
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, lane));
  return levels;
}

/** The file's size and the URL that serves it, without downloading it. */
async function probe(
  url: string,
  signal: AbortSignal,
): Promise<{ url: string; size: number } | null> {
  const ctrl = new AbortController();
  const stop = (): void => ctrl.abort();
  signal.addEventListener('abort', stop, { once: true });
  try {
    // A plain GET, aborted as soon as the headers arrive: HEAD is refused by
    // some hosts, and `Content-Range` from a ranged probe is not CORS-exposed.
    const res = await fetch(url, { mode: 'cors', signal: ctrl.signal });
    const size = Number(res.headers.get('content-length'));
    const finalUrl = res.url || url;
    ctrl.abort();
    if (!res.ok || !Number.isFinite(size) || size < WINDOW_BYTES * 4) return null;
    return { url: finalUrl, size };
  } catch {
    return null;
  } finally {
    signal.removeEventListener('abort', stop);
  }
}

export interface PeaksSource {
  /** Episode id, the key downloads and the cache share. */
  id: string;
  /** The enclosure URL. */
  url: string;
}

/**
 * Bar heights (0–1, `PEAK_BARS` long) for an episode, or null when they cannot
 * be measured honestly. A downloaded copy is read locally; otherwise the
 * network is used only when `allowNetwork` says the listener's data policy
 * permits a background transfer.
 */
export async function loadPeaks(
  src: PeaksSource,
  opts: { signal: AbortSignal; allowNetwork: boolean },
): Promise<number[] | null> {
  const hit = cachedPeaks(src.id);
  if (hit) return hit;
  const decode = makeDecoder();
  if (!decode) return null;
  const { signal } = opts;

  let levels: (number | null)[] | null = null;
  const blob = await offlineAudioBlob(src.id);
  if (signal.aborted) return null;
  if (blob && blob.size >= WINDOW_BYTES * 4) {
    levels = await measure((a, b) => blob.slice(a, b + 1).arrayBuffer(), blob.size, decode, signal);
  } else if (opts.allowNetwork && /^https:/i.test(src.url)) {
    const target = await probe(src.url, signal);
    if (!target || signal.aborted) return null;
    const lanes = new AbortController();
    const stop = (): void => lanes.abort();
    signal.addEventListener('abort', stop, { once: true });
    levels = await measure(
      async (a, b) => {
        const res = await fetch(target.url, {
          mode: 'cors',
          headers: { Range: `bytes=${a}-${b}` },
          signal: lanes.signal,
        });
        // A 200 here is the whole file: the host ignored the range, and every
        // other window would download the episode again. Stop all of them.
        if (res.status !== 206) {
          lanes.abort();
          return null;
        }
        return res.arrayBuffer();
      },
      target.size,
      decode,
      lanes.signal,
    );
    signal.removeEventListener('abort', stop);
  }
  if (!levels || signal.aborted) return null;
  const peaks = shapePeaks(levels);
  if (peaks) remember(src.id, peaks);
  return peaks;
}
