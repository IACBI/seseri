// @vitest-environment jsdom
/**
 * The browse/play split.
 *
 * These are regression tests for the bug that motivated the split: a single
 * session object meant "the feed on screen" AND "the thing playing", so
 * `openFeed` stopped playback (it called `embedStop()`, `clearQueue()`, then
 * `audio.load()` for the newly-opened feed's last-played episode — which stops
 * the element even with `autoplay: false`). Opening any podcast you had
 * listened to before killed whatever you were listening to, and wiped the
 * queue on the way.
 *
 * The assertions are deliberately about the TRANSPORT (`audio.src`,
 * `audio.paused`) rather than about internal flags: that is the surface the
 * user actually perceives.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlaybackController } from './playback-controller';
import { audio } from '../player/engine';
import { playing } from '../player/session';
import { noteUserIntent } from '../player/recovery';
import { clearQueue, queue } from '../state/queue';
import { DEFAULT_SETTINGS, setSetting, settings } from '../state/settings';

/** `dated` limits how many items carry a pubDate (the rest have none). */
function feedXml(title: string, ids: string[], dated = ids.length): string {
  const items = ids
    .map(
      (id, i) => `<item>
        <title>${title} ep ${i + 1}</title>
        <guid>${id}</guid>
        ${i < dated ? `<pubDate>Mon, 0${i + 1} Jan 2024 00:00:00 GMT</pubDate>` : ''}
        <enclosure url="https://cdn.example.com/${id}.mp3" type="audio/mpeg"/>
      </item>`,
    )
    .join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title>${items}</channel></rss>`;
}

const FEED_A = { url: 'https://feeds.example.com/a', id: 'rss:https://feeds.example.com/a' };
const FEED_B = { url: 'https://feeds.example.com/b', id: 'rss:https://feeds.example.com/b' };

/** Mostly undated: dates only on the newest item. */
const FEED_SPARSE = { url: 'https://feeds.example.com/sparse', id: 'rss:https://feeds.example.com/sparse' };

const BODIES: Record<string, string> = {
  [FEED_A.url]: feedXml('Feed A', ['a1', 'a2', 'a3']),
  [FEED_B.url]: feedXml('Feed B', ['b1', 'b2']),
  [FEED_SPARSE.url]: feedXml('Sparse', ['s1', 's2', 's3', 's4', 's5'], 1),
};

/** The proxy URL embeds the target, so match on substring. */
function bodyFor(url: string): string | null {
  for (const [target, xml] of Object.entries(BODIES)) {
    if (url.includes(encodeURIComponent(target)) || url.includes(target)) return xml;
  }
  return null;
}

async function waitFor(pred: () => boolean, label: string, tries = 200): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('timed out waiting for: ' + label);
}

let ctl: ReturnType<typeof createPlaybackController>;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) => {
      const xml = bodyFor(String(url));
      return xml ? new Response(xml, { status: 200 }) : new Response('', { status: 404 });
    }),
  );
  // Feeds are fetched through the proxy chain, which is opt-in.
  settings.set({ ...DEFAULT_SETTINGS, allowPublicProxies: true });
  localStorage.clear();
  clearQueue();
  playing.set(null);
  audio.removeAttribute('src');
  ctl = createPlaybackController();
});

afterEach(() => {
  vi.unstubAllGlobals();
  settings.set({ ...DEFAULT_SETTINGS });
});

/** Open a feed and wait for its episode list to paint. */
async function open(url: string, count: number): Promise<void> {
  ctl.openFeed({ kind: 'rss', url });
  await waitFor(() => ctl.session().filtered.length === count, `${url} to list ${count} episodes`);
}

/**
 * Start an episode and wait for the element to actually take the source:
 * the play path first asks storage whether an offline copy exists, so
 * `audio.src` lands a microtask or two after `playEpisode` returns.
 */
async function play(idx: number, expectId: string): Promise<void> {
  ctl.playEpisode(idx);
  await waitFor(() => audio.src.includes(`${expectId}.mp3`), `${expectId} to load`);
}

describe('openFeed never touches the transport', () => {
  it('loads no audio when a feed is merely opened', async () => {
    await open(FEED_A.url, 3);
    expect(audio.getAttribute('src')).toBeNull();
    expect(playing()).toBeNull();
  });

  it('keeps the playing episode when another feed is opened', async () => {
    await open(FEED_A.url, 3);
    await play(1, 'a2');
    const src = audio.src;

    await open(FEED_B.url, 2);

    expect(audio.src).toBe(src);
    expect(playing()).toMatchObject({ feedId: FEED_A.id, trackId: 'a2' });
    // …and the browsed list no longer claims to own it.
    expect(ctl.session().meta?.id).toBe(FEED_B.id);
    expect(ctl.session().currentIndex).toBe(-1);
  });

  it('keeps playing when RE-opening a feed that has a last-played episode', async () => {
    // The exact reported scenario: feed A remembers a2, so re-opening it used
    // to auto-load a2 and stop feed B mid-episode.
    await open(FEED_A.url, 3);
    await play(1, 'a2');
    await open(FEED_B.url, 2);
    await play(0, 'b1');
    const src = audio.src;

    await open(FEED_A.url, 3);

    expect(audio.src).toBe(src);
    expect(playing()).toMatchObject({ feedId: FEED_B.id, trackId: 'b1' });
  });

  it('re-marks the playing row when the user browses back to that feed', async () => {
    await open(FEED_A.url, 3);
    await play(2, 'a3');
    await open(FEED_B.url, 2);
    expect(ctl.session().currentTrackId).toBeNull();

    await open(FEED_A.url, 3);
    expect(ctl.session().currentTrackId).toBe('a3');
    expect(ctl.session().currentIndex).toBe(2);
  });
});

describe('episode ordering', () => {
  it('sorts chronologically when the feed is actually dated', async () => {
    await open(FEED_A.url, 3);
    // Oldest-first is the default sort; pubDates run Jan 1..3 in source order.
    expect(ctl.session().filtered.map((e) => e.trackId)).toEqual(['a1', 'a2', 'a3']);
  });

  it('keeps source order when only a few items carry a date', async () => {
    // Some feeds carry a date on only the newest handful of items. Treating
    // the undated majority as epoch 0 would fling them to one end of the list.
    await open(FEED_SPARSE.url, 5);
    expect(ctl.session().filtered.map((e) => e.trackId)).toEqual(['s5', 's4', 's3', 's2', 's1']);
  });
});

describe('the queue survives navigation', () => {
  it('is not cleared by opening another feed', async () => {
    await open(FEED_A.url, 3);
    ctl.toggleQueued(1);
    expect(queue()).toHaveLength(1);

    await open(FEED_B.url, 2);

    expect(queue()).toHaveLength(1);
    expect(queue()[0]).toMatchObject({ feedId: FEED_A.id, trackId: 'a2' });
  });

  it('scopes the badge to the feed an entry belongs to', async () => {
    await open(FEED_A.url, 3);
    ctl.toggleQueued(0);
    await open(FEED_B.url, 2);
    // Feed B has no queued episodes even though the queue is non-empty.
    ctl.toggleQueued(0);
    expect(queue().map((q) => `${q.feedId}/${q.trackId}`)).toEqual([
      `${FEED_A.id}/a1`,
      `${FEED_B.id}/b1`,
    ]);
  });
});

describe('prev/next follow the playing feed, not the browsed one', () => {
  it('advances within the playing feed while another feed is on screen', async () => {
    await open(FEED_A.url, 3);
    await play(0, 'a1');
    await open(FEED_B.url, 2);

    ctl.next();
    await waitFor(() => audio.src.includes('a2.mp3'), 'a2 to load');

    expect(playing()).toMatchObject({ feedId: FEED_A.id, trackId: 'a2' });
  });

  it('stops at the end of the playing feed regardless of the browsed list', async () => {
    await open(FEED_A.url, 3);
    await play(2, 'a3'); // last of three
    await open(FEED_B.url, 2);

    ctl.next();

    expect(playing()).toMatchObject({ trackId: 'a3' });
  });

  it('does not step back past the first episode', async () => {
    await open(FEED_A.url, 3);
    await play(0, 'a1');
    ctl.prev();
    expect(playing()).toMatchObject({ trackId: 'a1' });
  });
});

describe('resumeLastPlayed', () => {
  it('loads the remembered episode when the user asks to continue', async () => {
    await open(FEED_A.url, 3);
    await play(1, 'a2');
    ctl.reset();
    expect(playing()).toBeNull();

    ctl.resumeLastPlayed();
    await waitFor(() => playing() !== null, 'the remembered episode to load');
    expect(playing()).toMatchObject({ feedId: FEED_A.id, trackId: 'a2' });
  });

  it('refuses to steal the transport from something already playing', async () => {
    await open(FEED_A.url, 3);
    await play(1, 'a2');
    await open(FEED_B.url, 2);
    await play(0, 'b1');
    const src = audio.src;

    await open(FEED_A.url, 3);
    ctl.resumeLastPlayed();

    expect(audio.src).toBe(src);
    expect(playing()).toMatchObject({ feedId: FEED_B.id, trackId: 'b1' });
  });
});

/**
 * The transport must survive a dead source. Before the recovery watchdog, an
 * `error` from the element — which is what a failed mid-episode range request
 * looks like — left the player stopped with `audio_err` on screen and nothing
 * retrying, and that is how backgrounded playback died.
 */
describe('recovery after the stream dies mid-episode', () => {
  it('reloads the episode source instead of stopping', async () => {
    await open(FEED_A.url, 3);
    ctl.playEpisode(0, true); // autoplay: the user meant this to be playing
    await waitFor(() => audio.src.includes('a1.mp3'), 'a1 to load');

    // What a dropped continuation looks like from the element's side.
    audio.src = 'https://127.0.0.1:1/dead.mp3';
    audio.dispatchEvent(new Event('error'));

    await waitFor(() => audio.src.includes('a1.mp3'), 'the source to be restored');
    expect(audio.src).toContain('a1.mp3');
  });

  it('stays stopped when the user was the one who paused', async () => {
    await open(FEED_A.url, 3);
    ctl.playEpisode(0, true);
    await waitFor(() => audio.src.includes('a1.mp3'), 'a1 to load');
    noteUserIntent(false); // what the pause button and the lock screen report

    audio.src = 'https://127.0.0.1:1/dead.mp3';
    audio.dispatchEvent(new Event('error'));

    await new Promise((r) => setTimeout(r, 200));
    expect(audio.src).toContain('dead.mp3');
  });
});

/**
 * A settings write used to re-emit the browse session unconditionally, and the
 * podcast view answers that by building a row signature for every episode in
 * the archive. The volume slider writes on `input`, at pointer rate, for a
 * value no row renders — so dragging it with a long feed open was thousands of
 * signature builds a second.
 */
describe('settings writes only re-emit for what the list renders', () => {
  /** Count session emissions caused by a settings change alone. */
  async function emitsFor(mutate: () => void): Promise<number> {
    await open(FEED_A.url, 3);
    let emits = 0;
    const off = ctl.session.subscribe(() => emits++);
    mutate();
    off();
    return emits;
  }

  it('ignores volume, which no row reads', async () => {
    expect(await emitsFor(() => setSetting('volume', 0.4))).toBe(0);
  });

  it('ignores font size and row height, which are CSS custom properties', async () => {
    expect(
      await emitsFor(() => {
        setSetting('fontSize', '15px');
        setSetting('rowHeight', '66px');
      }),
    ).toBe(0);
  });

  it('still re-emits for showDl, which adds or removes a button per row', async () => {
    expect(await emitsFor(() => setSetting('showDl', !settings().showDl))).toBe(1);
  });

  it('still re-emits for resumePos, which decides the badge and the hairline', async () => {
    expect(await emitsFor(() => setSetting('resumePos', !settings().resumePos))).toBe(1);
  });

  it('re-emits once for a burst that ends on a different value', async () => {
    expect(
      await emitsFor(() => {
        for (let v = 0; v <= 10; v++) setSetting('volume', v / 10);
        setSetting('showDl', !settings().showDl);
      }),
    ).toBe(1);
  });
});
