/**
 * Search view — iTunes search + URL/RSS/YouTube paste, progressive dual-source
 * results. Ported from `git show ed59840:src/ui/screens/search.ts`, re-skinned
 * onto the "Sinyal" design system. Favorites moved to Home/Library, so the
 * legacy fav rendering + unfav row variant + language selector are gone.
 * Element IDs kept for the smoke-test contract: searchInput, searchBtn,
 * resultsList.
 */

import type { FeedRequest } from '../../feeds/types';
import { searchPodcasts } from '../../feeds/itunes';
import { ytServiceSearch, type YtSearchItem } from '../../youtube/piped';
import { fmtDur } from '../../lib/format';
import { parseDirectInput } from '../../feeds/input-parse';
import { t } from '../../i18n';
import { httpsOnly } from '../../lib/safe';
import { h } from '../h';
import { stateBox } from '../states';
import { must } from '../shell';
import { registerView, viewEl, type View } from '../views';

export interface SearchViewDeps {
  openFeed(req: FeedRequest): void;
}

export interface SearchView extends View {
  focusInput(): void;
  /** Return keyboard focus to the row/input that opened a feed (back nav). */
  restoreFocus(): void;
}

export function initSearchView(deps: SearchViewDeps): SearchView {
  const el = viewEl('search');
  el.innerHTML = `
    <div class="view-inner search-inner">
      <h1 class="view-title search-title" data-i18n="nav_search">Ara</h1>
      <div class="search-row">
        <input class="text-input search-input" id="searchInput" type="text"
          placeholder="Podcast adı, Apple Podcasts veya YouTube linki..." data-i18n-ph="search_placeholder" />
        <button class="btn btn-primary search-btn" id="searchBtn" data-i18n="btn_search">Ara →</button>
      </div>
      <div class="results-list" id="resultsList" aria-live="polite"></div>
    </div>`;

  const input = must<HTMLInputElement>('searchInput');
  const btn = must<HTMLButtonElement>('searchBtn');
  const list = must('resultsList');

  let searchAbort: AbortController | null = null;
  // The row the user activated to open a feed — restored on back navigation.
  let lastFocusedRow: HTMLElement | null = null;

  /** Artwork img with a calm placeholder fallback (missing art / dead CDN). */
  function rowArt(art: string): HTMLElement {
    const src = httpsOnly(art);
    if (!src) return h('div', { className: 'row-art' });
    const img = h('img', {
      className: 'row-art',
      src,
      alt: '',
      attrs: { loading: 'lazy', decoding: 'async' },
    });
    img.addEventListener('error', () => img.replaceWith(h('div', { className: 'row-art' })), {
      once: true,
    });
    return img;
  }

  function resultRow(opts: {
    art: string;
    name: string;
    author: string;
    count?: string;
    onOpen: () => void;
  }): HTMLElement {
    const row = h(
      'div',
      { className: 'row', role: 'button', tabIndex: 0 },
      rowArt(opts.art),
      h(
        'div',
        { className: 'row-info' },
        h('div', { className: 'row-name' }, opts.name || '—'),
        h('div', { className: 'row-sub' }, opts.author || ''),
      ),
      opts.count ? h('div', { className: 'row-meta' }, opts.count) : null,
    );
    row.addEventListener('click', () => {
      lastFocusedRow = row;
      opts.onOpen();
    });
    row.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      lastFocusedRow = row;
      opts.onOpen();
    });
    return row;
  }

  function ytRow(y: YtSearchItem): HTMLElement {
    const count =
      y.kind === 'video'
        ? fmtDur(y.extra * 1000)
        : y.kind === 'playlist' && y.extra
          ? `${y.extra} ${t('ep_count_unit')}`
          : '';
    // Piped instances proxy thumbnails through themselves and are often dead —
    // for videos the official CDN is deterministic from the id and reliable.
    const art = y.kind === 'video' ? `https://i.ytimg.com/vi/${y.id}/mqdefault.jpg` : y.thumb;
    return resultRow({
      art,
      name: y.title,
      author: y.author || 'YouTube',
      ...(count ? { count } : {}),
      onOpen: () =>
        deps.openFeed({
          kind: 'yt',
          info: { type: y.kind === 'video' ? 'video' : y.kind, id: y.id },
        }),
    });
  }

  async function doSearch(): Promise<void> {
    const raw = input.value.trim();
    if (!raw) return;

    searchAbort?.abort();
    searchAbort = new AbortController();
    const signal = searchAbort.signal;
    // Generous: a cold worker-side YouTube search can take 15 s+; podcasts
    // render progressively long before this fires.
    const searchTimeout = setTimeout(() => searchAbort?.abort(), 30000);
    const restoreBtn = () => {
      btn.disabled = false;
      btn.textContent = t('btn_search');
    };

    btn.disabled = true;
    btn.textContent = '...';
    list.setAttribute('aria-busy', 'true');
    list.replaceChildren(stateBox('loading', t('searching')));

    // Direct input: Apple id / YouTube link / RSS URL
    const direct = parseDirectInput(raw);
    if (direct) {
      clearTimeout(searchTimeout);
      restoreBtn();
      list.setAttribute('aria-busy', 'false');
      list.replaceChildren();
      deps.openFeed(direct);
      return;
    }

    // Podcasts (iTunes) and YouTube are searched in parallel and rendered
    // PROGRESSIVELY: podcasts usually land in ~2 s, a cold YouTube search can
    // take 15 s+ — neither waits for (or is taken down by) the other.
    const podsBox = h('div');
    const ytBox = h('div');
    let podsDone = false;
    let ytDone = false;
    let podsErr = '';
    const settle = (): void => {
      if (signal.aborted) return;
      if (podsDone) restoreBtn(); // main path answered — button is usable again
      if (!podsDone || !ytDone) return;
      clearTimeout(searchTimeout);
      list.setAttribute('aria-busy', 'false');
      if (!podsBox.hasChildNodes() && !ytBox.hasChildNodes()) {
        list.replaceChildren(
          podsErr
            ? stateBox('error', t('status_err') + podsErr, { onRetry: () => void doSearch() })
            : stateBox('empty', t('no_results')),
        );
      }
    };
    const searching = stateBox('loading', t('searching'));
    list.replaceChildren(searching, podsBox, ytBox);

    void searchPodcasts(raw, signal)
      .then((podcasts) => {
        if (signal.aborted) return;
        if (podcasts.length) {
          searching.remove();
          podsBox.append(h('div', { className: 'search-hint' }, t('sec_podcasts')));
          for (const p of podcasts) {
            podsBox.append(
              resultRow({
                art: p.artworkUrl100,
                name: p.collectionName,
                author: p.artistName,
                count: `${p.trackCount ?? '?'} ${t('ep_count_unit')}`,
                onOpen: () => deps.openFeed({ kind: 'itunes', id: String(p.collectionId) }),
              }),
            );
          }
        }
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') podsErr = e.message;
      })
      .finally(() => {
        podsDone = true;
        settle();
      });

    void ytServiceSearch(raw, signal)
      .then((ytItems) => {
        if (signal.aborted || !ytItems.length) return;
        searching.remove();
        ytBox.append(h('div', { className: 'search-hint' }, t('sec_youtube')));
        for (const y of ytItems.slice(0, 8)) ytBox.append(ytRow(y));
      })
      .catch(() => {
        /* YouTube side is best-effort */
      })
      .finally(() => {
        ytDone = true;
        settle();
      });
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void doSearch();
  });
  btn.addEventListener('click', () => void doSearch());

  const view: SearchView = {
    name: 'search',
    el,
    focusTarget: () => input,
    focusInput: () => input.focus(),
    restoreFocus() {
      if (lastFocusedRow?.isConnected) lastFocusedRow.focus({ preventScroll: false });
      else input.focus({ preventScroll: false });
      lastFocusedRow = null;
    },
  };
  registerView(view);
  return view;
}
