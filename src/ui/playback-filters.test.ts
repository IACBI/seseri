// @vitest-environment jsdom
/**
 * The episode filters, and the played marks they read.
 *
 * These exist because the archive switch turned a 41-row list into a
 * 2676-row one. A text box is not a way to navigate that, and "have I heard
 * this" was previously derived from the position alone — so a feed that
 * publishes no duration could never have a finished episode, and there was no
 * way to say so by hand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlaybackController } from './playback-controller';
import { audio } from '../player/engine';
import { playing } from '../player/session';
import { clearQueue } from '../state/queue';
import { DEFAULT_SETTINGS, settings } from '../state/settings';
import { isPlayed, loadPlayed, markPlayed, markUnplayed } from '../storage/played';
import { loadProgress, saveProgressNow, setProgress } from '../storage/progress';

/** `durationSec` 0 means the feed publishes no `<itunes:duration>`. */
function feedXml(ids: string[], durationSec = 600, title = 'Filter Pod'): string {
  const items = ids
    .map(
      (id, i) => `<item>
        <title>Episode ${i + 1}</title>
        <guid>${id}</guid>
        <pubDate>Mon, 0${i + 1} Jan 2024 00:00:00 GMT</pubDate>
        <enclosure url="https://cdn.example.com/${id}.mp3" type="audio/mpeg"/>
        ${durationSec ? `<itunes:duration>${durationSec}</itunes:duration>` : ''}
      </item>`,
    )
    .join('');
  return `<?xml version="1.0"?><rss version="2.0"
    xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
    <channel><title>${title}</title>${items}</channel></rss>`;
}

const FEED = 'https://feeds.example.com/filters';
const NO_DURATION_FEED = 'https://feeds.example.com/nodur';
const IDS = ['e1', 'e2', 'e3', 'e4'];
const DURATION_SEC = 600;

const BODIES: Record<string, string> = {
  [FEED]: feedXml(IDS),
  [NO_DURATION_FEED]: feedXml(['n1', 'n2'], 0, 'No Duration Pod'),
};

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
  settings.set({ ...DEFAULT_SETTINGS, allowPublicProxies: true });
  localStorage.clear();
  loadProgress();
  loadPlayed();
  clearQueue();
  playing.set(null);
  audio.removeAttribute('src');
  ctl = createPlaybackController();
});

afterEach(() => {
  vi.unstubAllGlobals();
  settings.set({ ...DEFAULT_SETTINGS });
});

async function open(url = FEED, count = IDS.length): Promise<void> {
  ctl.openFeed({ kind: 'rss', url });
  await waitFor(() => ctl.session().filtered.length === count, `${url} to list ${count}`);
}

function visibleIds(): string[] {
  return ctl.session().filtered.map((e) => String(e.trackId));
}

describe('the unplayed filter', () => {
  it('hides episodes whose position passed the end', async () => {
    setProgress('e2', DURATION_SEC * 0.99);
    saveProgressNow();
    await open();

    ctl.setFilterMode('unplayed');

    expect(visibleIds()).toEqual(['e1', 'e3', 'e4']);
    expect(ctl.session().hiddenByMode).toBe(1);
  });

  it('hides episodes marked heard by hand', async () => {
    await open();
    markPlayed('e3');
    ctl.setFilterMode('unplayed');
    expect(visibleIds()).toEqual(['e1', 'e2', 'e4']);
  });

  it('shows a finished episode again once it is marked unheard', async () => {
    setProgress('e2', DURATION_SEC * 0.99);
    saveProgressNow();
    await open();
    ctl.setFilterMode('unplayed');
    expect(visibleIds()).not.toContain('e2');

    markUnplayed('e2');

    expect(visibleIds()).toContain('e2');
  });

  it('removes the row as soon as it is marked, which is what the filter means', async () => {
    await open();
    ctl.setFilterMode('unplayed');
    expect(visibleIds()).toHaveLength(4);

    ctl.togglePlayed(0); // e1

    expect(visibleIds()).toEqual(['e2', 'e3', 'e4']);
    expect(isPlayed('e1', DURATION_SEC * 1000)).toBe(true);
  });
});

describe('the in-progress filter', () => {
  it('shows only episodes that were started and not finished', async () => {
    setProgress('e1', 120); // under way
    setProgress('e2', DURATION_SEC * 0.99); // finished
    setProgress('e3', 2); // below the noise floor
    saveProgressNow();
    await open();

    ctl.setFilterMode('inprogress');

    expect(visibleIds()).toEqual(['e1']);
  });

  it('drops an episode from it the moment it is marked heard', async () => {
    setProgress('e1', 120);
    saveProgressNow();
    await open();
    ctl.setFilterMode('inprogress');
    expect(visibleIds()).toEqual(['e1']);

    markPlayed('e1');

    expect(visibleIds()).toEqual([]);
  });
});

describe('the downloaded filter', () => {
  it('shows nothing when nothing is downloaded', async () => {
    await open();
    ctl.setFilterMode('downloaded');
    expect(visibleIds()).toEqual([]);
    expect(ctl.session().hiddenByMode).toBe(4);
  });
});

describe('filters compose with the text box', () => {
  it('applies both', async () => {
    markPlayed('e1');
    await open();

    ctl.setFilterMode('unplayed');
    ctl.setFilter('Episode 2');

    expect(visibleIds()).toEqual(['e2']);
  });

  it('reports nothing hidden while showing all', async () => {
    await open();
    ctl.setFilter('Episode 2');
    expect(ctl.session().mode).toBe('all');
    expect(ctl.session().hiddenByMode).toBe(0);
    expect(visibleIds()).toEqual(['e2']);
  });
});

describe('the filter survives navigation', () => {
  it('carries over to the next feed opened', async () => {
    await open();
    ctl.setFilterMode('unplayed');
    markPlayed('n1');

    ctl.openFeed({ kind: 'rss', url: NO_DURATION_FEED });
    await waitFor(() => ctl.session().meta?.name === 'No Duration Pod', 'the second feed');

    expect(ctl.session().mode).toBe('unplayed');
    expect(visibleIds()).toEqual(['n2']);
  });
});

describe('a feed that publishes no duration', () => {
  it('can still have a finished episode, which it could not before', async () => {
    // The gap the explicit marks close: with no duration there is no
    // percentage, so the derivation can never say "heard".
    await open(NO_DURATION_FEED, 2);
    setProgress('n1', 99999);
    saveProgressNow();

    ctl.setFilterMode('unplayed');
    expect(visibleIds()).toEqual(['n1', 'n2']);

    ctl.togglePlayed(0);
    expect(visibleIds()).toEqual(['n2']);
  });
});

describe('reaching the end of an episode', () => {
  it('marks it heard, even with no duration to derive it from', async () => {
    await open(NO_DURATION_FEED, 2);
    ctl.playEpisode(0);
    await waitFor(() => !!playing(), 'the episode to load');

    audio.dispatchEvent(new Event('ended'));

    expect(isPlayed('n1', 0)).toBe(true);
  });

  it('does not override a listener who just said unheard', async () => {
    await open(NO_DURATION_FEED, 2);
    ctl.playEpisode(0);
    await waitFor(() => !!playing(), 'the episode to load');
    markUnplayed('n1');

    audio.dispatchEvent(new Event('ended'));

    expect(isPlayed('n1', 0)).toBe(false);
  });
});

describe('setFilterMode', () => {
  it('is a no-op for the mode already set', async () => {
    await open();
    ctl.setFilterMode('unplayed');
    const before = ctl.session();
    ctl.setFilterMode('unplayed');
    expect(ctl.session()).toBe(before);
  });

  it('restores the whole list', async () => {
    markPlayed('e1');
    await open();
    ctl.setFilterMode('unplayed');
    expect(visibleIds()).toHaveLength(3);

    ctl.setFilterMode('all');

    expect(visibleIds()).toHaveLength(4);
    expect(ctl.session().hiddenByMode).toBe(0);
  });
});
