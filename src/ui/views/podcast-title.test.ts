// @vitest-environment jsdom
/**
 * The page title while a podcast is open.
 *
 * The podcast view names the tab after the show it displays, and nothing took
 * the name back: Home, Search, the Library and Settings all went on reading
 * "<last show> – Seseri" in the tab strip, the window switcher and the history
 * list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, settings } from '../../state/settings';
import { createPlaybackController } from '../playback-controller';
import { renderShell } from '../shell';
import { registerView, showView, viewEl } from '../views';
import { initPodcastView } from './podcast';

const FEED = 'https://feeds.example.com/title';
const XML = `<?xml version="1.0"?><rss version="2.0"><channel><title>Night Shift</title>
  <item><title>One</title><guid>t1</guid><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    <enclosure url="https://cdn.example.com/t1.mp3" type="audio/mpeg"/></item>
</channel></rss>`;

async function waitFor(pred: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('timed out');
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(XML, { status: 200 })),
  );
  settings.set({ ...DEFAULT_SETTINGS, allowPublicProxies: true });
  document.title = 'Seseri';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('document.title', () => {
  it('names the show while it is open and goes back to the app name after', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    renderShell(document.getElementById('app') as HTMLElement);
    const playback = createPlaybackController();
    initPodcastView({ playback, onBack: () => undefined, openNowPlaying: () => undefined });
    registerView({ name: 'home', el: viewEl('home') });

    showView('podcast', { focus: false });
    playback.openFeed({ kind: 'rss', url: FEED });
    await waitFor(() => playback.session().filtered.length === 1);
    expect(document.title).toBe('Night Shift – Seseri');

    showView('home', { focus: false });

    expect(document.title).toBe('Seseri');
  });
});
