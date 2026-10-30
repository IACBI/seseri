// @vitest-environment jsdom
/**
 * The new-episodes rail on Home.
 *
 * Each row is a `role="button"` that opens the show and starts the episode, and
 * carries a real dismiss button inside it. The row's keydown handler listened
 * for Enter and Space from anywhere in the row, so pressing Enter on the
 * focused dismiss button started the episode instead — and cancelled the click
 * the browser would have made, which left keyboard users with no way to
 * dismiss an item at all.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { FeedRequest } from '../../feeds/types';
import { inbox, type InboxItem } from '../../feeds/inbox';
import { renderShell } from '../shell';
import { initHomeView } from './home';

const ITEM: InboxItem = {
  feedId: 'rss:https://feeds.example.com/new',
  trackId: 'n1',
  title: 'Fresh',
  feedName: 'Show',
  releaseDate: '',
  trackTimeMillis: 0,
  art: '',
  foundAt: 1,
};

let playEpisode: Mock<(req: FeedRequest, trackId: string) => void>;

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  renderShell(document.getElementById('app') as HTMLElement);
  playEpisode = vi.fn<(req: FeedRequest, trackId: string) => void>();
  inbox.set([ITEM]);
  const view = initHomeView({
    openFeed: () => undefined,
    resumeFeed: () => undefined,
    playEpisode,
    checkForNew: async () => undefined,
  });
  view.refresh();
  await settle();
});

function press(target: Element, key: string): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

describe('a new-episode row', () => {
  it('starts the episode when the row itself gets Enter', () => {
    const row = document.querySelector('.home-new-row') as HTMLElement;

    press(row, 'Enter');

    expect(playEpisode).toHaveBeenCalledTimes(1);
  });

  it.each(['Enter', ' '])('leaves %j on the dismiss button to the button', (key) => {
    const dismiss = document.querySelector('.home-new-x') as HTMLElement;

    const e = press(dismiss, key);

    expect(playEpisode).not.toHaveBeenCalled();
    // Not prevented: the click the browser makes from this key is the dismissal.
    expect(e.defaultPrevented).toBe(false);
  });
});
