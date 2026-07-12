/**
 * Library view — two tabs: subscriptions / downloads.
 * Subscriptions come from the storage/subscriptions signal (live); downloads
 * from storage/db (async, refreshed on every onShow). Removing a download also
 * evicts its cached audio via player/offline.removeDownload.
 */

import type { FeedRequest, Subscription } from '../../feeds/types';
import type { DownloadRecord } from '../../storage/db';
import { httpsOnly } from '../../lib/safe';
import { fmtBytes, fmtDate } from '../../lib/format';
import { currentLang, t } from '../../i18n';
import { removeSubscription, subscriptions } from '../../storage/subscriptions';
import { listDownloads } from '../../storage/db';
import { removeDownload, storageInfo, type StorageInfo } from '../../player/offline';
import { requestFromSubscription } from '../data/continue-listening';
import { confirmDialog } from '../confirm';
import { toast } from '../toast';
import { h, icon } from '../h';
import { registerView, viewEl, type View } from '../views';

export interface LibraryViewDeps {
  openFeed(req: FeedRequest): void;
}

type TabName = 'subs' | 'downloads';

/** Remembered across shows for the session (module lives as long as the app). */
let activeTab: TabName = 'subs';

export function initLibraryView(deps: LibraryViewDeps): View {
  const el = viewEl('library');
  el.innerHTML = `
    <div class="view-inner">
      <h1 class="view-title" data-i18n="nav_library">Kütüphane</h1>
      <div class="tabs" role="tablist" data-i18n-aria="nav_library">
        <button type="button" class="tab" role="tab" id="lib-tab-subs"
          aria-controls="lib-panel-subs" data-i18n="lib_tab_subs">Abonelikler</button>
        <button type="button" class="tab" role="tab" id="lib-tab-downloads"
          aria-controls="lib-panel-downloads" data-i18n="lib_tab_downloads">İndirilenler</button>
      </div>
      <div class="lib-panel" role="tabpanel" id="lib-panel-subs" aria-labelledby="lib-tab-subs"></div>
      <div class="lib-panel" role="tabpanel" id="lib-panel-downloads" aria-labelledby="lib-tab-downloads" hidden></div>
    </div>`;

  const subsTab = el.querySelector<HTMLButtonElement>('#lib-tab-subs')!;
  const dlTab = el.querySelector<HTMLButtonElement>('#lib-tab-downloads')!;
  const subsPanel = el.querySelector<HTMLDivElement>('#lib-panel-subs')!;
  const dlPanel = el.querySelector<HTMLDivElement>('#lib-panel-downloads')!;
  const tabs = [subsTab, dlTab];

  // ── tab state ────────────────────────────────────────────────────
  function selectTab(name: TabName, focus = false): void {
    activeTab = name;
    for (const [tabEl, tabName] of [
      [subsTab, 'subs'],
      [dlTab, 'downloads'],
    ] as const) {
      const on = tabName === name;
      tabEl.setAttribute('aria-selected', String(on));
      tabEl.tabIndex = on ? 0 : -1;
    }
    subsPanel.hidden = name !== 'subs';
    dlPanel.hidden = name !== 'downloads';
    if (focus) (name === 'subs' ? subsTab : dlTab).focus();
  }

  function onTabKey(e: KeyboardEvent, idx: number): void {
    const rtl = document.documentElement.getAttribute('dir') === 'rtl';
    let next: number;
    if (e.key === 'ArrowRight') next = rtl ? idx - 1 : idx + 1;
    else if (e.key === 'ArrowLeft') next = rtl ? idx + 1 : idx - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    next = (next + tabs.length) % tabs.length;
    selectTab(next === 0 ? 'subs' : 'downloads', true);
  }

  subsTab.addEventListener('click', () => selectTab('subs'));
  dlTab.addEventListener('click', () => selectTab('downloads'));
  tabs.forEach((tabEl, i) => tabEl.addEventListener('keydown', (e) => onTabKey(e, i)));

  // ── subscriptions tab ────────────────────────────────────────────
  function subRow(f: Subscription) {
    const art = httpsOnly(f.art);
    const star = h('button', {
      className: 'icon-btn faved',
      type: 'button',
      title: t('fav_btn'),
      attrs: { 'aria-label': t('fav_btn') },
      on: {
        click: async (e) => {
          e.stopPropagation();
          if (await confirmDialog('confirm_unsubscribe')) removeSubscription(f.id);
          // the subscriptions signal drives the re-render (see subscribe below)
        },
      },
    }, icon('ic-star'));

    const activate = (): void => {
      const req = requestFromSubscription(f);
      if (req) deps.openFeed(req);
    };

    return h(
      'div',
      {
        className: 'row',
        role: 'button',
        tabIndex: 0,
        on: {
          click: activate,
          keydown: (e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              activate();
            }
          },
        },
      },
      art
        ? h('img', { className: 'row-art', src: art, alt: '' })
        : h('div', { className: 'row-art' }),
      h(
        'div',
        { className: 'row-info' },
        h('div', { className: 'row-name' }, f.name),
        f.artist ? h('div', { className: 'row-sub' }, f.artist) : null,
      ),
      star,
    );
  }

  function renderSubs(): void {
    const list = subscriptions();
    subsPanel.replaceChildren();
    if (list.length === 0) {
      subsPanel.append(
        h(
          'div',
          { className: 'empty-state' },
          h('div', {}, t('lib_empty_subs')),
          h('div', { className: 'empty-state-hint' }, t('lib_empty_subs_hint')),
        ),
      );
      return;
    }
    for (const f of list) subsPanel.append(subRow(f));
  }

  // ── downloads tab ────────────────────────────────────────────────
  let dlRecords: DownloadRecord[] = [];
  let dlStorage: StorageInfo | null = null;

  function dlRow(rec: DownloadRecord) {
    const trash = h('button', {
      className: 'icon-btn',
      type: 'button',
      title: t('dl_label'),
      attrs: { 'aria-label': t('dl_label') },
      on: {
        click: async () => {
          await removeDownload(rec.id);
          await refreshDownloads();
          toast(t('dl_removed'));
        },
      },
    }, icon('ic-trash'));

    return h(
      'div',
      { className: 'row lib-dl-row' },
      h('div', { className: 'row-art lib-dl-icon' }, icon('ic-download')),
      h(
        'div',
        { className: 'row-info' },
        h('div', { className: 'row-name' }, rec.title),
        h(
          'div',
          { className: 'row-sub' },
          fmtBytes(rec.bytes) + ' · ' + fmtDate(new Date(rec.addedAt).toISOString()),
        ),
      ),
      trash,
    );
  }

  function renderDownloads(): void {
    dlPanel.replaceChildren();
    if (dlRecords.length === 0) {
      dlPanel.append(h('div', { className: 'empty-state' }, t('lib_empty_downloads')));
      return;
    }
    const totalBytes = dlRecords.reduce((a, d) => a + d.bytes, 0);
    dlPanel.append(
      h(
        'div',
        { className: 'lib-dl-summary' },
        t('lib_dl_total', dlRecords.length, fmtBytes(totalBytes)),
      ),
    );
    if (dlStorage && dlStorage.quotaBytes > 0) {
      dlPanel.append(
        h(
          'div',
          { className: 'lib-dl-usage' },
          t('storage_usage', fmtBytes(dlStorage.usageBytes), fmtBytes(dlStorage.quotaBytes)),
        ),
      );
    }
    for (const rec of dlRecords) dlPanel.append(dlRow(rec));
  }

  async function refreshDownloads(): Promise<void> {
    const [recs, info] = await Promise.all([listDownloads(), storageInfo()]);
    dlRecords = recs.sort((a, b) => b.addedAt - a.addedAt);
    dlStorage = info;
    renderDownloads();
  }

  // ── live updates ─────────────────────────────────────────────────
  subscriptions.subscribe(() => renderSubs());
  currentLang.subscribe(() => {
    renderSubs();
    renderDownloads();
  });

  selectTab(activeTab);
  renderSubs();

  const view: View = {
    name: 'library',
    el,
    focusTarget: () => (activeTab === 'subs' ? subsTab : dlTab),
    onShow() {
      selectTab(activeTab);
      renderSubs();
      void refreshDownloads();
    },
  };
  registerView(view);
  return view;
}
