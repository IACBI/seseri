// @vitest-environment jsdom
/**
 * The star asks "unsubscribe from this show?" and the answer arrives later,
 * after the listener has read the question, which is long enough to navigate.
 * The answer belongs to the show the question was about, not to whichever show
 * happens to be on screen when the dialog closes.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedMeta } from '../../feeds/types';

const ask = vi.hoisted(() => ({ settle: null as ((ok: boolean) => void) | null }));
vi.mock('../confirm', () => ({
  confirmDialog: vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        ask.settle = resolve;
      }),
  ),
}));

import { renderShell } from '../shell';
import { initPodcastView } from './podcast';
import {
  emptySession,
  type PlaybackController,
  type PlaybackSession,
} from '../playback-controller';
import { signal } from '../../state/signals';
import { isSubscribed, loadSubscriptions, toggleSubscription } from '../../storage/subscriptions';
import { confirmDialog } from '../confirm';

const feed = (id: string): FeedMeta => ({ id, name: 'Show ' + id, artist: '', art: '' });
const A = feed('rss:https://a.example.com/feed');
const B = feed('rss:https://b.example.com/feed');

const session = signal<PlaybackSession>(emptySession());
const show = (meta: FeedMeta | null): void => session.set({ ...emptySession(), meta });

let favBtn: HTMLButtonElement;

const answer = async (ok: boolean): Promise<void> => {
  ask.settle?.(ok);
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeAll(() => {
  const app = document.createElement('div');
  document.body.append(app);
  renderShell(app);
  initPodcastView({
    playback: { session } as unknown as PlaybackController,
    onBack: () => undefined,
    openNowPlaying: () => undefined,
  });
  favBtn = document.getElementById('favBtn') as HTMLButtonElement;
});

beforeEach(() => {
  localStorage.clear();
  loadSubscriptions();
  toggleSubscription(A);
  toggleSubscription(B);
  vi.mocked(confirmDialog).mockClear();
  ask.settle = null;
  show(A);
});

describe('the unsubscribe confirmation', () => {
  it('unsubscribes the show it was opened for, not the one on screen when it closes', async () => {
    favBtn.click();
    expect(confirmDialog).toHaveBeenCalledTimes(1);

    show(B); // the listener moved on while the dialog was up
    await answer(true);

    expect(isSubscribed(A.id)).toBe(false);
    expect(isSubscribed(B.id)).toBe(true);
    // The star belongs to the show now displayed, which is still subscribed.
    expect(favBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('changes nothing when declined', async () => {
    favBtn.click();
    show(B);
    await answer(false);
    expect(isSubscribed(A.id)).toBe(true);
    expect(isSubscribed(B.id)).toBe(true);
  });

  it('does not subscribe again if another device already removed the show', async () => {
    favBtn.click();
    toggleSubscription(A); // a sync lands while the dialog is open
    expect(isSubscribed(A.id)).toBe(false);

    await answer(true);
    expect(isSubscribed(A.id)).toBe(false);
  });

  it('still unsubscribes the visible show in the ordinary case', async () => {
    favBtn.click();
    await answer(true);
    expect(isSubscribed(A.id)).toBe(false);
    expect(favBtn.getAttribute('aria-pressed')).toBe('false');
  });
});
