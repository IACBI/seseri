// @vitest-environment jsdom
/**
 * The scanner replaced a `DOMParser` implementation, and resume positions are
 * keyed on the `trackId` it produces — so "close enough" is not good enough. A
 * different answer about which `<guid>` or which duplicate `<title>` wins would
 * silently orphan every saved position for the feeds it disagreed about.
 *
 * So the old implementation lives on below as `referenceParse`, a faithful copy
 * of what `rss-parser.ts` used to do, and the corpus is run through both.
 * jsdom gives us the same `DOMParser` the browser did, which is what makes the
 * comparison meaningful rather than circular.
 */
import { describe, expect, it } from 'vitest';
import { parseDuration, scanRss, type ParsedRss } from './rss-scan';

// ── the implementation this replaced, verbatim ───────────────────────
function childText(parent: Element, tag: string): string {
  for (const el of parent.children) {
    if (el.localName === tag) return el.textContent?.trim() ?? '';
  }
  return '';
}

interface RefEpisode {
  trackId: string;
  trackName: string;
  releaseDate: string;
  episodeUrl: string;
  trackTimeMillis: number;
  art?: string;
  description?: string;
}

function referenceParse(xmlText: string): {
  title: string;
  author: string;
  art: string;
  episodes: RefEpisode[];
} {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const channel = doc.querySelector('channel');
  if (doc.querySelector('parsererror') || !channel) throw new Error('invalid rss');

  const title = childText(channel, 'title') || 'Podcast';
  const author = childText(channel, 'author');
  let art = '';
  for (const el of channel.children) {
    if (el.localName === 'image') art = el.getAttribute('href') || childText(el, 'url') || art;
  }

  const episodes: RefEpisode[] = [];
  for (const item of channel.querySelectorAll('item')) {
    let encUrl = '';
    let durMs = 0;
    let epArt = '';
    let notes = '';
    let summary = '';
    for (const el of item.children) {
      switch (el.localName) {
        case 'enclosure':
          encUrl = el.getAttribute('url') || '';
          break;
        case 'duration':
          durMs = parseDuration(el.textContent?.trim() ?? '');
          break;
        case 'image':
          epArt = el.getAttribute('href') || childText(el, 'url') || epArt;
          break;
        case 'encoded':
          notes = el.textContent?.trim() ?? notes;
          break;
        case 'description':
          summary = summary || (el.textContent?.trim() ?? '');
          break;
        case 'summary':
          summary = summary || (el.textContent?.trim() ?? '');
          break;
      }
    }
    const description = notes || summary;
    if (!/^https:\/\//i.test(encUrl)) continue;
    episodes.push({
      trackId: childText(item, 'guid') || encUrl,
      trackName: childText(item, 'title'),
      releaseDate: childText(item, 'pubDate'),
      episodeUrl: encUrl,
      trackTimeMillis: durMs,
      ...(epArt ? { art: epArt } : {}),
      ...(description ? { description } : {}),
    });
  }
  return { title, author, art, episodes };
}

/** The scanner's extra fields are additive; compare only the shared shape. */
function sharedShape(r: ParsedRss): ReturnType<typeof referenceParse> {
  return {
    title: r.title,
    author: r.author,
    art: r.art,
    episodes: r.episodes.map((e) => ({
      trackId: e.trackId,
      trackName: e.trackName,
      releaseDate: e.releaseDate,
      episodeUrl: e.episodeUrl,
      trackTimeMillis: e.trackTimeMillis,
      ...(e.art ? { art: e.art } : {}),
      ...(e.description ? { description: e.description } : {}),
    })),
  };
}

// ── corpus ───────────────────────────────────────────────────────────
const item = (body: string): string => `<item>${body}</item>`;

/**
 * Every prefix the corpus uses, declared. The reference implementation is a
 * strict XML parser: an undeclared `itunes:` would make it throw before it
 * parsed anything, and the comparison would be between two error messages.
 */
const RSS = `<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:it="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:podcast="https://podcastindex.org/namespace/1.0">`;

const CORPUS: Record<string, string> = {
  'plain feed': `<?xml version="1.0" encoding="UTF-8"?>
${RSS}
<channel>
  <title>Test Pod</title>
  <itunes:author>Author X</itunes:author>
  <itunes:image href="https://img.example.com/a.jpg"/>
  ${item(`<title>Ep 1</title><guid>g1</guid>
    <pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate>
    <enclosure url="https://cdn.example.com/1.mp3" type="audio/mpeg"/>
    <itunes:duration>1:02:03</itunes:duration>`)}
</channel></rss>`,

  'cdata mixed into a title': `${RSS}<channel><title>P</title>
  ${item(`<title>Ep 1 <![CDATA[& more]]></title><guid>g1</guid>
    <enclosure url="https://cdn.example.com/1.mp3"/>`)}
</channel></rss>`,

  'entities everywhere': `${RSS}<channel>
  <title>Caf&#233; &amp; Co &#x2014; The Show</title>
  <author>A &amp; B</author>
  ${item(`<title>&lt;b&gt;bold&lt;/b&gt; &quot;quoted&quot;</title><guid>g&amp;1</guid>
    <enclosure url="https://cdn.example.com/a.mp3?x=1&amp;y=2"/>`)}
</channel></rss>`,

  'description in cdata with real markup': `${RSS}<channel><title>P</title>
  ${item(`<title>T</title><guid>g1</guid>
    <enclosure url="https://cdn.example.com/1.mp3"/>
    <description><![CDATA[<p>Hello <a href="https://x.example">link</a></p>]]></description>`)}
</channel></rss>`,

  'content:encoded wins over description': `${RSS}<channel><title>P</title>
  ${item(`<title>T</title><guid>g1</guid>
    <enclosure url="https://cdn.example.com/1.mp3"/>
    <description>short</description>
    <content:encoded>the long one</content:encoded>`)}
</channel></rss>`,

  'first description wins, later ones ignored': `${RSS}<channel><title>P</title>
  ${item(`<guid>g1</guid><enclosure url="https://cdn.example.com/1.mp3"/>
    <description>first</description><itunes:summary>second</itunes:summary>`)}
</channel></rss>`,

  'itunes:summary alone': `${RSS}<channel><title>P</title>
  ${item(`<guid>g1</guid><enclosure url="https://cdn.example.com/1.mp3"/>
    <itunes:summary>only summary</itunes:summary>`)}
</channel></rss>`,

  'nested markup inside description (not escaped)': `${RSS}<channel><title>P</title>
  ${item(`<guid>g1</guid><enclosure url="https://cdn.example.com/1.mp3"/>
    <description>before <b>bold</b> after</description>`)}
</channel></rss>`,

  'channel image element with a url child': `${RSS}<channel>
  <title>P</title>
  <image><url>https://img.example.com/from-url.png</url><title>Logo</title></image>
  ${item(`<guid>g1</guid><enclosure url="https://cdn.example.com/1.mp3"/>`)}
</channel></rss>`,

  'later channel image wins': `${RSS}<channel>
  <title>P</title>
  <image><url>https://img.example.com/first.png</url></image>
  <itunes:image href="https://img.example.com/second.jpg"/>
  ${item(`<guid>g1</guid><enclosure url="https://cdn.example.com/1.mp3"/>`)}
</channel></rss>`,

  'image inside an item': `${RSS}<channel><title>P</title>
  ${item(`<guid>g1</guid><enclosure url="https://cdn.example.com/1.mp3"/>
    <itunes:image href="https://img.example.com/ep.jpg"/>`)}
</channel></rss>`,

  'insecure and missing enclosures are dropped': `${RSS}<channel><title>P</title>
  ${item(`<title>http</title><guid>g1</guid><enclosure url="http://cdn.example.com/1.mp3"/>`)}
  ${item(`<title>none</title><guid>g2</guid>`)}
  ${item(`<title>ok</title><guid>g3</guid><enclosure url="https://cdn.example.com/3.mp3"/>`)}
</channel></rss>`,

  'no guid falls back to the enclosure url': `${RSS}<channel><title>P</title>
  ${item(`<title>T</title><enclosure url="https://cdn.example.com/1.mp3"/>`)}
</channel></rss>`,

  'durations in every shape': `${RSS}<channel><title>P</title>
  ${item(`<guid>a</guid><enclosure url="https://c.example/a.mp3"/><itunes:duration>1:02:03</itunes:duration>`)}
  ${item(`<guid>b</guid><enclosure url="https://c.example/b.mp3"/><itunes:duration>62:03</itunes:duration>`)}
  ${item(`<guid>c</guid><enclosure url="https://c.example/c.mp3"/><itunes:duration>90</itunes:duration>`)}
  ${item(`<guid>d</guid><enclosure url="https://c.example/d.mp3"/><itunes:duration>nonsense</itunes:duration>`)}
  ${item(`<guid>e</guid><enclosure url="https://c.example/e.mp3"/>`)}
</channel></rss>`,

  'the last duplicate duration wins': `${RSS}<channel><title>P</title>
  ${item(`<guid>g1</guid><enclosure url="https://c.example/a.mp3"/>
    <itunes:duration>10</itunes:duration><itunes:duration>20</itunes:duration>`)}
</channel></rss>`,

  'the last duplicate enclosure wins': `${RSS}<channel><title>P</title>
  ${item(`<guid>g1</guid>
    <enclosure url="https://c.example/first.mp3"/>
    <enclosure url="https://c.example/second.mp3"/>`)}
</channel></rss>`,

  'the first duplicate title wins': `${RSS}<channel><title>P</title>
  ${item(`<title>one</title><title>two</title><guid>g1</guid>
    <enclosure url="https://c.example/a.mp3"/>`)}
</channel></rss>`,

  'whitespace is trimmed': `${RSS}<channel>
  <title>
     Spaced Out
  </title>
  ${item(`<title>
      Padded
   </title><guid>  g1  </guid><enclosure url="https://c.example/a.mp3"/>`)}
</channel></rss>`,

  'comments and processing instructions are skipped': `<?xml version="1.0"?>
<!-- a comment before the feed -->
${RSS}<channel><title>P</title><!-- inside -->
  ${item(`<!-- item comment --><title>T</title><guid>g1</guid>
    <enclosure url="https://c.example/a.mp3"/>`)}
</channel></rss>`,

  'a doctype does not confuse it': `<?xml version="1.0"?>
<!DOCTYPE rss PUBLIC "-//x" "https://example.com/x.dtd">
${RSS}<channel><title>P</title>
  ${item(`<guid>g1</guid><enclosure url="https://c.example/a.mp3"/>`)}
</channel></rss>`,

  'attribute containing a greater-than sign': `${RSS}<channel><title>P</title>
  ${item(`<guid>g1</guid><enclosure url="https://c.example/a.mp3" type="audio/mpeg" label="a > b"/>
    <title>T</title>`)}
</channel></rss>`,

  'single-quoted attributes': `${RSS}<channel><title>P</title>
  ${item(`<guid>g1</guid><enclosure url='https://c.example/a.mp3'/>`)}
</channel></rss>`,

  'unusual namespace prefixes': `${RSS}<channel>
  <title>P</title><it:author>Prefix Free</it:author>
  <it:image href="https://img.example.com/a.jpg"/>
  ${item(`<guid>g1</guid><enclosure url="https://c.example/a.mp3"/><it:duration>30</it:duration>`)}
</channel></rss>`,

  'empty channel': `${RSS}<channel><title>Nothing here</title></channel></rss>`,

  'channel with no title': `${RSS}<channel>
  ${item(`<guid>g1</guid><enclosure url="https://c.example/a.mp3"/>`)}
</channel></rss>`,
};

describe('scanRss matches the DOMParser implementation it replaced', () => {
  for (const [name, xml] of Object.entries(CORPUS)) {
    it(name, () => {
      const reference = referenceParse(xml);
      expect(sharedShape(scanRss(xml))).toEqual(reference);
    });
  }
});

describe('scanRss', () => {
  it('throws when there is no channel', () => {
    expect(() => scanRss('not xml at all')).toThrow('invalid rss');
    expect(() => scanRss('<rss><nothing/></rss>')).toThrow('invalid rss');
    expect(() => scanRss('')).toThrow('invalid rss');
  });

  it('reads the Podcasting 2.0 fields the DOM version ignored', () => {
    const r = scanRss(`${RSS}<channel>
      <title>P</title>
      ${item(`<title>T</title><guid>g1</guid>
        <enclosure url="https://c.example/a.mp3"/>
        <itunes:season>2</itunes:season>
        <itunes:episode>14</itunes:episode>
        <podcast:chapters url="https://c.example/ch.json" type="application/json+chapters"/>
        <podcast:transcript url="https://c.example/t.vtt" type="text/vtt" language="en"/>
        <podcast:transcript url="https://c.example/t.srt" type="application/srt"/>`)}
    </channel></rss>`);
    const ep = r.episodes[0];
    expect(ep?.season).toBe(2);
    expect(ep?.episode).toBe(14);
    expect(ep?.chaptersUrl).toBe('https://c.example/ch.json');
    expect(ep?.transcripts).toEqual([
      { url: 'https://c.example/t.vtt', type: 'text/vtt', language: 'en' },
      { url: 'https://c.example/t.srt', type: 'application/srt' },
    ]);
  });

  it('refuses non-https chapter and transcript URLs', () => {
    const r = scanRss(`${RSS}<channel><title>P</title>
      ${item(`<guid>g1</guid><enclosure url="https://c.example/a.mp3"/>
        <podcast:chapters url="http://c.example/ch.json"/>
        <podcast:transcript url="http://c.example/t.vtt" type="text/vtt"/>`)}
    </channel></rss>`);
    expect(r.episodes[0]?.chaptersUrl).toBeUndefined();
    expect(r.episodes[0]?.transcripts).toBeUndefined();
  });

  it('leaves season and episode unset when the feed does not number items', () => {
    const r = scanRss(`${RSS}<channel><title>P</title>
      ${item(`<guid>g1</guid><enclosure url="https://c.example/a.mp3"/>`)}
    </channel></rss>`);
    expect(r.episodes[0]?.season).toBeUndefined();
    expect(r.episodes[0]?.episode).toBeUndefined();
  });

  /**
   * The one intentional divergence: `DOMParser` in XML mode rejects the whole
   * document over a single stray `&`, so one careless character used to make a
   * 3000-episode show unopenable.
   */
  it('salvages a feed that strict XML parsing would reject outright', () => {
    const broken = `${RSS}<channel><title>Fish & Chips</title>
      ${item(`<title>Ep 1</title><guid>g1</guid><enclosure url="https://c.example/a.mp3"/>`)}
      ${item(`<title>Ep 2</title><guid>g2</guid><enclosure url="https://c.example/b.mp3"/>`)}
    </channel></rss>`;
    expect(() => referenceParse(broken)).toThrow();
    const r = scanRss(broken);
    expect(r.title).toBe('Fish & Chips');
    expect(r.episodes.map((e) => e.trackId)).toEqual(['g1', 'g2']);
  });

  it('recovers the items it can from a truncated feed', () => {
    const truncated = `${RSS}<channel><title>P</title>
      ${item(`<title>Ep 1</title><guid>g1</guid><enclosure url="https://c.example/a.mp3"/>`)}
      <item><title>Ep 2</title><guid>g2</guid><enclosure url="https://c.example/b.mp3"`;
    const r = scanRss(truncated);
    expect(r.episodes.map((e) => e.trackId)).toEqual(['g1']);
  });

  it('survives raw void tags dropped into show notes', () => {
    const r = scanRss(`${RSS}<channel><title>P</title>
      ${item(`<guid>g1</guid><enclosure url="https://c.example/a.mp3"/>
        <description>line one<br>line two<img src="https://x.example/i.png">end</description>`)}
      ${item(`<guid>g2</guid><enclosure url="https://c.example/b.mp3"/>`)}
    </channel></rss>`);
    // The second item is the real assertion: an unbalanced <br> used to take
    // everything after it down with it.
    expect(r.episodes.map((e) => e.trackId)).toEqual(['g1', 'g2']);
    expect(r.episodes[0]?.description).toBe('line oneline twoend');
  });

  it('handles a large archive without recursion', () => {
    const items = Array.from({ length: 3000 }, (_, i) =>
      item(
        `<title>Ep ${i}</title><guid>g${i}</guid>` +
          `<pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate>` +
          `<enclosure url="https://c.example/${i}.mp3"/><itunes:duration>${i}</itunes:duration>`,
      ),
    ).join('');
    const r = scanRss(`${RSS}<channel><title>Big</title>${items}</channel></rss>`);
    expect(r.episodes).toHaveLength(3000);
    expect(r.episodes[2999]?.trackId).toBe('g2999');
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
