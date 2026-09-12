// @vitest-environment jsdom
/**
 * Transcript parsing, against the two formats podcasts actually publish.
 *
 * WebVTT and SRT differ in punctuation and in what they put around the cues: a
 * `WEBVTT` header, `NOTE` blocks and cue settings on one side, numbered cues
 * and comma decimals on the other. Both are "a timing line followed by text",
 * and everything else is something to step over without losing the cue after
 * it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EpisodeTranscript } from '../feeds/types';
import { cueAt, cueTime, fetchTranscript, parseCues, pickTranscript } from './transcript';

const VTT = `WEBVTT
Kind: captions
Language: en

NOTE This block is metadata and must not become a cue.

1
00:00:00.000 --> 00:00:04.500
Welcome back to the show.

2
00:00:04.500 --> 00:00:09.000 align:start line:90%
<v Host>Today we are talking about</v>
feed parsers.
`;

const SRT = `1
00:00:00,000 --> 00:00:04,500
Welcome back to the show.

2
00:00:04,500 --> 00:00:09,000
Today we are talking about
feed parsers.
`;

describe('cueTime', () => {
  it.each([
    ['00:00:00.000', 0],
    ['00:01:02.500', 62.5],
    ['01:02:03.000', 3723],
    ['00:01:02,500', 62.5],
    ['62.5', 62.5],
    ['1:02', 62],
  ])('%s → %s', (raw, seconds) => {
    expect(cueTime(raw)).toBe(seconds);
  });

  it.each([[''], ['   '], ['soon'], ['1:'], ['--']])('rejects %s', (raw) => {
    expect(cueTime(raw)).toBe(-1);
  });
});

describe('parseCues', () => {
  it('reads WebVTT', () => {
    const cues = parseCues(VTT);
    expect(cues).toEqual([
      { start: 0, end: 4.5, text: 'Welcome back to the show.' },
      { start: 4.5, end: 9, text: 'Today we are talking about feed parsers.' },
    ]);
  });

  it('reads SRT', () => {
    expect(parseCues(SRT)).toEqual([
      { start: 0, end: 4.5, text: 'Welcome back to the show.' },
      { start: 4.5, end: 9, text: 'Today we are talking about feed parsers.' },
    ]);
  });

  it('gives the same cues for the same transcript in either format', () => {
    expect(parseCues(SRT)).toEqual(parseCues(VTT));
  });

  it('strips VTT markup rather than showing it as speech', () => {
    const cues = parseCues('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<c.loud>Loud</c> and <i>clear</i>\n');
    expect(cues[0]?.text).toBe('Loud and clear');
  });

  it('survives CRLF line endings', () => {
    const cues = parseCues(SRT.replace(/\n/g, '\r\n'));
    expect(cues[0]?.text).toBe('Welcome back to the show.');
    // A stray \r left in the text renders as a box.
    expect(cues.some((c) => c.text.includes('\r'))).toBe(false);
  });

  it('keeps the next cue when one has no blank line after it', () => {
    const cues = parseCues(
      '00:00:01.000 --> 00:00:02.000\nFirst\n00:00:02.000 --> 00:00:03.000\nSecond\n',
    );
    expect(cues.map((c) => c.text)).toEqual(['First', 'Second']);
  });

  it('skips a cue with no text', () => {
    const cues = parseCues('00:00:01.000 --> 00:00:02.000\n\n00:00:02.000 --> 00:00:03.000\nReal\n');
    expect(cues.map((c) => c.text)).toEqual(['Real']);
  });

  it('sorts cues that arrive out of order', () => {
    const cues = parseCues(
      '00:00:10.000 --> 00:00:11.000\nSecond\n\n00:00:01.000 --> 00:00:02.000\nFirst\n',
    );
    expect(cues.map((c) => c.text)).toEqual(['First', 'Second']);
  });

  it('answers empty for something that is not a transcript', () => {
    expect(parseCues('<html><body>nope</body></html>')).toEqual([]);
    expect(parseCues('')).toEqual([]);
  });

  it('tolerates an end time that is not after the start', () => {
    const cues = parseCues('00:00:05.000 --> 00:00:01.000\nBackwards\n');
    expect(cues[0]).toEqual({ start: 5, end: 5, text: 'Backwards' });
  });
});

describe('cueAt', () => {
  const cues = parseCues(VTT);

  it.each([
    [0, 0],
    [2, 0],
    [4.5, 1],
    [8.9, 1],
    [100, 1],
  ])('%s s is cue %s', (seconds, index) => {
    expect(cueAt(cues, seconds)).toBe(index);
  });

  it('answers -1 before the first cue and for an empty transcript', () => {
    expect(cueAt([{ start: 10, end: 12, text: 'Late' }], 5)).toBe(-1);
    expect(cueAt([], 5)).toBe(-1);
    expect(cueAt(cues, Number.NaN)).toBe(-1);
  });
});

describe('pickTranscript', () => {
  const vtt: EpisodeTranscript = { url: 'https://x.example/en.vtt', type: 'text/vtt', language: 'en' };
  const srt: EpisodeTranscript = { url: 'https://x.example/en.srt', type: 'application/srt', language: 'en' };
  const tr: EpisodeTranscript = { url: 'https://x.example/tr.vtt', type: 'text/vtt', language: 'tr' };
  const html: EpisodeTranscript = { url: 'https://x.example/t.html', type: 'text/html' };
  const json: EpisodeTranscript = { url: 'https://x.example/t.json', type: 'application/json' };

  it('prefers the listener language', () => {
    expect(pickTranscript([vtt, tr], 'tr')).toBe(tr);
    expect(pickTranscript([tr, vtt], 'en')).toBe(vtt);
  });

  it('prefers VTT over SRT within a language', () => {
    expect(pickTranscript([srt, vtt], 'en')).toBe(vtt);
  });

  it('falls back to another language rather than showing nothing', () => {
    expect(pickTranscript([vtt], 'ja')).toBe(vtt);
  });

  it('skips formats this build cannot read', () => {
    // HTML would need the same "text plus https links" reduction the show notes
    // get; half-supporting it would mean rendering a stranger markup.
    expect(pickTranscript([html, json], 'en')).toBeNull();
    expect(pickTranscript([html, srt], 'en')).toBe(srt);
  });

  it('trusts the file extension when the type is wrong', () => {
    const mislabelled: EpisodeTranscript = { url: 'https://x.example/t.vtt', type: 'text/plain' };
    expect(pickTranscript([mislabelled], 'en')).toBe(mislabelled);
  });

  it('answers null for nothing at all', () => {
    expect(pickTranscript(undefined, 'en')).toBeNull();
    expect(pickTranscript([], 'en')).toBeNull();
  });
});

describe('fetchTranscript', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('refuses a non-https url without asking the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchTranscript('http://x.example/t.vtt')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parses what it fetched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(VTT, { status: 200 })));
    const cues = await fetchTranscript('https://x.example/t.vtt');
    expect(cues).toHaveLength(2);
  });

  it('answers empty rather than throwing when the host is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('CORS'); }));
    await expect(fetchTranscript('https://x.example/t.vtt')).resolves.toEqual([]);
  });

  it('refuses a file too large to read on a phone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('x', { status: 200, headers: { 'content-length': String(9 * 1024 * 1024) } }),
      ),
    );
    await expect(fetchTranscript('https://x.example/t.vtt')).resolves.toEqual([]);
  });
});
