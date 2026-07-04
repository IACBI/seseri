// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseDuration, parseRss } from './rss-parser';

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel>
  <title>Test Pod</title>
  <itunes:author>Author X</itunes:author>
  <itunes:image href="https://img.example.com/a.jpg"/>
  <item>
    <title>Ep 1 <![CDATA[& more]]></title>
    <guid>guid-1</guid>
    <pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate>
    <enclosure url="https://cdn.example.com/1.mp3" type="audio/mpeg"/>
    <itunes:duration>1:02:03</itunes:duration>
  </item>
  <item>
    <title>Insecure enclosure — skipped</title>
    <guid>guid-2</guid>
    <enclosure url="http://insecure.example.com/2.mp3" type="audio/mpeg"/>
  </item>
  <item>
    <title>No enclosure — skipped</title>
    <guid>guid-3</guid>
  </item>
  <item>
    <title>MM:SS duration</title>
    <guid>guid-4</guid>
    <enclosure url="https://cdn.example.com/4.mp3" type="audio/mpeg"/>
    <itunes:duration>62:03</itunes:duration>
  </item>
</channel>
</rss>`;

describe('parseRss', () => {
  it('parses channel meta and https-only episodes', () => {
    const r = parseRss(FEED);
    expect(r.title).toBe('Test Pod');
    expect(r.author).toBe('Author X');
    expect(r.art).toBe('https://img.example.com/a.jpg');
    expect(r.episodes.map((e) => e.trackId)).toEqual(['guid-1', 'guid-4']);
    expect(r.episodes[0]?.trackTimeMillis).toBe((1 * 3600 + 2 * 60 + 3) * 1000);
    expect(r.episodes[1]?.trackTimeMillis).toBe((62 * 60 + 3) * 1000);
  });

  it('throws on invalid xml', () => {
    expect(() => parseRss('not xml at all')).toThrow();
  });
});

describe('parseDuration', () => {
  it.each([
    ['1:02:03', 3723000],
    ['62:03', 3723000],
    ['90', 90000],
    ['', 0],
    ['abc', 0],
  ])('%s → %d', (input, ms) => {
    expect(parseDuration(input)).toBe(ms);
  });
});
