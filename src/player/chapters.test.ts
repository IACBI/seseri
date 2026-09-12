// @vitest-environment jsdom
/**
 * Chapter files, as publishers actually emit them.
 *
 * The spec says `startTime` is a number of seconds. In the wild it is also
 * "00:12:30", the chapters arrive out of order, some carry `toc: false` because
 * they exist to change the artwork rather than to be listed, and the last one
 * is often an untitled marker for the end of the episode.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chapterAt, chapterTime, fetchChapters, parseChapters, type Chapter } from './chapters';

describe('chapterTime', () => {
  it.each([
    [0, 0],
    [93.5, 93.5],
    ['0', 0],
    ['93', 93],
    ['1:33', 93],
    ['01:02:03', 3723],
    ['01:02:03.5', 3723.5],
  ])('%s → %s', (raw, seconds) => {
    expect(chapterTime(raw)).toBe(seconds);
  });

  it.each([[-1], ['soon'], [''], ['  '], [null], [undefined], [{}], [':'], ['1:'], ['a:b']])(
    'rejects %s',
    (raw) => {
      expect(chapterTime(raw)).toBe(-1);
    },
  );
});

describe('parseChapters', () => {
  it('reads a plain file', () => {
    const chapters = parseChapters({
      version: '1.2.0',
      chapters: [
        { startTime: 0, title: 'Cold open' },
        { startTime: 95, title: 'The interview', img: 'https://img.example/c2.jpg' },
        { startTime: 1800, endTime: 1900, title: 'Credits', url: 'https://example.com/notes' },
      ],
    });
    expect(chapters).toEqual([
      { startTime: 0, endTime: 0, title: 'Cold open' },
      { startTime: 95, endTime: 0, title: 'The interview', img: 'https://img.example/c2.jpg' },
      { startTime: 1800, endTime: 1900, title: 'Credits', url: 'https://example.com/notes' },
    ]);
  });

  it('sorts chapters a publisher emitted out of order', () => {
    const chapters = parseChapters({
      chapters: [
        { startTime: 300, title: 'Third' },
        { startTime: 0, title: 'First' },
        { startTime: 100, title: 'Second' },
      ],
    });
    expect(chapters.map((c) => c.title)).toEqual(['First', 'Second', 'Third']);
  });

  it('accepts times written as timestamps', () => {
    const chapters = parseChapters({
      chapters: [{ startTime: '00:00:00', title: 'A' }, { startTime: '00:02:30', title: 'B' }],
    });
    expect(chapters.map((c) => c.startTime)).toEqual([0, 150]);
  });

  it('skips entries that are only there to carry artwork', () => {
    const chapters = parseChapters({
      chapters: [
        { startTime: 0, title: 'Listed' },
        { startTime: 60, title: 'Art only', img: 'https://img.example/x.jpg', toc: false },
        { startTime: 120, title: 'Listed too' },
      ],
    });
    expect(chapters.map((c) => c.title)).toEqual(['Listed', 'Listed too']);
  });

  it('keeps an untitled end-of-episode marker, which is a real position', () => {
    const chapters = parseChapters({ chapters: [{ startTime: 0, title: 'A' }, { startTime: 3600 }] });
    expect(chapters).toHaveLength(2);
    expect(chapters[1]).toEqual({ startTime: 3600, endTime: 0, title: '' });
  });

  it('collapses two chapters claiming the same second', () => {
    const chapters = parseChapters({
      chapters: [{ startTime: 10, title: 'Old' }, { startTime: 10, title: 'Corrected' }],
    });
    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.title).toBe('Corrected');
  });

  it('drops an endTime that is not after the start', () => {
    const chapters = parseChapters({ chapters: [{ startTime: 100, endTime: 50, title: 'A' }] });
    expect(chapters[0]?.endTime).toBe(0);
  });

  it('refuses non-https images and links', () => {
    const chapters = parseChapters({
      chapters: [
        { startTime: 0, title: 'A', img: 'http://img.example/x.jpg', url: 'javascript:alert(1)' },
      ],
    });
    expect(chapters[0]?.img).toBeUndefined();
    expect(chapters[0]?.url).toBeUndefined();
  });

  it.each([
    ['no chapters key', {}],
    ['a null document', null],
    ['a bare array', [{ startTime: 0 }]],
    ['chapters that is not an array', { chapters: 'soon' }],
    ['a string', 'nope'],
  ])('answers empty for %s', (_label, doc) => {
    expect(parseChapters(doc)).toEqual([]);
  });

  it('skips entries with no usable start time', () => {
    const chapters = parseChapters({
      chapters: [{ title: 'No time' }, { startTime: 'soon', title: 'Bad time' }, { startTime: 5, title: 'Fine' }],
    });
    expect(chapters.map((c) => c.title)).toEqual(['Fine']);
  });

  it('caps an absurd list', () => {
    const chapters = parseChapters({
      chapters: Array.from({ length: 900 }, (_, i) => ({ startTime: i, title: 'C' + i })),
    });
    expect(chapters).toHaveLength(500);
  });
});

describe('chapterAt', () => {
  const chapters: Chapter[] = [
    { startTime: 0, endTime: 0, title: 'A' },
    { startTime: 100, endTime: 0, title: 'B' },
    { startTime: 200, endTime: 250, title: 'C' },
  ];

  it.each([
    [0, 0],
    [99.9, 0],
    [100, 1],
    [150, 1],
    [200, 2],
    [249, 2],
  ])('%s s is in chapter %s', (seconds, index) => {
    expect(chapterAt(chapters, seconds)).toBe(index);
  });

  it('reports no chapter past an explicit end with nothing after it', () => {
    expect(chapterAt(chapters, 300)).toBe(-1);
  });

  it('reports no chapter before the first one', () => {
    expect(chapterAt([{ startTime: 30, endTime: 0, title: 'Late' }], 10)).toBe(-1);
  });

  it('answers -1 for an empty list or a bad position', () => {
    expect(chapterAt([], 10)).toBe(-1);
    expect(chapterAt(chapters, Number.NaN)).toBe(-1);
  });

  it('agrees with a linear scan over a long list', () => {
    // The binary search runs four times a second; a disagreement with the
    // obvious implementation would show up as the wrong chapter highlighted.
    const many: Chapter[] = Array.from({ length: 400 }, (_, i) => ({
      startTime: i * 7,
      endTime: 0,
      title: 'C' + i,
    }));
    const linear = (s: number): number => {
      let found = -1;
      many.forEach((c, i) => {
        if (c.startTime <= s) found = i;
      });
      return found;
    };
    for (const s of [0, 1, 6.9, 7, 700, 1399, 2793, 2800]) {
      expect(chapterAt(many, s)).toBe(linear(s));
    }
  });
});

describe('fetchChapters', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('refuses a non-https url without asking the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchChapters('http://x.example/c.json')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parses what it fetched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ chapters: [{ startTime: 0, title: 'One' }] }), {
          status: 200,
        }),
      ),
    );
    const chapters = await fetchChapters('https://x.example/c.json');
    expect(chapters.map((c) => c.title)).toEqual(['One']);
  });

  it('answers empty rather than throwing when the host is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('CORS'); }));
    await expect(fetchChapters('https://x.example/c.json')).resolves.toEqual([]);
  });

  it('answers empty for a body that is not a chapter file', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html></html>', { status: 200 })));
    await expect(fetchChapters('https://x.example/c.json')).resolves.toEqual([]);
  });

  it('refuses a file too large to be a chapter list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('{}', { status: 200, headers: { 'content-length': String(9 * 1024 * 1024) } }),
      ),
    );
    await expect(fetchChapters('https://x.example/c.json')).resolves.toEqual([]);
  });
});
