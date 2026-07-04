import type { FeedRequest, Subscription } from '../../feeds/types';
import { searchPodcasts } from '../../feeds/itunes';
import { ytServiceSearch, type YtSearchItem } from '../../youtube/piped';
import { fmtDur } from '../../lib/format';
import { parseDirectInput, ytFromToken } from '../../feeds/input-parse';
import { t, applyLang, isLangCode } from '../../i18n';
import { httpsOnly } from '../../lib/safe';
import { setSetting, settings } from '../../state/settings';
import { removeSubscription, subscriptions } from '../../storage/subscriptions';
import { h, icon } from '../h';
import { must } from '../shell';

export interface SearchScreenDeps {
  openFeed: (req: FeedRequest) => void;
}

export interface SearchScreen {
  el: HTMLElement;
  show(): void;
  renderFavs(): void;
  focusInput(): void;
}

/** Convert a legacy subscription id into a feed request. */
export function requestFromSubscription(sub: Subscription): FeedRequest | null {
  const s = String(sub.id);
  if (s.startsWith('yt:')) {
    const p = s.split(':'); // yt:<type>:<id>
    const type = p[1];
    const id = p.slice(2).join(':');
    if ((type === 'playlist' || type === 'channel' || type === 'video') && id) {
      return { kind: 'yt', info: { type, id } };
    }
    // Older entries may carry the token instead
    const ref = sub.yt ? ytFromToken(sub.yt) : null;
    return ref ? { kind: 'yt', info: ref } : null;
  }
  if (s.startsWith('rss:')) return { kind: 'rss', url: s.slice(4) };
  return { kind: 'itunes', id: s };
}

export function initSearchScreen(deps: SearchScreenDeps): SearchScreen {
  const screen = must('searchScreen');
  const input = must<HTMLInputElement>('searchInput');
  const btn = must<HTMLButtonElement>('searchBtn');
  const list = must('resultsList');
  const homeLangSel = must<HTMLSelectElement>('homeLangSel');

  let searchAbort: AbortController | null = null;
  let hasSearchResults = false;

  function emptyState(msg: string, isError = false): HTMLElement {
    return h(
      'div',
      { className: 'empty-state', ...(isError ? { style: 'color:var(--red)' } : {}) },
      msg,
    );
  }

  function resultRow(opts: {
    art: string;
    name: string;
    author: string;
    count?: string;
    onOpen: () => void;
    onRemove?: () => void;
  }): HTMLElement {
    const info = h(
      'div',
      { className: 'result-info' },
      h('div', { className: 'result-name' }, opts.name || '—'),
      h('div', { className: 'result-author' }, opts.author || ''),
    );
    if (opts.count) info.append(h('div', { className: 'result-count' }, opts.count));

    const row = h(
      'div',
      { className: 'result-item' },
      h('img', {
        className: 'result-thumb',
        src: httpsOnly(opts.art),
        alt: '',
        attrs: { loading: 'lazy', decoding: 'async' },
      }),
      info,
    );
    if (opts.onRemove) {
      const rm = h(
        'button',
        {
          className: 'ep-dl-btn unfav',
          title: t('fav_btn'),
          attrs: { 'aria-label': t('fav_btn'), 'data-unfav': '1' },
        },
        icon('ic-star', 'icon-fill'),
      );
      row.append(rm);
    } else {
      row.append(h('div', { className: 'result-arrow' }, '›'));
    }
    row.addEventListener('click', (e) => {
      if (opts.onRemove && (e.target as HTMLElement).closest('[data-unfav]')) {
        e.stopPropagation();
        opts.onRemove();
        return;
      }
      opts.onOpen();
    });
    return row;
  }

  async function doSearch(): Promise<void> {
    const raw = input.value.trim();
    if (!raw) return;

    searchAbort?.abort();
    searchAbort = new AbortController();
    const signal = searchAbort.signal;
    const searchTimeout = setTimeout(() => searchAbort?.abort(), 10000);
    const restoreBtn = () => {
      btn.disabled = false;
      btn.textContent = t('btn_search');
    };

    btn.disabled = true;
    btn.textContent = '...';
    list.replaceChildren(emptyState(t('searching')));

    // Direct input: Apple id / YouTube link / RSS URL
    const direct = parseDirectInput(raw);
    if (direct) {
      clearTimeout(searchTimeout);
      restoreBtn();
      list.replaceChildren();
      deps.openFeed(direct);
      return;
    }

    // Podcasts (iTunes) and YouTube are searched in parallel — either side
    // may fail without taking the other down.
    const [pods, yts] = await Promise.allSettled([
      searchPodcasts(raw, signal),
      ytServiceSearch(raw, signal),
    ]);
    clearTimeout(searchTimeout);
    if (signal.aborted) return;
    restoreBtn();

    const podcasts = pods.status === 'fulfilled' ? pods.value : [];
    const ytItems = yts.status === 'fulfilled' ? yts.value : [];

    if (!podcasts.length && !ytItems.length) {
      const err = pods.status === 'rejected' ? (pods.reason as Error).message : '';
      list.replaceChildren(
        err ? emptyState(t('status_err') + err, true) : emptyState(t('no_results')),
      );
      return;
    }

    const frag = document.createDocumentFragment();
    if (podcasts.length) {
      frag.append(h('div', { className: 'search-hint' }, t('sec_podcasts')));
      for (const p of podcasts) {
        frag.append(
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
    if (ytItems.length) {
      frag.append(h('div', { className: 'search-hint' }, t('sec_youtube')));
      for (const y of ytItems.slice(0, 8)) frag.append(ytRow(y));
    }
    list.replaceChildren(frag);
    hasSearchResults = true;
  }

  function ytRow(y: YtSearchItem): HTMLElement {
    const count =
      y.kind === 'video'
        ? fmtDur(y.extra * 1000)
        : y.kind === 'playlist' && y.extra
          ? `${y.extra} ${t('ep_count_unit')}`
          : '';
    return resultRow({
      art: y.thumb,
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

  function renderFavs(): void {
    const favs = subscriptions();
    list.replaceChildren();
    if (!favs.length) return;
    const head = h('div', { className: 'search-hint' });
    const star = icon('ic-star', 'icon-fill');
    star.setAttribute('style', 'width:12px;height:12px;vertical-align:-1px;color:var(--accent)');
    head.append(star, ' ' + t('favs_title'));
    list.append(head);
    for (const f of favs) {
      list.append(
        resultRow({
          art: f.art,
          name: f.name,
          author: f.artist,
          onOpen: () => {
            const req = requestFromSubscription(f);
            if (req) deps.openFeed(req);
          },
          onRemove: () => {
            removeSubscription(f.id);
            renderFavs();
          },
        }),
      );
    }
  }

  // Events
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void doSearch();
  });
  btn.addEventListener('click', () => void doSearch());
  homeLangSel.addEventListener('change', () => {
    const lang = homeLangSel.value;
    if (isLangCode(lang)) {
      setSetting('lang', lang);
      applyLang(lang);
    }
  });
  settings.subscribe((S) => {
    homeLangSel.value = S.lang;
  });

  return {
    el: screen,
    show() {
      screen.classList.remove('screen-enter');
      void screen.offsetWidth;
      screen.classList.add('screen-enter');
      if (!hasSearchResults) renderFavs();
    },
    renderFavs,
    focusInput: () => input.focus(),
  };
}
