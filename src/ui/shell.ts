/**
 * Static app shell — ported verbatim from the legacy <body> with every inline
 * handler removed (events are wired in the screen controllers). This is
 * constant markup with no interpolated data, so innerHTML is safe here.
 */

const ICON_SPRITE = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
  <symbol id="ic-star" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></symbol>
  <symbol id="ic-share" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></symbol>
  <symbol id="ic-settings" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></symbol>
  <symbol id="ic-play" viewBox="0 0 24 24"><polygon points="6 4 20 12 6 20 6 4"/></symbol>
  <symbol id="ic-pause" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></symbol>
  <symbol id="ic-prev" viewBox="0 0 24 24"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></symbol>
  <symbol id="ic-next" viewBox="0 0 24 24"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></symbol>
  <symbol id="ic-rewind" viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></symbol>
  <symbol id="ic-forward" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></symbol>
  <symbol id="ic-download" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></symbol>
  <symbol id="ic-sort" viewBox="0 0 24 24"><polyline points="21 16 17 20 13 16"/><line x1="17" y1="20" x2="17" y2="4"/><polyline points="3 8 7 4 11 8"/><line x1="7" y1="4" x2="7" y2="20"/></symbol>
  <symbol id="ic-moon" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></symbol>
  <symbol id="ic-arrow-right" viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></symbol>
  <symbol id="ic-back" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></symbol>
  <symbol id="ic-queue" viewBox="0 0 24 24"><line x1="3" y1="6" x2="13" y2="6"/><line x1="3" y1="12" x2="13" y2="12"/><line x1="3" y1="18" x2="9" y2="18"/><line x1="18" y1="9" x2="18" y2="15"/><line x1="15" y1="12" x2="21" y2="12"/></symbol>
  <symbol id="ic-up" viewBox="0 0 24 24"><polyline points="6 14 12 8 18 14"/></symbol>
  <symbol id="ic-down" viewBox="0 0 24 24"><polyline points="6 10 12 16 18 10"/></symbol>
  <symbol id="ic-x" viewBox="0 0 24 24"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></symbol>
</svg>`;

const LANG_OPTIONS = `
      <option value="tr">🇹🇷 TR</option>
      <option value="en">🇬🇧 EN</option>
      <option value="de">🇩🇪 DE</option>
      <option value="fr">🇫🇷 FR</option>
      <option value="es">🇪🇸 ES</option>
      <option value="ar">🇸🇦 AR</option>
      <option value="ja">🇯🇵 JA</option>
      <option value="ru">🇷🇺 RU</option>`;

const SEARCH_SCREEN = `
<div id="searchScreen">
  <div class="search-screen-topbar">
    <select class="lang-select" id="homeLangSel" aria-label="Dil seçimi" data-i18n-aria="lang_select_label">${LANG_OPTIONS}
    </select>
  </div>

  <div class="brand">
    <div class="brand-logo" aria-hidden="true">
      <svg viewBox="0 0 512 512">
        <path class="s-mark" pathLength="100"
          d="M 334 184 A 78 78 0 1 0 256 262 A 78 78 0 1 1 178 340"
          fill="none" stroke="currentColor" stroke-width="60" stroke-linecap="round"/>
      </svg>
    </div>
    <h1 class="brand-name" aria-label="Seseri">Seseri</h1>
  </div>

  <div class="search-wrap">
    <div class="search-row">
      <input class="search-input" id="searchInput" type="text"
        placeholder="Podcast adı, Apple Podcasts veya YouTube linki..." data-i18n-ph="search_placeholder" />
      <button class="search-btn" id="searchBtn" data-i18n="btn_search">Ara →</button>
    </div>
  </div>

  <div class="results-list" id="resultsList" aria-live="polite"></div>
</div>`;

const PLAYER_SCREEN = `
<div id="playerScreen">
  <div class="p-header">
    <button class="p-back" id="backBtn" data-i18n="btn_back">← Geri</button>
    <img class="p-thumb" id="pThumb" alt="" loading="lazy" decoding="async">
    <div class="p-meta">
      <div class="p-title" id="pTitle" tabindex="-1">—</div>
      <div class="p-author" id="pAuthor">—</div>
    </div>
    <div class="p-epcount"><strong id="pEpCount">—</strong><span id="pEpUnit" data-i18n="ep_count_unit">bölüm</span></div>
    <button class="settings-btn" id="favBtn" data-i18n-title="fav_btn" data-i18n-aria="fav_btn" title="Abonelik ekle/çıkar" aria-label="Abonelik"><svg class="icon" aria-hidden="true"><use href="#ic-star"/></svg></button>
    <button class="settings-btn" id="shareBtn" data-i18n-title="share_btn" data-i18n-aria="share_btn" title="Linki paylaş" aria-label="Paylaş"><svg class="icon" aria-hidden="true"><use href="#ic-share"/></svg></button>
    <button class="settings-btn" id="settingsBtn" data-i18n-title="settings_title" data-i18n-aria="settings_title" title="Ayarlar" aria-label="Ayarlar"><svg class="icon" aria-hidden="true"><use href="#ic-settings"/></svg></button>
  </div>

  <div class="p-status" aria-live="polite">
    <div class="dot loading" id="dot"></div>
    <span class="p-status-text" id="statusText" data-i18n="status_loading">Yükleniyor...</span>
  </div>

  <div class="p-player" id="pPlayer">
    <div class="p-now-head">
      <span class="now-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      <div class="p-now-label" data-i18n="now_playing">ŞU AN ÇALIYOR</div>
    </div>
    <div class="p-now-title" id="nowTitle" data-i18n="pick_episode">Bir bölüm seçin</div>
    <div class="yt-frame" id="ytFrame"><div id="ytHost"></div></div>
    <div class="wave" id="progressWrap" role="slider" tabindex="0"
         aria-label="Konum" data-i18n-aria="seek_label" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <div class="wave-layer wave-base" id="waveBase"></div>
      <div class="wave-layer wave-fill" id="waveFill"></div>
      <div class="wave-head" id="waveHead"></div>
      <div class="wave-tip" id="waveTip">0:00</div>
    </div>
    <div class="time-row">
      <span id="tCur">0:00</span>
      <span id="tTot">0:00</span>
    </div>
    <div class="controls">
      <button class="ctrl-btn" id="btnPrev" disabled><svg class="icon" aria-hidden="true"><use href="#ic-prev"/></svg> <span data-i18n="btn_prev">Önceki</span></button>
      <button class="ctrl-btn ctrl-skip" id="btnSkipBack"><svg class="icon" aria-hidden="true"><use href="#ic-rewind"/></svg> <span id="lblSkipBack">15</span></button>
      <button class="play-btn" id="btnPlay" aria-label="Oynat"><svg class="icon icon-fill" aria-hidden="true"><use href="#ic-play"/></svg></button>
      <button class="ctrl-btn ctrl-skip" id="btnSkipFwd"><svg class="icon" aria-hidden="true"><use href="#ic-forward"/></svg> <span id="lblSkipFwd">30</span></button>
      <button class="ctrl-btn" id="btnNext" disabled><span data-i18n="btn_next">Sonraki</span> <svg class="icon" aria-hidden="true"><use href="#ic-next"/></svg></button>
      <span class="spacer"></span>
      <span class="sel-wrap sleep-wrap">
        <svg class="icon sel-ic" aria-hidden="true"><use href="#ic-moon"/></svg>
        <select class="seri-select sleep-select" id="sleepSel" data-i18n-title="sleep_timer" data-i18n-aria="sleep_timer" title="Uyku zamanlayıcısı (dk)">
          <option value="0" selected>—</option>
          <option value="15">15</option>
          <option value="30">30</option>
          <option value="60">60</option>
        </select>
      </span>
      <span class="sel-wrap">
        <select class="seri-select speed-select" id="speedSel" data-i18n-title="speed_label" data-i18n-aria="speed_label" title="Hız" aria-label="Hız">
          <option value="0.5">0.5×</option>
          <option value="0.75">0.75×</option>
          <option value="1" selected>1×</option>
          <option value="1.25">1.25×</option>
          <option value="1.5">1.5×</option>
          <option value="1.75">1.75×</option>
          <option value="2">2×</option>
          <option value="2.5">2.5×</option>
        </select>
      </span>
    </div>
  </div>

  <div class="sort-bar">
    <div class="sort-left">
      <button class="sort-toggle" id="sortToggle"><svg class="icon" aria-hidden="true"><use href="#ic-sort"/></svg> <span data-i18n="btn_sort">Sıra</span></button>
      <span class="sort-info" id="sortInfo" data-i18n="sort_asc">Eskiden → Yeniye</span>
      <button class="sort-toggle queue-toggle" id="queueToggle" aria-expanded="false"
        title="Kuyruk" data-i18n-title="queue_title" data-i18n-aria="queue_title" aria-label="Kuyruk"
        ><svg class="icon" aria-hidden="true"><use href="#ic-queue"/></svg><span class="queue-count" id="queueCount" hidden></span></button>
    </div>
    <input class="search-filter" id="filterInput" type="text"
      placeholder="Bölüm ara..." data-i18n-ph="filter_placeholder" />
  </div>

  <div class="ep-list" id="epList">
    <div class="empty-state" data-i18n="loading_eps">Yükleniyor...</div>
  </div>
</div>`;

const MINI_PLAYER = `
<div class="mini-player" id="miniPlayer" role="button" tabindex="0" data-i18n-aria="now_playing" aria-label="Şu an çalıyor">
  <div class="mini-progress-track"><div class="mini-progress" id="miniProgress"></div></div>
  <img class="mini-art" id="miniArt" alt="" loading="lazy" decoding="async">
  <div class="mini-info">
    <div class="mini-title" id="miniTitle">—</div>
    <div class="mini-feed" id="miniFeed"></div>
  </div>
  <button class="mini-play" id="miniPlay" aria-label="Oynat"><svg class="icon icon-fill" aria-hidden="true"><use href="#ic-play"/></svg></button>
</div>`;

const SETTINGS_PANEL = `
<dialog class="settings-panel" id="settingsPanel" aria-labelledby="settingsTitle">
  <div class="settings-header">
    <span class="settings-title"><svg class="icon" aria-hidden="true"><use href="#ic-settings"/></svg> <span id="settingsTitle" data-i18n="settings_heading">Ayarlar</span></span>
    <button class="settings-close" id="settingsClose" data-i18n-aria="close" aria-label="Kapat">×</button>
  </div>
  <div class="settings-body">

    <div>
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
    </div>

    <hr class="s-divider">

    <div>
      <div class="s-section-title" data-i18n="s_appearance">Görünüm</div>

      <div class="s-row">
        <div><div class="s-label" data-i18n="s_accent">Vurgu Rengi</div></div>
      </div>
      <div class="s-color-row" id="colorSwatches">
        <div class="s-color-swatch active" style="background:#8b7cf6" data-color="#8b7cf6" role="button" tabindex="0" aria-label="Violet"></div>
        <div class="s-color-swatch" style="background:#5b8af5" data-color="#5b8af5" role="button" tabindex="0" aria-label="Blue"></div>
        <div class="s-color-swatch" style="background:#43d49a" data-color="#43d49a" role="button" tabindex="0" aria-label="Green"></div>
        <div class="s-color-swatch" style="background:#f06a6a" data-color="#f06a6a" role="button" tabindex="0" aria-label="Red"></div>
        <div class="s-color-swatch" style="background:#e6bb4f" data-color="#e6bb4f" role="button" tabindex="0" aria-label="Amber"></div>
        <div class="s-color-swatch" style="background:#f5845b" data-color="#f5845b" role="button" tabindex="0" aria-label="Coral"></div>
        <div class="s-color-swatch" style="background:#34d8e0" data-color="#34d8e0" role="button" tabindex="0" aria-label="Cyan"></div>
      </div>

      <div style="margin-top:16px">
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
      </div>
    </div>

    <hr class="s-divider">

    <div>
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
    </div>

    <hr class="s-divider">

    <div>
      <div class="s-section-title" data-i18n="s_lang_title">Dil / Language</div>
      <div class="s-row">
        <div><div class="s-label" data-i18n="s_lang_label">Arayüz Dili</div></div>
        <select class="s-select" id="s_lang">
          <option value="tr">🇹🇷 Türkçe</option>
          <option value="en">🇬🇧 English</option>
          <option value="de">🇩🇪 Deutsch</option>
          <option value="fr">🇫🇷 Français</option>
          <option value="es">🇪🇸 Español</option>
          <option value="ar">🇸🇦 العربية</option>
          <option value="ja">🇯🇵 日本語</option>
          <option value="ru">🇷🇺 Русский</option>
        </select>
      </div>
    </div>

    <hr class="s-divider">

    <div>
      <div class="s-section-title" data-i18n="s_data">Veri</div>
      <div class="s-row">
        <div><div class="s-label" data-i18n="s_storage">Depolama</div></div>
        <span class="s-sublabel" id="storageUsage">—</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="s-btn" id="btnOpmlExport" data-i18n="btn_opml_export">OPML Dışa Aktar</button>
        <button class="s-btn" id="btnOpmlImport" data-i18n="btn_opml_import">OPML İçe Aktar</button>
        <button class="s-btn" id="btnJsonExport" data-i18n="btn_json_export">JSON Yedeği İndir</button>
        <button class="s-btn danger" id="btnClearDownloads" data-i18n="btn_clear_downloads">🗑 İndirilenleri Sil</button>
        <button class="s-btn danger" id="btnClearProgress" data-i18n="btn_clear_progress">🗑 Tüm İlerlemeyi Sıfırla</button>
        <button class="s-btn danger" id="btnClearAll" data-i18n="btn_clear_all">🗑 Tüm Verileri Temizle</button>
        <input type="file" id="opmlFile" accept=".opml,.xml,text/xml,application/xml" hidden>
      </div>
    </div>

  </div>
</dialog>`;

export function renderShell(app: HTMLElement): void {
  app.innerHTML = ICON_SPRITE + SEARCH_SCREEN + PLAYER_SCREEN + MINI_PLAYER + SETTINGS_PANEL;
}

/** getElementById that must succeed (shell markup is static). */
export function must<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing from shell`);
  return el as T;
}
