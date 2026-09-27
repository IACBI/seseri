// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { exportOpml, feedKey, parseOpml, unfollowedEntries } from './opml';
import type { Subscription } from '../feeds/types';

const subs: Subscription[] = [
  { id: '123456789', name: 'iTunes Show', artist: 'Host', art: '' },
  { id: 'rss:https://example.com/feed.xml', name: 'RSS & Friends', artist: '', art: '' },
  { id: 'rss:https://example.com/quotes.xml', name: 'Single "Quoted" Show', artist: '', art: '' },
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

  // A file exported by a version that still had YouTube must import cleanly:
  // its podcast entries are kept, its YouTube ones skipped rather than turned
  // into subscriptions that could never open.
  it('maps Apple Podcasts links back to legacy ids and skips YouTube ones', () => {
    const xml = `<opml version="2.0"><body>
      <outline text="Apple" type="link" url="https://podcasts.apple.com/us/podcast/x/id987654321"/>
      <outline text="List" type="link" url="https://www.youtube.com/playlist?list=PLxyz_1-2"/>
      <outline text="Chan" type="link" url="https://www.youtube.com/channel/UC12345678901234567890"/>
      <outline text="Vid" type="link" url="https://youtu.be/dQw4w9WgXcQ"/>
    </body></opml>`;
    expect(parseOpml(xml).map((e) => e.id)).toEqual(['987654321']);
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

describe('an Apple subscription that knows its feed', () => {
  const apple: Subscription = {
    id: '1200361736',
    name: 'The Daily',
    artist: 'NYT',
    art: '',
    feedUrl: 'https://feeds.simplecast.com/54nAGcIl',
  };

  it('exports the feed address other apps read, and the Apple id Seseri reads', () => {
    const doc = new DOMParser().parseFromString(exportOpml([apple]), 'application/xml');
    const o = doc.querySelector('outline');
    expect(o?.getAttribute('type')).toBe('rss');
    expect(o?.getAttribute('xmlUrl')).toBe('https://feeds.simplecast.com/54nAGcIl');
    expect(o?.getAttribute('url')).toBe('https://podcasts.apple.com/podcast/id1200361736');
  });

  it('comes back as the same Apple subscription, address included', () => {
    expect(parseOpml(exportOpml([apple]))).toEqual([
      { id: '1200361736', name: 'The Daily', feedUrl: 'https://feeds.simplecast.com/54nAGcIl' },
    ]);
  });
});

describe('unfollowedEntries', () => {
  const followed: Subscription[] = [
    {
      id: '1200361736',
      name: 'The Daily',
      artist: '',
      art: '',
      feedUrl: 'https://feeds.simplecast.com/54nAGcIl',
    },
    { id: 'rss:https://example.com/show/feed/', name: 'Show', artist: '', art: '' },
  ];

  it("skips a show another app's export names by address when it is followed by Apple id", () => {
    const fromOtherApp = [{ id: 'rss:http://FEEDS.simplecast.com/54nAGcIl', name: 'The Daily' }];
    expect(unfollowedEntries(fromOtherApp, followed)).toEqual([]);
  });

  it('skips an address that differs only in how it is written', () => {
    const entries = [{ id: 'rss:https://www.example.com/show/feed', name: 'Show' }];
    expect(unfollowedEntries(entries, followed)).toEqual([]);
  });

  it('skips a repeat within the file itself', () => {
    const entries = [
      { id: 'rss:https://new.example.com/a.xml', name: 'A' },
      { id: 'rss:https://new.example.com/a.xml/', name: 'A again' },
      { id: '999999999', name: 'Apple show', feedUrl: 'https://new.example.com/a.xml' },
    ];
    expect(unfollowedEntries(entries, followed).map((e) => e.name)).toEqual(['A']);
  });

  it('keeps what is genuinely new', () => {
    const entries = [
      { id: 'rss:https://example.com/show/other.xml', name: 'Other' },
      { id: '42424242', name: 'Apple new' },
    ];
    expect(unfollowedEntries(entries, followed)).toEqual(entries);
  });
});

describe('feedKey', () => {
  it('ignores scheme, www, host case and a trailing slash', () => {
    expect(feedKey('http://WWW.Example.com/feed/')).toBe(feedKey('https://example.com/feed'));
  });

  it('keeps what can make it a different feed', () => {
    expect(feedKey('https://example.com/feed?id=1')).not.toBe(
      feedKey('https://example.com/feed?id=2'),
    );
    expect(feedKey('https://example.com/Feed')).not.toBe(feedKey('https://example.com/feed'));
  });
});
