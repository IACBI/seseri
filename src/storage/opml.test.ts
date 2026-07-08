// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { exportOpml, parseOpml } from './opml';
import type { Subscription } from '../feeds/types';

const subs: Subscription[] = [
  { id: '123456789', name: 'iTunes Show', artist: 'Host', art: '' },
  { id: 'rss:https://example.com/feed.xml', name: 'RSS & Friends', artist: '', art: '' },
  { id: 'yt:playlist:PLabc-123_XYZ', name: 'YT Playlist', artist: '', art: '', kind: 'yt' },
  { id: 'yt:channel:UCabcdefghijklmnopqrst', name: 'YT Channel', artist: '', art: '', kind: 'yt' },
  { id: 'yt:video:dQw4w9WgXcQ', name: 'Single "Video"', artist: '', art: '', kind: 'yt' },
];

describe('exportOpml', () => {
  it('produces valid XML with one outline per subscription', () => {
    const xml = exportOpml(subs);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.querySelectorAll('outline')).toHaveLength(subs.length);
  });

  it('escapes XML-special characters in names', () => {
    const xml = exportOpml([{ id: 'rss:https://x.com/f', name: 'A & B <"C">', artist: '', art: '' }]);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.querySelector('outline')?.getAttribute('text')).toBe('A & B <"C">');
  });
});

describe('parseOpml', () => {
  it('round-trips every subscription id through export → import', () => {
    const entries = parseOpml(exportOpml(subs));
    expect(entries.map((e) => e.id)).toEqual(subs.map((s) => s.id));
    expect(entries.map((e) => e.name)).toEqual(subs.map((s) => s.name));
  });

  it('imports standard third-party OPML (xmlUrl outlines)', () => {
    const xml = `<?xml version="1.0"?><opml version="2.0"><body>
      <outline text="Show A" type="rss" xmlUrl="https://a.com/rss"/>
      <outline title="Show B" type="rss" xmlUrl="http://b.com/feed"/>
      <outline text="Folder"><outline text="Nested" type="rss" xmlUrl="https://c.com/f"/></outline>
    </body></opml>`;
    const entries = parseOpml(xml);
    expect(entries).toEqual([
      { id: 'rss:https://a.com/rss', name: 'Show A' },
      { id: 'rss:http://b.com/feed', name: 'Show B' },
      { id: 'rss:https://c.com/f', name: 'Nested' },
    ]);
  });

  it('maps Apple Podcasts and YouTube web links back to legacy ids', () => {
    const xml = `<opml version="2.0"><body>
      <outline text="Apple" type="link" url="https://podcasts.apple.com/us/podcast/x/id987654321"/>
      <outline text="List" type="link" url="https://www.youtube.com/playlist?list=PLxyz_1-2"/>
      <outline text="Chan" type="link" url="https://www.youtube.com/channel/UC12345678901234567890"/>
      <outline text="Vid" type="link" url="https://youtu.be/dQw4w9WgXcQ"/>
    </body></opml>`;
    expect(parseOpml(xml).map((e) => e.id)).toEqual([
      '987654321',
      'yt:playlist:PLxyz_1-2',
      'yt:channel:UC12345678901234567890',
      'yt:video:dQw4w9WgXcQ',
    ]);
  });

  it('skips unknown outlines instead of failing', () => {
    const xml = `<opml version="2.0"><body>
      <outline text="Just a folder"/>
      <outline text="Random link" type="link" url="https://example.com/blog"/>
      <outline text="Good" type="rss" xmlUrl="https://ok.com/rss"/>
    </body></opml>`;
    expect(parseOpml(xml)).toEqual([{ id: 'rss:https://ok.com/rss', name: 'Good' }]);
  });

  it('throws on non-XML input', () => {
    expect(() => parseOpml('not xml at all {')).toThrow();
  });
});
