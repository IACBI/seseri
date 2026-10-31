// @vitest-environment jsdom
/**
 * A first visit, with nothing listened to and nothing followed, has to offer a
 * way in. It used to be two lines of grey text and nothing to press.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { LangKey } from '../../i18n/types';
import { inbox } from '../../feeds/inbox';
import { TOPIC_KEYS } from '../../feeds/topics';
import { renderShell } from '../shell';
import { initHomeView } from './home';
import type { ContinueItem } from '../data/continue-listening';

const continuing = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock('../data/continue-listening', async (orig) => ({
  ...(await orig<typeof import('../data/continue-listening')>()),
  continueListening: vi.fn(async () => continuing.items as ContinueItem[]),
}));

let openSearch: Mock<(topic?: LangKey) => void>;

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

async function mount(): Promise<void> {
  document.body.innerHTML = '<div id="app"></div>';
  renderShell(document.getElementById('app') as HTMLElement);
  inbox.set([]);
  openSearch = vi.fn<(topic?: LangKey) => void>();
  const view = initHomeView({
    openFeed: () => undefined,
    resumeFeed: () => undefined,
    playEpisode: () => undefined,
    checkForNew: async () => undefined,
    openSearch,
  });
  view.refresh();
  await settle();
}

beforeEach(async () => {
  localStorage.clear();
  continuing.items = [];
  await mount();
});

describe('the first-run home', () => {
  it('offers a search', () => {
    const cta = document.querySelector('.home-first-cta') as HTMLButtonElement;
    expect(cta).not.toBeNull();
    cta.click();
    expect(openSearch).toHaveBeenCalledWith();
  });

  it('offers every topic, each opening Search on it', () => {
    const chips = [...document.querySelectorAll<HTMLButtonElement>('.home-topics button')];
    expect(chips).toHaveLength(TOPIC_KEYS.length);
    chips[1]?.click();
    expect(openSearch).toHaveBeenCalledWith(TOPIC_KEYS[1]);
  });

  it('titles itself as a heading', () => {
    expect(document.querySelector('.home-first-run h2')?.textContent).toBeTruthy();
  });
});

describe('home with history but no subscriptions', () => {
  it('still offers a way to find another show, without claiming nothing was heard', async () => {
    const item: ContinueItem = {
      feed: { id: 'rss:https://feeds.example.com/a', name: 'Show', artist: 'Host', art: '' },
      req: { kind: 'rss', url: 'https://feeds.example.com/a' },
      episode: {
        trackId: 'e1',
        trackName: 'One',
        episodeUrl: 'https://cdn.example.com/1.mp3',
      } as ContinueItem['episode'],
      positionSec: 30,
      percent: 5,
    };
    continuing.items = [item];
    await mount();
    const blocks = document.querySelectorAll('.home-first-run');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.querySelector('.home-first-cta')).not.toBeNull();
    expect(blocks[0]!.querySelectorAll('.home-topics button')).toHaveLength(TOPIC_KEYS.length);
    expect(blocks[0]!.querySelector('.home-first-title')).toBeNull();
  });
});
