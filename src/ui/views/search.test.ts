// @vitest-environment jsdom
/**
 * The search box's own 30 s timeout.
 *
 * It aborted `searchAbort` — whichever search was current when the timer fired,
 * not the one that started it — and a search it did abort was treated like one
 * the listener abandoned: the button stayed disabled on "…" and the spinner
 * stayed up, with no error to retry from.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchResult } from '../../feeds/types';

interface Pending {
  signal: AbortSignal;
  resolve(rows: SearchResult[]): void;
}

const pending = vi.hoisted((): Pending[] => []);
const searchPodcasts = vi.hoisted(() => vi.fn());
vi.mock('../../feeds/itunes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../feeds/itunes')>()),
  searchPodcasts,
}));

import { renderShell } from '../shell';
import { initSearchView } from './search';

const ROW: SearchResult = {
  collectionId: 1234567,
  collectionName: 'Found It',
  artistName: 'Someone',
  artworkUrl100: '',
};

let input: HTMLInputElement;
let button: HTMLButtonElement;
let list: HTMLElement;

function search(term: string): void {
  input.value = term;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
}

beforeEach(() => {
  pending.length = 0;
  searchPodcasts.mockReset();
  searchPodcasts.mockImplementation(
    (_term: string, signal: AbortSignal) =>
      new Promise<SearchResult[]>((resolve, reject) => {
        pending.push({ signal, resolve });
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
  );
  document.body.innerHTML = '<div id="app"></div>';
  renderShell(document.getElementById('app') as HTMLElement);
  initSearchView({ openFeed: () => undefined });
  input = document.getElementById('searchInput') as HTMLInputElement;
  button = document.getElementById('searchBtn') as HTMLButtonElement;
  list = document.getElementById('resultsList') as HTMLElement;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a search that never answers', () => {
  it('ends in an error with the button usable again', async () => {
    search('history');
    expect(button.disabled).toBe(true);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(button.disabled).toBe(false);
    expect(list.getAttribute('aria-busy')).toBe('false');
    expect(list.querySelector('.empty-state--error')).not.toBeNull();
  });

  it('is not cut short by the timer of an earlier search', async () => {
    search('first');
    await vi.advanceTimersByTimeAsync(20_000);
    search('second'); // replaces the first, which is abandoned
    expect(pending[0]?.signal.aborted).toBe(true);

    // The first search's 30 s mark: the second has been running for 10.
    await vi.advanceTimersByTimeAsync(11_000);
    expect(pending[1]?.signal.aborted).toBe(false);

    pending[1]?.resolve([ROW]);
    await vi.advanceTimersByTimeAsync(0);

    expect(list.textContent).toContain('Found It');
    expect(button.disabled).toBe(false);
  });
});
