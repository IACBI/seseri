import { describe, expect, it } from 'vitest';
import { extractItunesId, parseDirectInput } from './input-parse';

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
  it('does not find an id inside a longer word', () => {
    // "guid" ends in "id": a feed URL that carries a long number after one is
    // a feed URL, not the Apple podcast with that number.
    expect(extractItunesId('https://example.com/feeds/guid1234567/rss.xml')).toBeNull();
    expect(extractItunesId('https://example.com/rapid123456789.xml')).toBeNull();
  });
  it('does not cut a longer number down to an id', () => {
    expect(extractItunesId('https://podcasts.apple.com/tr/podcast/x/id1550551126123456')).toBeNull();
  });
  it('still finds the id with a query string after it', () => {
    expect(
      extractItunesId('https://podcasts.apple.com/tr/podcast/x/id1550551126?i=1000600000000'),
    ).toBe('1550551126');
  });
});

describe('parseDirectInput', () => {
  it('classifies rss urls', () => {
    expect(parseDirectInput('https://feeds.example.com/pod')).toEqual({
      kind: 'rss',
      url: 'https://feeds.example.com/pod',
    });
  });
  it('keeps a feed URL a feed URL even when it contains "id" and digits', () => {
    expect(parseDirectInput('https://example.com/feeds/guid1234567/rss.xml')).toEqual({
      kind: 'rss',
      url: 'https://example.com/feeds/guid1234567/rss.xml',
    });
  });
  it('returns null for search terms', () => {
    expect(parseDirectInput('teknoloji')).toBeNull();
  });
  it('refuses plaintext and script schemes', () => {
    expect(parseDirectInput('http://feeds.example.com/pod')).toBeNull();
    expect(parseDirectInput('javascript:alert(1)')).toBeNull();
    expect(parseDirectInput('data:text/xml,<rss/>')).toBeNull();
    expect(parseDirectInput('file:///etc/passwd')).toBeNull();
  });
});
