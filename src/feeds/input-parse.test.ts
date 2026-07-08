import { describe, expect, it } from 'vitest';
import { extractItunesId, extractYouTube, parseDirectInput, ytFromToken, ytToToken } from './input-parse';

describe('extractItunesId', () => {
  it('finds id in an Apple Podcasts URL', () => {
    expect(extractItunesId('https://podcasts.apple.com/tr/podcast/x/id1550551126')).toBe(
      '1550551126',
    );
  });
  it('accepts a bare numeric id', () => {
    expect(extractItunesId('1550551126')).toBe('1550551126');
  });
  it('rejects free text', () => {
    expect(extractItunesId('radyo tiyatrosu')).toBeNull();
  });
});

describe('extractYouTube', () => {
  it('parses playlist links', () => {
    expect(extractYouTube('https://www.youtube.com/playlist?list=PLabc-123_DEF')).toEqual({
      type: 'playlist',
      id: 'PLabc-123_DEF',
    });
  });
  it('parses channel links', () => {
    expect(extractYouTube('https://youtube.com/channel/UCabcdefghijklmnopqrst')).toEqual({
      type: 'channel',
      id: 'UCabcdefghijklmnopqrst',
    });
  });
  it('parses watch, youtu.be, shorts and bare-host links', () => {
    expect(extractYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.id).toBe('dQw4w9WgXcQ');
    expect(extractYouTube('youtu.be/dQw4w9WgXcQ')?.id).toBe('dQw4w9WgXcQ');
    expect(extractYouTube('youtube.com/shorts/dQw4w9WgXcQ')?.id).toBe('dQw4w9WgXcQ');
  });
  it('rejects non-YouTube hosts', () => {
    expect(extractYouTube('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });
});

describe('yt tokens', () => {
  it('round-trips', () => {
    for (const ref of [
      { type: 'playlist', id: 'PLx' },
      { type: 'channel', id: 'UCy' },
      { type: 'video', id: 'dQw4w9WgXcQ' },
    ] as const) {
      expect(ytFromToken(ytToToken(ref))).toEqual(ref);
    }
  });
});

describe('parseDirectInput', () => {
  it('classifies rss urls', () => {
    expect(parseDirectInput('https://feeds.example.com/pod')).toEqual({
      kind: 'rss',
      url: 'https://feeds.example.com/pod',
    });
  });
  it('returns null for search terms', () => {
    expect(parseDirectInput('teknoloji')).toBeNull();
  });
});
