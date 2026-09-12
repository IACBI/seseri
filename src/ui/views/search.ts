/**
 * Search view — iTunes search + Apple/RSS URL paste
 * results. Ported from `git show ed59840:src/ui/screens/search.ts`, re-skinned
 * onto the "Sinyal" design system. Favorites moved to Home/Library, so the
 * legacy fav rendering + unfav row variant + language selector are gone.
 * Element IDs kept for the smoke-test contract: searchInput, searchBtn,
 * resultsList.
 */

import type { FeedRequest, SearchResult } from '../../feeds/types';
import type { LangKey } from '../../i18n/types';
import { searchPodcasts } from '../../feeds/itunes';
import { TOPIC_KEYS, topicShows } from '../../feeds/topics';
import { parseDirectInput } from '../../feeds/input-parse';
import { currentLang, t } from '../../i18n';
import { artTile, ROW_ART_PX } from '../art-tile';
import { h } from '../h';
import { stateBox } from '../states';
import { must } from '../shell';
import { registerView, viewEl, type View } from '../views';

export interface SearchViewDeps {
  openFeed(req: FeedRequest): void;
}

export function initSearchView(deps: SearchViewDeps): View {
  const el = viewEl('search');
  el.innerHTML = `
    <div class="view-inner search-inner">
      <h1 class="view-title search-title" data-i18n="nav_search">Ara</h1>
      <div class="search-row">
        <input class="text-input search-input" id="searchInput" type="text"
          placeholder="Podcast adı, Apple Podcasts linki veya RSS adresi..." data-i18n-ph="search_placeholder" />
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

  /**
   * The topic the reader last looked at, and what it found.
   *
   * The search screen opened on nothing at all, which is the one screen a
   * podcast app should not open on: a listener who does not already know what
   * they want had no way in. Results are kept for the session so moving between
   * topics is instant, and dropped when the language changes — the topics are
   * search terms in that language, against that storefront.
   */
  const topicCache = new Map<string, SearchResult[]>();
  let topicLang = '';
  let openTopic: LangKey | null = null;
  let topicAbort: AbortController | null = null;

  /** Artwork img with a calm placeholder fallback (missing art / dead CDN). */
  function rowArt(art: string): HTMLElement {
    return artTile('row-art', art, ROW_ART_PX);
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

  /** The chips, and whatever the open one found. Rebuilt on every change. */
  function renderTopics(state: 'idle' | 'loading' | 'error' = 'idle'): void {
    if (input.value.trim()) return; // the reader has moved on to searching
    const box = h('div');
    box.append(h('div', { className: 'search-hint' }, t('sec_browse')));

    const chips = h('div', { className: 'topic-row', attrs: { role: 'group' } });
    for (const key of TOPIC_KEYS) {
      const on = key === openTopic;
      chips.append(
        h(
          'button',
          {
            className: 'p-mode topic-chip' + (on ? ' active' : ''),
            type: 'button',
            attrs: { 'aria-pressed': String(on) },
            on: { click: () => openTopicNamed(key) },
          },
          t(key),
        ),
      );
    }
    box.append(chips);

    const rows = openTopic ? topicCache.get(t(openTopic)) : undefined;
    if (state === 'loading') box.append(stateBox('loading', t('searching')));
    else if (state === 'error' && openTopic) {
      const retry = openTopic;
      box.append(stateBox('error', t('no_results'), { onRetry: () => openTopicNamed(retry) }));
    } else if (rows?.length) {
      for (const p of rows) {
        box.append(
          resultRow({
            art: p.artworkUrl100,
            name: p.collectionName,
            author: p.artistName,
            count: `${p.trackCount ?? '?'} ${t('ep_count_unit')}`,
            onOpen: () => deps.openFeed({ kind: 'itunes', id: String(p.collectionId) }),
          }),
        );
      }
    } else if (rows) {
      box.append(stateBox('empty', t('no_results')));
    }

    list.replaceChildren(box);
  }

  /** Tapping the open topic closes it, so the chips are a toggle, not a mode. */
  function openTopicNamed(key: LangKey): void {
    topicAbort?.abort();
    if (openTopic === key && topicCache.has(t(key))) {
      openTopic = null;
      renderTopics();
      return;
    }
    openTopic = key;
    const term = t(key);
    if (topicCache.has(term)) {
      renderTopics();
      return;
    }
    renderTopics('loading');
    topicAbort = new AbortController();
    const signal = topicAbort.signal;
    void topicShows(term, signal)
      .then((rows) => {
        if (signal.aborted) return;
        topicCache.set(term, rows);
        renderTopics();
      })
      .catch((e: Error) => {
        if (e.name === 'AbortError' || signal.aborted) return;
        renderTopics('error');
      });
  }

  /** What the screen shows before anything has been typed. */
  function showBrowse(): void {
    if (topicLang !== currentLang()) {
      topicLang = currentLang();
      topicCache.clear();
      openTopic = null;
    }
    renderTopics();
  }

  async function doSearch(): Promise<void> {
    const raw = input.value.trim();
    if (!raw) return;

    searchAbort?.abort();
    searchAbort = new AbortController();
    const signal = searchAbort.signal;
    // Generous: the iTunes proxy can be slow on a cold worker; podcasts
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

    // Direct input: Apple id / RSS URL
    const direct = parseDirectInput(raw);
    if (direct) {
      clearTimeout(searchTimeout);
      restoreBtn();
      list.setAttribute('aria-busy', 'false');
      list.replaceChildren();
      deps.openFeed(direct);
      return;
    }

    const podsBox = h('div');
    let podsDone = false;
    let podsErr = '';
    const settle = (): void => {
      if (signal.aborted) return;
      if (!podsDone) return;
      restoreBtn();
      clearTimeout(searchTimeout);
      list.setAttribute('aria-busy', 'false');
      if (!podsBox.hasChildNodes()) {
        list.replaceChildren(
          podsErr
            ? stateBox('error', t('status_err') + podsErr, { onRetry: () => void doSearch() })
            : stateBox('empty', t('no_results')),
        );
      }
    };
    const searching = stateBox('loading', t('searching'));
    list.replaceChildren(searching, podsBox);

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
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void doSearch();
  });
  btn.addEventListener('click', () => void doSearch());
  input.addEventListener('input', () => {
    if (input.value.trim()) return;
    // Cleared the box: back to the topics rather than to an empty screen.
    searchAbort?.abort();
    showBrowse();
  });
  // The topics are search terms in the interface language, against that
  // language's storefront, so both the labels and the results change with it.
  currentLang.subscribe(() => {
    if (!input.value.trim()) showBrowse();
  });

  const view: View = {
    name: 'search',
    el,
    /**
     * Coming back from a feed lands on the row that opened it rather than the
     * search box, so the keyboard position is not lost. This used to be a
     * separate `restoreFocus()` that nothing ever called; folding it into the
     * focus target the view registry already consults makes it actually run.
     */
    focusTarget() {
      const row = lastFocusedRow?.isConnected ? lastFocusedRow : null;
      lastFocusedRow = null;
      return row ?? input;
    },
    onShow() {
      if (!input.value.trim()) showBrowse();
    },
  };
  registerView(view);
  return view;
}
