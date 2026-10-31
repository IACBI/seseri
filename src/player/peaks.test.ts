// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const offline = vi.hoisted(() => ({ blob: null as unknown }));
vi.mock('./offline', () => ({ offlineAudioBlob: vi.fn(async () => offline.blob) }));

import {
  PEAK_BARS,
  WINDOW_BYTES,
  audioStart,
  cachedPeaks,
  loadPeaks,
  resetPeaksForTests,
  shapePeaks,
  windowStart,
} from './peaks';

/**
 * The decoder stand-in reads the window's first byte as its loudness, so a
 * test can say exactly what each slice of the "file" sounds like. A first byte
 * of 255 is a window that does not decode (an AAC frame, say).
 */
let decodes = 0;
class FakeOfflineContext {
  decodeAudioData(bytes: ArrayBuffer): Promise<AudioBuffer> {
    decodes++;
    const level = new Uint8Array(bytes)[0] ?? 0;
    if (level === 255) return Promise.reject(new Error('EncodingError'));
    const data = new Float32Array(64).fill(level / 254);
    return Promise.resolve({ getChannelData: () => data } as unknown as AudioBuffer);
  }
}

const SIZE = 10 * 1024 * 1024;
/** Loudness of the byte at `offset`, as the fake file defines it. */
type Shape = (offset: number) => number;
const ramp: Shape = (o) => 1 + Math.floor((o / SIZE) * 253);

/** The file's first bytes, when a test gives it a header; zeros otherwise. */
let fileHead = new Uint8Array(0);

function windowBytes(shape: Shape, start: number, end: number): ArrayBuffer {
  const u = new Uint8Array(end - start + 1);
  u[0] = shape(start);
  if (start < fileHead.length) u.set(fileHead.subarray(start, start + u.length));
  return u.buffer;
}

/** An ID3v2.3 header declaring a tag body of `size` bytes. */
function id3(size: number): Uint8Array {
  return new Uint8Array([
    0x49,
    0x44,
    0x33,
    3,
    0,
    0,
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f,
  ]);
}

function fakeBlob(shape: Shape, size = SIZE): unknown {
  return {
    size,
    slice: (a: number, b: number) => ({ arrayBuffer: async () => windowBytes(shape, a, b - 1) }),
  };
}

const SRC = { id: 'ep-1', url: 'https://cdn.example/ep1.mp3' };
const FINAL = 'https://edge.example/ep1.mp3';

/** A host that answers the probe with a length and every Range with a 206. */
function rangeHost(shape: Shape, opts: { rangeStatus?: number } = {}) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const range = (init?.headers as Record<string, string> | undefined)?.Range;
    if (!range) {
      return {
        ok: true,
        status: 200,
        url: FINAL,
        headers: { get: (k: string) => (k === 'content-length' ? String(SIZE) : null) },
      };
    }
    const [a, b] = range.replace('bytes=', '').split('-').map(Number) as [number, number];
    const status = opts.rangeStatus ?? 206;
    return { ok: true, status, arrayBuffer: async () => windowBytes(shape, a, b) };
  });
}

const run = (allowNetwork = true) =>
  loadPeaks(SRC, { signal: new AbortController().signal, allowNetwork });

beforeEach(() => {
  localStorage.clear();
  resetPeaksForTests();
  offline.blob = null;
  fileHead = new Uint8Array(0);
  decodes = 0;
  vi.stubGlobal('OfflineAudioContext', FakeOfflineContext);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shapePeaks', () => {
  it('scales to the loudest window and keeps a floor under silence', () => {
    const out = shapePeaks([0, 0.5, 1, ...new Array<number>(PEAK_BARS - 3).fill(0.25)])!;
    expect(out).toHaveLength(PEAK_BARS);
    expect(out[2]).toBe(1);
    expect(out[0]).toBeGreaterThan(0);
    expect(out[0]).toBeLessThan(0.1);
    expect(out[1]).toBeGreaterThan(out[3]!);
  });

  it('fills an undecodable window from its neighbours', () => {
    const levels: (number | null)[] = new Array<number | null>(PEAK_BARS).fill(0.5);
    levels[10] = null;
    levels[9] = 0.2;
    levels[11] = 0.4;
    const out = shapePeaks(levels)!;
    const between = shapePeaks([...levels.slice(0, 10), 0.3, ...levels.slice(11)])!;
    expect(out[10]).toBeCloseTo(between[10]!, 6);
  });

  it('gives up when most of the file would be guessed', () => {
    const levels = new Array<number | null>(PEAK_BARS).fill(null);
    for (let i = 0; i < Math.floor(PEAK_BARS * 0.5); i++) levels[i] = 0.3;
    expect(shapePeaks(levels)).toBeNull();
  });

  it('refuses a file of pure silence rather than dividing by zero', () => {
    expect(shapePeaks(new Array<number>(PEAK_BARS).fill(0))).toBeNull();
  });
});

describe('audioStart', () => {
  it('is the byte after an ID3v2 tag', () => {
    expect(audioStart(id3(5635159))).toBe(5635169);
  });
  it('counts a declared footer', () => {
    const h = id3(100);
    h[5] = 0x10;
    expect(audioStart(h)).toBe(120);
  });
  it('is zero for a file that starts with audio', () => {
    expect(audioStart(new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0]))).toBe(0);
  });
});

describe('windowStart', () => {
  it('spreads the windows through the file, each wholly inside it', () => {
    let prev = -1;
    for (let k = 0; k < PEAK_BARS; k++) {
      const s = windowStart(k, PEAK_BARS, SIZE);
      expect(s).toBeGreaterThan(prev);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s + WINDOW_BYTES).toBeLessThanOrEqual(SIZE);
      prev = s;
    }
  });
});

describe('loadPeaks', () => {
  it('measures a downloaded episode without touching the network', async () => {
    offline.blob = fakeBlob(ramp);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const peaks = await run(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(peaks).toHaveLength(PEAK_BARS);
    // A file that gets louder towards the end draws a line that rises.
    expect(peaks![PEAK_BARS - 1]).toBe(1);
    expect(peaks![0]!).toBeLessThan(peaks![PEAK_BARS / 2]!);
    expect(decodes).toBe(PEAK_BARS);
  });

  it('shows a quiet stretch as quiet', async () => {
    // Silent middle third, as in a long pause or a dead air gap.
    offline.blob = fakeBlob((o) => (o > SIZE / 3 && o < (2 * SIZE) / 3 ? 0 : 200));
    const peaks = (await run(false))!;
    expect(peaks[PEAK_BARS / 2]!).toBeLessThan(0.1);
    expect(peaks[2]!).toBe(1);
  });

  it('samples only the audio, past cover art embedded in an ID3 tag', async () => {
    // A real episode carried 5.6 MB of JPEG before its first frame. Inside the
    // tag nothing decodes; after it, everything does.
    const TAG = 6 * 1024 * 1024;
    fileHead = id3(TAG - 10);
    offline.blob = fakeBlob((o) => (o < TAG ? 255 : 100));
    const peaks = await run(false);
    expect(peaks).toHaveLength(PEAK_BARS);
    expect(peaks!.every((p) => p === 1)).toBe(true);
  });

  it('remembers a measurement, across a reload too', async () => {
    offline.blob = fakeBlob(ramp);
    const first = await run(false);
    resetPeaksForTests(); // a new page: only localStorage survives
    decodes = 0;
    expect(await run(false)).toEqual(first!.map((p) => Math.round(p * 100) / 100));
    expect(decodes).toBe(0);
    expect(cachedPeaks(SRC.id)).not.toBeNull();
  });

  it('samples the stream with ranged requests when the data policy allows it', async () => {
    const host = rangeHost(ramp);
    vi.stubGlobal('fetch', host);
    const peaks = await run(true);
    expect(peaks).toHaveLength(PEAK_BARS);
    const ranged = host.mock.calls.filter(
      (c) => (c[1]?.headers as Record<string, string> | undefined)?.Range,
    );
    // The first ten bytes, to find where the audio starts, then one per bar.
    expect((ranged[0]![1]!.headers as Record<string, string>).Range).toBe('bytes=0-9');
    ranged.shift();
    expect(ranged).toHaveLength(PEAK_BARS);
    // After the probe, windows go to where the redirect landed.
    expect(ranged.every((c) => c[0] === FINAL)).toBe(true);
    const sizes = ranged.map((c) => {
      const [a, b] = (c[1]!.headers as Record<string, string>)
        .Range!.replace('bytes=', '')
        .split('-')
        .map(Number) as [number, number];
      return b - a + 1;
    });
    expect(sizes.every((n) => n === WINDOW_BYTES)).toBe(true);
  });

  it('does not download anything when the data policy says no', async () => {
    const host = rangeHost(ramp);
    vi.stubGlobal('fetch', host);
    expect(await run(false)).toBeNull();
    expect(host).not.toHaveBeenCalled();
  });

  it('stops at once when the host ignores Range and sends the whole file', async () => {
    const host = rangeHost(ramp, { rangeStatus: 200 });
    vi.stubGlobal('fetch', host);
    expect(await run(true)).toBeNull();
    // The probe and at most one request per lane: never one per bar.
    expect(host.mock.calls.length).toBeLessThanOrEqual(1 + 6);
  });

  it('stays flat for audio that cannot be decoded in pieces', async () => {
    offline.blob = fakeBlob(() => 255);
    expect(await run(false)).toBeNull();
    expect(cachedPeaks(SRC.id)).toBeNull();
  });

  it('tolerates a few undecodable windows', async () => {
    offline.blob = fakeBlob((o) => (Math.floor(o / (SIZE / PEAK_BARS)) % 10 === 3 ? 255 : 120));
    const peaks = await run(false);
    expect(peaks).toHaveLength(PEAK_BARS);
    expect(peaks!.every((p) => p > 0.9)).toBe(true);
  });

  it('returns null where the browser has no audio decoder', async () => {
    vi.stubGlobal('OfflineAudioContext', undefined);
    offline.blob = fakeBlob(ramp);
    expect(await run(false)).toBeNull();
  });

  it('leaves a cancelled measurement unrecorded', async () => {
    offline.blob = fakeBlob(ramp);
    const ctrl = new AbortController();
    const p = loadPeaks(SRC, { signal: ctrl.signal, allowNetwork: false });
    ctrl.abort();
    expect(await p).toBeNull();
    expect(cachedPeaks(SRC.id)).toBeNull();
  });
});
