// @vitest-environment jsdom
/**
 * The ways a search can stop without answering.
 *
 * `settle()` returned early for any aborted search, which is right when a newer
 * search replaced it and wrong for the two other aborts: the 30 s deadline
 * (the "Searching…" box and the disabled button stayed for good) and the reader
 * clearing the box (the button stayed disabled, showing "…", over a screen that
 * had already gone back to the topics).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const searchPodcasts = vi.hoisted(() => vi.fn());
vi.mock('../../feeds/itunes', () => ({ searchPodcasts }));

import { renderShell } from '../shell';
import { initSearchView } from './search';

/** A request that only ends when it is aborted. */
function hang(_term: string, signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
}

let input: HTMLInputElement;
let btn: HTMLButtonElement;
let list: HTMLElement;

/** Enter, not the button: a running search disables the button but not the box. */
function submit(term: string): void {
  input.value = term;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

async function tick(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  renderShell(document.getElementById('app') as HTMLElement);
  searchPodcasts.mockReset();
  searchPodcasts.mockImplementation(hang);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  initSearchView({ openFeed: vi.fn() });
  input = document.getElementById('searchInput') as HTMLInputElement;
  btn = document.getElementById('searchBtn') as HTMLButtonElement;
  list = document.getElementById('resultsList') as HTMLElement;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a search that never answers', () => {
  it('ends in an error with a retry at the deadline', async () => {
    submit('hello');
    expect(btn.disabled).toBe(true);

    await tick(30_001);

    expect(list.querySelector('.empty-state--error')).not.toBeNull();
    expect(list.querySelector('.retry-btn')).not.toBeNull();
    expect(btn.disabled).toBe(false);
    expect(list.getAttribute('aria-busy')).toBe('false');
  });

  it("is not cut short by the previous search's timer", async () => {
    // The second search answers 25 s after it starts.
    searchPodcasts.mockImplementation((term: string, signal: AbortSignal) => {
      if (term !== 'second') return hang(term, signal);
      return new Promise((resolve, reject) => {
        const answer = setTimeout(
          () =>
            resolve([
              {
                collectionId: 1,
                collectionName: 'Second show',
                artistName: 'A',
                artworkUrl100: '',
              },
            ]),
          25_000,
        );
        signal.addEventListener('abort', () => {
          clearTimeout(answer);
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    });
    submit('first');
    await tick(10_000);
    submit('second');

    // The first search's 30 s runs out at 30 000 ms; the second answers at 35 000.
    await tick(25_001);

    expect(list.textContent).toContain('Second show');
    expect(list.querySelector('.empty-state--error')).toBeNull();
  });
});

describe('clearing the box mid-search', () => {
  it('frees the button the aborted search had disabled', async () => {
    submit('hello');
    expect(btn.disabled).toBe(true);

    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    expect(btn.disabled).toBe(false);
    expect(btn.textContent).not.toBe('...');
    expect(list.getAttribute('aria-busy')).toBe('false');
  });
});
