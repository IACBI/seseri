// @vitest-environment jsdom
/**
 * The diagnostic snapshot.
 *
 * The assertions that matter are about what it must NOT contain. The app's
 * whole pitch is that it collects nothing; a diagnostics button that quietly
 * puts the sync pairing code or a private feed's URL on the clipboard — where
 * it goes straight into a public issue — would be worse than having no button.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../storage/db', () => ({ feedCacheInfo: async () => ({ count: 3, bytes: 5_000_000 }) }));
vi.mock('../player/offline', () => ({
  storageInfo: async () => ({
    usageBytes: 12_000_000,
    quotaBytes: 500_000_000,
    downloadCount: 2,
    downloadBytes: 8_000_000,
  }),
}));

import { collectDiagnostics } from './diagnostics';
import { loadPlayed, markPlayed, markUnplayed } from '../storage/played';
import { loadProgress, setProgress } from '../storage/progress';
import { clearQueue, enqueue, loadQueue } from '../state/queue';
import { loadSubscriptions, toggleSubscription } from '../storage/subscriptions';
import { loadInbox } from '../feeds/inbox';
import { DEFAULT_SETTINGS, settings } from '../state/settings';
import { loadFeedSpeeds, setFeedSpeed } from '../state/feed-speed';

const SECRET_CODE = 'ZZSECRETZZ-AAAAA-BBBBB-CCCCC-DDDDD';
const PRIVATE_FEED = 'https://feeds.patreon.com/rss/creator?auth=Ab3xK9zQ11mNpQrStUvWxYz';

beforeEach(() => {
  localStorage.clear();
  settings.set({ ...DEFAULT_SETTINGS });
  loadProgress();
  loadPlayed();
  loadQueue();
  clearQueue();
  loadSubscriptions();
  loadInbox();
  loadFeedSpeeds();
});

describe('collectDiagnostics', () => {
  it('names the build and the browser', async () => {
    const text = await collectDiagnostics();
    expect(text).toMatch(/^seseri: \S+/m);
    expect(text).toContain('ua: ');
    expect(text).toContain('online: ');
  });

  it('counts what the listener has, without naming any of it', async () => {
    toggleSubscription({ id: 'rss:' + PRIVATE_FEED, name: 'A Private Show', artist: '', art: '' });
    enqueue({ feedId: 'f1', trackId: 'e1', title: 'An Episode Title', feedName: 'A Show' });
    setProgress('e1', 120);
    markPlayed('e2');
    markUnplayed('e3');
    setFeedSpeed('f1', 1.5);

    const text = await collectDiagnostics();

    expect(text).toContain('subscriptions: 1');
    expect(text).toContain('queue: 1');
    expect(text).toContain('saved positions: 1');
    expect(text).toContain('played marks: 1 + 1 reset');
    expect(text).toContain('per-show speeds: 1');
    // None of the names.
    expect(text).not.toContain('A Private Show');
    expect(text).not.toContain('An Episode Title');
  });

  it('never carries a feed url — a private one IS a credential', async () => {
    toggleSubscription({ id: 'rss:' + PRIVATE_FEED, name: 'Show', artist: '', art: '' });
    const text = await collectDiagnostics();
    expect(text).not.toContain(PRIVATE_FEED);
    expect(text).not.toContain('patreon');
    expect(text).not.toContain('auth=');
  });

  it('never carries the sync pairing code', async () => {
    // It is the only credential for the whole synced copy.
    localStorage.setItem('pp_sync', JSON.stringify({ code: SECRET_CODE, rev: 4, skewMs: 0 }));
    const text = await collectDiagnostics();
    expect(text).not.toContain(SECRET_CODE);
    expect(text).not.toContain('ZZSECRET');
  });

  it('reports whether a backend is configured, not which one', async () => {
    const text = await collectDiagnostics();
    expect(text).toMatch(/worker: (configured|none)/);
    expect(text).not.toContain('http://127.0.0.1');
    expect(text).not.toContain('workers.dev');
  });

  it('reports the storage picture, which is what a report usually needs', async () => {
    const text = await collectDiagnostics();
    expect(text).toContain('downloads: 2 (7.6 MB)');
    expect(text).toContain('feed cache: 3 feeds (~4.8 MB)');
    expect(text).toContain('origin storage: 11.4 MB of 476.8 MB');
  });

  it('is one fact per line, so it survives a paste', async () => {
    const text = await collectDiagnostics();
    const lines = text.split('\n');
    expect(lines.length).toBeGreaterThan(10);
    for (const line of lines) expect(line).toMatch(/^[a-z][a-z -]*: /);
  });
});
