// @vitest-environment jsdom
/**
 * The episode list across a language change.
 *
 * Rows are keyed and only replaced when their signature changes, and nothing in
 * the signature depended on the language. The controller re-emits the session
 * when the language switches (its status line is translated), the view
 * compared every row against its old signature, found nothing different, and
 * left the aria-labels, tooltips, badges and dates in the old language until
 * the feed was reopened.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLang, t } from '../../i18n';
import { DEFAULT_SETTINGS, settings } from '../../state/settings';
import { createPlaybackController } from '../playback-controller';
import { renderShell } from '../shell';
import { initPodcastView } from './podcast';

const FEED = 'https://feeds.example.com/lang';
const XML = `<?xml version="1.0"?><rss version="2.0"><channel><title>Lang</title>
  <item><title>One</title><guid>l1</guid><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    <enclosure url="https://cdn.example.com/l1.mp3" type="audio/mpeg"/></item>
  <item><title>Two</title><guid>l2</guid><pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>
    <enclosure url="https://cdn.example.com/l2.mp3" type="audio/mpeg"/></item>
</channel></rss>`;

async function waitFor(pred: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('timed out');
}

beforeEach(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(XML, { status: 200 })),
  );
  settings.set({ ...DEFAULT_SETTINGS, allowPublicProxies: true });
  await applyLang('en');
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await applyLang('tr');
});

describe('episode rows', () => {
  it('are relabelled when the interface language changes', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    renderShell(document.getElementById('app') as HTMLElement);
    const playback = createPlaybackController();
    initPodcastView({ playback, onBack: () => undefined, openNowPlaying: () => undefined });

    playback.openFeed({ kind: 'rss', url: FEED });
    await waitFor(() => playback.session().filtered.length === 2);

    const mark = (): string | null =>
      document.querySelector('.ep-played-btn')?.getAttribute('aria-label') ?? null;
    expect(mark()).toBe(t('mark_played'));
    const english = mark();

    await applyLang('tr');

    expect(t('mark_played')).not.toBe(english);
    expect(mark()).toBe(t('mark_played'));
  });
});
