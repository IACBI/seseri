/**
 * Settings view — playback, appearance (theme + dynamic accent swatches from
 * theme.ts ACCENT_SWATCHES), list, language, data sections. Ported from the
 * retired <dialog> panel: markup `ed59840:src/ui/shell.ts` (SETTINGS_PANEL) +
 * logic `ed59840:src/ui/screens/settings.ts`, now a plain page view.
 *
 * Keeps the legacy element IDs and data-i18n keys, keeps writing the
 * --player-font-size / --list-row-height side-effect tokens on documentElement.
 */

import { currentLang, t } from '../../i18n';
import type { LangKey } from '../../i18n/types';
import { createLangMenu } from '../lang-menu';
import {
  forgetRemote,
  linkSync,
  startSync,
  syncNow,
  syncState,
  unlinkSync,
  type SyncState,
  type SyncStatus,
} from '../../sync';
import { formatCode } from '../../sync/code';
import { SYNC_AVAILABLE } from '../../sync/transport';
import { clearAllDownloads, storageInfo } from '../../player/offline';
import { clearPlayed } from '../../storage/played';
import { clearFeedSpeeds, feedSpeedCount, feedSpeedRevision } from '../../state/feed-speed';
import { clearProgress, saveProgressNow } from '../../storage/progress';
import { hardReset } from '../../storage/reset';
import { exportBackup, restoreBackup } from '../../storage/backup';
import { exportOpml, parseOpml } from '../../storage/opml';
import { subscriptions, toggleSubscription, isSubscribed } from '../../storage/subscriptions';
import { pbSetRate } from '../../player/engine';
import {
  settings,
  setSetting,
  type PrefetchMode,
  type Settings,
  type SortDir,
  type ThemeName,
} from '../../state/settings';
import { fmtBytes } from '../../lib/format';
import { collectDiagnostics } from '../../lib/diagnostics';
import { feedCacheInfo } from '../../storage/db';
import { toast } from '../toast';
import { confirmDialog } from '../confirm';
import { ACCENT_SWATCHES, normalizeAccent, applyAccent, applyTheme } from '../theme';
import { registerView, viewEl, type View } from '../views';
import { h } from '../h';

export interface SettingsViewDeps {
  onDataCleared(): void;
}

const MARKUP = `
<div class="view-inner settings-inner">
  <h1 class="view-title" data-i18n="settings_heading">Ayarlar</h1>

  <section class="s-section">
    <div class="s-section-title" data-i18n="s_playback">Oynatma</div>

    <div class="s-row">
      <div>
        <div class="s-label" data-i18n="s_default_speed">Varsayılan Hız</div>
        <div class="s-sublabel" data-i18n="s_speed_sub">Bölümler arası korunur</div>
      </div>
      <select class="s-select" id="s_defaultSpeed">
        <option value="0.5">0.5×</option>
        <option value="0.75">0.75×</option>
        <option value="1" selected>1×</option>
        <option value="1.25">1.25×</option>
        <option value="1.5">1.5×</option>
        <option value="1.75">1.75×</option>
        <option value="2">2×</option>
        <option value="2.5">2.5×</option>
      </select>
    </div>

    <div class="s-row">
      <div>
        <div class="s-label" data-i18n="s_feed_speeds">Şova özel hızlar</div>
        <div class="s-sublabel" id="feedSpeedInfo"></div>
      </div>
      <button class="s-btn" id="btnResetFeedSpeeds" data-i18n="btn_reset_feed_speeds">Sıfırla</button>
    </div>

    <div class="s-row">
      <div><div class="s-label" data-i18n="s_skip_back">Geri Atla (saniye)</div></div>
      <select class="s-select" id="s_skipBack">
        <option value="5">5s</option>
        <option value="10">10s</option>
        <option value="15" selected>15s</option>
        <option value="30">30s</option>
        <option value="60">60s</option>
      </select>
    </div>

    <div class="s-row">
      <div><div class="s-label" data-i18n="s_skip_fwd">İleri Atla (saniye)</div></div>
      <select class="s-select" id="s_skipForward">
        <option value="10">10s</option>
        <option value="15">15s</option>
        <option value="30" selected>30s</option>
        <option value="45">45s</option>
        <option value="60">60s</option>
        <option value="90">90s</option>
      </select>
    </div>

    <div class="s-row">
      <div><div class="s-label" data-i18n="s_auto_next">Otomatik Sonraki Bölüm</div></div>
      <label class="s-toggle">
        <input type="checkbox" id="s_autoNext" checked>
        <span class="s-toggle-track"></span>
      </label>
    </div>

    <div class="s-row">
      <div><div class="s-label" data-i18n="s_resume">Kaldığım Yerden Devam</div></div>
      <label class="s-toggle">
        <input type="checkbox" id="s_resumePos" checked>
        <span class="s-toggle-track"></span>
      </label>
    </div>
  </section>

  <section class="s-section">
    <div class="s-section-title" data-i18n="s_appearance">Görünüm</div>

    <div class="s-row">
      <div><div class="s-label" data-i18n="s_accent">Vurgu Rengi</div></div>
    </div>
    <div class="s-color-row" id="colorSwatches"></div>

    <div class="s-row">
      <div><div class="s-label" data-i18n="s_font_size">Yazı Boyutu</div></div>
      <select class="s-select" id="s_fontSize">
        <option value="11px" data-i18n="size_small">Küçük</option>
        <option value="13px" selected data-i18n="size_normal">Normal</option>
        <option value="15px" data-i18n="size_large">Büyük</option>
        <option value="17px" data-i18n="size_xlarge">Çok Büyük</option>
      </select>
    </div>

    <div class="s-row">
      <div><div class="s-label" data-i18n="s_row_height">Liste Satır Yüksekliği</div></div>
      <select class="s-select" id="s_rowHeight">
        <option value="42px" data-i18n="row_compact">Sıkı</option>
        <option value="54px" selected data-i18n="size_normal">Normal</option>
        <option value="66px" data-i18n="row_spacious">Geniş</option>
      </select>
    </div>

    <div class="s-row">
      <div><div class="s-label" data-i18n="s_theme_label">Karanlık / Açık Tema</div></div>
      <select class="s-select" id="s_theme">
        <option value="auto" selected data-i18n="theme_auto">Otomatik (sistem)</option>
        <option value="dark" data-i18n="theme_dark">Karanlık</option>
        <option value="light" data-i18n="theme_light">Açık</option>
        <option value="oled" data-i18n="theme_oled">OLED Siyah</option>
      </select>
    </div>

    <div class="s-row">
      <div>
        <div class="s-label" data-i18n="s_ambient">Kapaktan renk</div>
        <div class="s-sublabel" data-i18n="s_ambient_hint">Şimdi çalıyor arka planını kapak görselinden renklendir</div>
      </div>
      <label class="s-toggle">
        <input type="checkbox" id="s_ambientArt" checked>
        <span class="s-toggle-track"></span>
      </label>
    </div>
  </section>

  <section class="s-section">
    <div class="s-section-title" data-i18n="s_list">Liste</div>

    <div class="s-row">
      <div><div class="s-label" data-i18n="s_default_sort">Varsayılan Sıralama</div></div>
      <select class="s-select" id="s_defaultSort">
        <option value="asc" selected data-i18n="sort_asc">Eskiden → Yeniye</option>
        <option value="desc" data-i18n="sort_desc">Yeniden → Eskiye</option>
      </select>
    </div>

    <div class="s-row">
      <div><div class="s-label" data-i18n="s_show_dl">İndirme Butonu Göster</div></div>
      <label class="s-toggle">
        <input type="checkbox" id="s_showDl" checked>
        <span class="s-toggle-track"></span>
      </label>
    </div>

    <div class="s-row">
      <div>
        <div class="s-label" data-i18n="s_prefetch">Çalarken önbelleğe al</div>
        <div class="s-sublabel" data-i18n="s_prefetch_sub">Çalan bölümün yerel bir kopyasını tutar; böylece ekran kilitlendiğinde ses kesilmez. Otomatik olarak silinir.</div>
      </div>
      <select class="s-select" id="s_prefetchAudio">
        <option value="always" data-i18n="s_prefetch_always">Her zaman</option>
        <option value="wifi" selected data-i18n="s_prefetch_wifi">Yalnızca Wi-Fi</option>
        <option value="never" data-i18n="s_prefetch_never">Asla</option>
      </select>
    </div>

    <div class="s-row">
      <div>
        <div class="s-label" data-i18n="s_auto_download">Yeni bölümleri indir</div>
        <div class="s-sublabel" data-i18n="s_auto_download_sub">Abone olduğun şovlarda çıkan bölümler arka planda iner; her denetlemede en fazla 5 tanesi.</div>
      </div>
      <select class="s-select" id="s_autoDownload">
        <option value="always" data-i18n="s_prefetch_always">Her zaman</option>
        <option value="wifi" data-i18n="s_prefetch_wifi">Yalnızca Wi-Fi</option>
        <option value="never" selected data-i18n="s_prefetch_never">Asla</option>
      </select>
    </div>

    <div class="s-row">
      <div>
        <div class="s-label" data-i18n="s_delete_played">Dinlenince indirmeyi sil</div>
        <div class="s-sublabel" data-i18n="s_delete_played_sub">Yalnızca biten bölümler silinir; kaldığın bölümlere dokunulmaz.</div>
      </div>
      <label class="s-toggle">
        <input type="checkbox" id="s_deleteAfterPlayed">
        <span class="s-toggle-track"></span>
      </label>
    </div>
  </section>

  <section class="s-section">
    <div class="s-section-title" data-i18n="s_privacy">Gizlilik</div>
    <div class="s-row">
      <div>
        <div class="s-label" data-i18n="s_allow_proxies">Üçüncü taraf vekillerine izin ver</div>
        <div class="s-sublabel" data-i18n="s_allow_proxies_sub">Seseri sunucusuna ulaşılamadığında yedek yol.</div>
      </div>
      <label class="s-toggle">
        <input type="checkbox" id="s_allowPublicProxies">
        <span class="s-toggle-track"></span>
      </label>
    </div>
  </section>

  <section class="s-section">
    <div class="s-section-title" data-i18n="s_lang_title">Dil / Language</div>
    <div class="s-row">
      <div><div class="s-label" data-i18n="s_lang_label">Arayüz Dili</div></div>
      <div id="s_lang"></div>
    </div>
  </section>

  <section class="s-section" id="s_syncSection" hidden>
    <div class="s-section-title" data-i18n="s_sync">Cihazlar Arası Eşitleme</div>
    <div class="s-row">
      <div><div class="s-label" data-i18n="s_sync_state">Durum</div></div>
      <span class="s-sublabel" id="syncStatus">—</span>
    </div>
    <div class="s-row" id="syncCodeRow" hidden>
      <div>
        <div class="s-label" data-i18n="s_sync_code">Eşleştirme Kodu</div>
        <div class="s-sublabel" data-i18n="s_sync_code_sub">Bu kodu kimseyle paylaşma.</div>
      </div>
      <code class="sync-code" id="syncCode"></code>
    </div>
    <div class="s-row" id="syncLinkRow" hidden>
      <input class="sync-input" id="syncCodeInput" type="text" autocomplete="off"
             spellcheck="false" autocapitalize="characters"
             data-i18n-ph="s_sync_code_ph" placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX">
      <button class="s-btn" id="btnSyncLinkGo" data-i18n="btn_sync_link_go">Bağlan</button>
    </div>
    <div class="s-data-btns">
      <button class="s-btn" id="btnSyncStart" data-i18n="btn_sync_start">Eşitlemeyi Başlat</button>
      <button class="s-btn" id="btnSyncLink" data-i18n="btn_sync_link">Kod Gir</button>
      <button class="s-btn" id="btnSyncNow" data-i18n="btn_sync_now">Şimdi Eşitle</button>
      <button class="s-btn" id="btnSyncCopy" data-i18n="btn_sync_copy">Kodu Kopyala</button>
      <button class="s-btn danger" id="btnSyncUnlink" data-i18n="btn_sync_unlink">Bu Cihazda Durdur</button>
      <button class="s-btn danger" id="btnSyncForget" data-i18n="btn_sync_forget">Sunucudaki Veriyi Sil</button>
    </div>
  </section>

  <section class="s-section">
    <div class="s-section-title" data-i18n="s_data">Veri</div>
    <div class="s-row">
      <div>
        <div class="s-label" data-i18n="s_storage">Depolama</div>
        <div class="s-sublabel" id="feedCacheUsage"></div>
      </div>
      <span class="s-sublabel" id="storageUsage">—</span>
    </div>
    <div class="s-data-btns">
      <button class="s-btn" id="btnOpmlExport" data-i18n="btn_opml_export">OPML Dışa Aktar</button>
      <button class="s-btn" id="btnOpmlImport" data-i18n="btn_opml_import">OPML İçe Aktar</button>
      <button class="s-btn" id="btnJsonExport" data-i18n="btn_json_export">JSON Yedeği İndir</button>
      <button class="s-btn" id="btnJsonImport" data-i18n="btn_json_import">JSON Yedeğini Geri Yükle</button>
      <button class="s-btn" id="btnDiagnostics" data-i18n="btn_diagnostics">Teşhis Bilgisini Kopyala</button>
      <button class="s-btn danger" id="btnClearDownloads" data-i18n="btn_clear_downloads">🗑 İndirilenleri Sil</button>
      <button class="s-btn danger" id="btnClearProgress" data-i18n="btn_clear_progress">🗑 Tüm İlerlemeyi Sıfırla</button>
      <button class="s-btn danger" id="btnClearAll" data-i18n="btn_clear_all">🗑 Tüm Verileri Temizle</button>
      <input type="file" id="opmlFile" accept=".opml,.xml,text/xml,application/xml" hidden>
      <input type="file" id="jsonFile" accept=".json,application/json" hidden>
    </div>
  </section>
</div>`;

export function initSettingsView(deps: SettingsViewDeps): View {
  const el = viewEl('settings');
  el.innerHTML = MARKUP;

  const pick = <T extends HTMLElement>(id: string): T => {
    const node = el.querySelector<T>('#' + id);
    if (!node) throw new Error(`#${id} missing from settings view`);
    return node;
  };

  const sSpeed = pick<HTMLSelectElement>('s_defaultSpeed');
  const sSkipBack = pick<HTMLSelectElement>('s_skipBack');
  const sSkipFwd = pick<HTMLSelectElement>('s_skipForward');
  const sAutoNext = pick<HTMLInputElement>('s_autoNext');
  const sResume = pick<HTMLInputElement>('s_resumePos');
  const sFontSize = pick<HTMLSelectElement>('s_fontSize');
  const sRowHeight = pick<HTMLSelectElement>('s_rowHeight');
  const sTheme = pick<HTMLSelectElement>('s_theme');
  const sAmbient = pick<HTMLInputElement>('s_ambientArt');
  const sSort = pick<HTMLSelectElement>('s_defaultSort');
  const sShowDl = pick<HTMLInputElement>('s_showDl');
  const sProxies = pick<HTMLInputElement>('s_allowPublicProxies');
  const sPrefetch = pick<HTMLSelectElement>('s_prefetchAudio');
  const sAutoDl = pick<HTMLSelectElement>('s_autoDownload');
  const sDeletePlayed = pick<HTMLInputElement>('s_deleteAfterPlayed');
  // Language: the shared flag listbox (native <option> can't render flags)
  pick<HTMLDivElement>('s_lang').append(createLangMenu());
  const swatchWrap = pick<HTMLDivElement>('colorSwatches');
  const storageUsageEl = pick<HTMLSpanElement>('storageUsage');
  const feedSpeedInfoEl = pick<HTMLDivElement>('feedSpeedInfo');
  const feedCacheUsageEl = pick<HTMLDivElement>('feedCacheUsage');
  const resetSpeedsBtn = pick<HTMLButtonElement>('btnResetFeedSpeeds');

  /**
   * The per-show speeds are set while listening, from the Now Playing sheet, so
   * Settings is where a listener finds out they exist — and the only place they
   * can be undone in one go.
   */
  function refreshFeedSpeeds(): void {
    const n = feedSpeedCount();
    feedSpeedInfoEl.textContent = t('s_feed_speeds_sub', n);
    resetSpeedsBtn.disabled = n === 0;
  }
  resetSpeedsBtn.addEventListener('click', () => {
    clearFeedSpeeds();
    toast(t('toast_feed_speeds_reset'));
  });
  feedSpeedRevision.subscribe(refreshFeedSpeeds);
  currentLang.subscribe(refreshFeedSpeeds);
  refreshFeedSpeeds();

  // ── accent swatches (now dynamic from ACCENT_SWATCHES) ───────────
  const swatches = ACCENT_SWATCHES.map(({ hex, name }) => {
    const sw = h('div', {
      className: 's-color-swatch',
      style: `background:${hex}`,
      attrs: { role: 'button', tabindex: '0', 'aria-label': name },
      dataset: { color: hex },
    });
    const choose = (): void => {
      setSetting('accentColor', hex);
      applyAccent(hex);
      updateSwatchActive();
    };
    sw.addEventListener('click', choose);
    sw.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        choose();
      }
    });
    return sw;
  });
  swatchWrap.append(...swatches);

  function updateSwatchActive(): void {
    const active = normalizeAccent(settings().accentColor);
    for (const sw of swatches) {
      sw.classList.toggle('active', sw.dataset.color === active);
      sw.setAttribute('aria-pressed', String(sw.dataset.color === active));
    }
  }

  // ── input <-> settings sync ──────────────────────────────────────
  function syncInputs(S: Settings): void {
    sSpeed.value = String(S.defaultSpeed);
    sSkipBack.value = String(S.skipBack);
    sSkipFwd.value = String(S.skipForward);
    sAutoNext.checked = S.autoNext;
    sResume.checked = S.resumePos;
    sAmbient.checked = S.ambientArt;
    sFontSize.value = S.fontSize;
    sRowHeight.value = S.rowHeight;
    sTheme.value = S.theme;
    sSort.value = S.defaultSort;
    sShowDl.checked = S.showDl;
    sProxies.checked = S.allowPublicProxies;
    sPrefetch.value = S.prefetchAudio;
    sAutoDl.value = S.autoDownload;
    sDeletePlayed.checked = S.deleteAfterPlayed;
    updateSwatchActive();
  }

  function applySide(S: Settings): void {
    document.documentElement.style.setProperty('--player-font-size', S.fontSize);
    document.documentElement.style.setProperty('--list-row-height', S.rowHeight);
  }

  async function refreshStorageUsage(): Promise<void> {
    const info = await storageInfo();
    storageUsageEl.textContent =
      t('storage_usage', fmtBytes(info.usageBytes), fmtBytes(info.quotaBytes)) +
      (info.downloadCount ? ` · ${info.downloadCount} ⤓ ${fmtBytes(info.downloadBytes)}` : '');
    // The feed cache was an invisible consumer of the same quota: it kept every
    // feed ever opened, and one full archive is a couple of megabytes.
    const feeds = await feedCacheInfo();
    feedCacheUsageEl.textContent = feeds.count
      ? t('storage_feeds', feeds.count, fmtBytes(feeds.bytes))
      : '';
  }

  // ── wiring ───────────────────────────────────────────────────────
  sSpeed.addEventListener('change', () => {
    const v = parseFloat(sSpeed.value) || 1;
    setSetting('defaultSpeed', v);
    pbSetRate(v);
  });
  sSkipBack.addEventListener('change', () => setSetting('skipBack', parseInt(sSkipBack.value) || 15));
  sSkipFwd.addEventListener('change', () => setSetting('skipForward', parseInt(sSkipFwd.value) || 30));
  sAutoNext.addEventListener('change', () => setSetting('autoNext', sAutoNext.checked));
  sResume.addEventListener('change', () => setSetting('resumePos', sResume.checked));
  sAmbient.addEventListener('change', () => setSetting('ambientArt', sAmbient.checked));
  sFontSize.addEventListener('change', () => {
    setSetting('fontSize', sFontSize.value);
    applySide(settings());
  });
  sRowHeight.addEventListener('change', () => {
    setSetting('rowHeight', sRowHeight.value);
    applySide(settings());
  });
  sTheme.addEventListener('change', () => {
    setSetting('theme', sTheme.value as ThemeName);
    applyTheme(settings().theme);
  });
  sSort.addEventListener('change', () => setSetting('defaultSort', sSort.value as SortDir));
  sShowDl.addEventListener('change', () => setSetting('showDl', sShowDl.checked));
  sProxies.addEventListener('change', () =>
    setSetting('allowPublicProxies', sProxies.checked),
  );
  sPrefetch.addEventListener('change', () =>
    setSetting('prefetchAudio', sPrefetch.value as PrefetchMode),
  );
  sAutoDl.addEventListener('change', () =>
    setSetting('autoDownload', sAutoDl.value as PrefetchMode),
  );
  sDeletePlayed.addEventListener('change', () =>
    setSetting('deleteAfterPlayed', sDeletePlayed.checked),
  );

  // ── data section ─────────────────────────────────────────────────
  function saveFile(name: string, mime: string, content: string): void {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ── cross-device sync ────────────────────────────────────────────
  const syncSection = pick('s_syncSection');
  syncSection.hidden = !SYNC_AVAILABLE;
  if (SYNC_AVAILABLE) {
    const codeRow = pick('syncCodeRow');
    const linkRow = pick('syncLinkRow');
    const codeEl = pick('syncCode');
    const statusEl = pick('syncStatus');
    const input = pick<HTMLInputElement>('syncCodeInput');

    const STATUS_KEY: Record<SyncStatus, LangKey> = {
      idle: 'sync_idle',
      syncing: 'sync_syncing',
      ok: 'sync_ok',
      error: 'sync_error',
      unavailable: 'sync_unavailable',
      unreadable: 'sync_unreadable',
    };

    const render = (s: SyncState): void => {
      codeRow.hidden = !s.linked;
      codeEl.textContent = s.code ? formatCode(s.code) : '';
      for (const id of ['btnSyncStart', 'btnSyncLink']) pick(id).hidden = s.linked;
      for (const id of ['btnSyncNow', 'btnSyncCopy', 'btnSyncUnlink', 'btnSyncForget']) {
        pick(id).hidden = !s.linked;
      }
      if (s.linked) linkRow.hidden = true;
      const label = s.linked ? t(STATUS_KEY[s.status]) : t('sync_not_linked');
      statusEl.textContent =
        s.linked && s.status === 'ok' && s.lastSyncAt
          ? label + ' · ' + new Date(s.lastSyncAt).toLocaleTimeString()
          : label;
    };
    render(syncState());
    syncState.subscribe(render);

    pick('btnSyncStart').addEventListener('click', () => {
      void startSync();
    });

    pick('btnSyncLink').addEventListener('click', () => {
      linkRow.hidden = !linkRow.hidden;
      if (!linkRow.hidden) input.focus();
    });

    pick('btnSyncLinkGo').addEventListener('click', () => {
      void (async () => {
        // The check character means a mistyped code fails here rather than
        // reaching the server and coming back as an unexplained 404.
        if (await linkSync(input.value)) {
          input.value = '';
          toast(t('toast_sync_linked'));
        } else {
          toast(t('toast_sync_bad_code'), 'error');
        }
      })();
    });

    pick('btnSyncNow').addEventListener('click', () => {
      void syncNow();
    });

    pick('btnSyncCopy').addEventListener('click', () => {
      const code = syncState().code;
      if (!code) return;
      void navigator.clipboard?.writeText(formatCode(code)).then(
        () => toast(t('toast_sync_copied')),
        () => toast(t('toast_sync_copy_failed'), 'error'),
      );
    });

    pick('btnSyncUnlink').addEventListener('click', () => {
      // Local only: this device stops syncing and keeps everything it has.
      unlinkSync();
    });

    pick('btnSyncForget').addEventListener('click', () => {
      void (async () => {
        if (!(await confirmDialog('confirm_sync_forget'))) return;
        await forgetRemote();
        toast(t('toast_sync_forgotten'));
      })();
    });
  }

  pick('btnOpmlExport').addEventListener('click', () => {
    saveFile('seseri-subscriptions.opml', 'text/x-opml', exportOpml(subscriptions()));
    toast(t('toast_opml_exported'));
  });

  const opmlFile = pick<HTMLInputElement>('opmlFile');
  pick('btnOpmlImport').addEventListener('click', () => opmlFile.click());
  opmlFile.addEventListener('change', () => {
    const f = opmlFile.files?.[0];
    opmlFile.value = '';
    if (!f) return;
    void f.text().then((xml) => {
      try {
        const entries = parseOpml(xml);
        let added = 0;
        for (const e of entries) {
          if (!isSubscribed(e.id)) {
            toggleSubscription({ id: e.id, name: e.name, artist: '', art: '' });
            added++;
          }
        }
        toast(t('opml_imported', added));
      } catch {
        toast(t('opml_invalid'), 'error');
      }
    });
  });

  pick('btnJsonExport').addEventListener('click', () => {
    saveFile('seseri-backup.json', 'application/json', exportBackup());
    toast(t('toast_json_exported'));
  });

  const jsonFile = pick<HTMLInputElement>('jsonFile');
  pick('btnJsonImport').addEventListener('click', () => jsonFile.click());
  jsonFile.addEventListener('change', () => {
    const f = jsonFile.files?.[0];
    jsonFile.value = '';
    if (!f) return;
    void f.text().then((text) => {
      if (!restoreBackup(text)) {
        toast(t('json_invalid'), 'error');
        return;
      }
      toast(t('json_imported'));
      // Reload rather than re-deriving every signal by hand: the loaders run
      // once at boot and are the only place the stored shapes are validated.
      location.reload();
    });
  });

  pick('btnDiagnostics').addEventListener('click', () => {
    void collectDiagnostics().then((text) =>
      navigator.clipboard?.writeText(text).then(
        () => toast(t('toast_diagnostics')),
        () => toast(t('toast_sync_copy_failed'), 'error'),
      ),
    );
  });

  pick('btnClearDownloads').addEventListener('click', () => {
    void confirmDialog('confirm_clear_downloads').then((ok) => {
      if (!ok) return;
      void clearAllDownloads().then(() => {
        toast(t('dl_removed'));
        void refreshStorageUsage();
      });
    });
  });

  pick('btnClearProgress').addEventListener('click', () => {
    void confirmDialog('confirm_clear_progress').then((ok) => {
      if (!ok) return;
      clearProgress();
      // The marks are part of "how far have I got"; leaving them would report
      // a cleared archive as fully heard.
      clearPlayed();
      deps.onDataCleared();
    });
  });

  pick('btnClearAll').addEventListener('click', () => {
    void confirmDialog('confirm_clear_all').then(async (ok) => {
      if (!ok) return;
      // Cancels the throttled progress write, so it cannot land after the wipe.
      saveProgressNow();
      // One implementation, shared with the crash-recovery screen: localStorage
      // alone left the bulk of the data in place — the IndexedDB stores and,
      // worst of all, the `seseri-audio` Cache API bucket holding every
      // downloaded episode, potentially gigabytes that "clear all data" kept.
      await hardReset();
      location.reload();
    });
  });

  // ── init ─────────────────────────────────────────────────────────
  syncInputs(settings());
  applySide(settings());
  settings.subscribe((S) => syncInputs(S));

  const view: View = {
    name: 'settings',
    el,
    onShow() {
      void refreshStorageUsage();
    },
  };
  registerView(view);
  return view;
}
