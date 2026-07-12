/**
 * Static app shell — the "Sinyal" frame: navigation (bottom tab bar on mobile,
 * left sidebar on desktop), one <section> mount point per view, the persistent
 * mini-player dock and the Now Playing sheet host. View modules render their
 * own content into their section; this file owns only the frame.
 *
 * Constant markup with no interpolated data, so innerHTML is safe here.
 * Fallback strings are Turkish (default lang); bindI18nDom localizes them.
 */

import { ICON_SPRITE, BRAND_MARK } from './icons';

const NAV = `
<nav class="app-nav" id="appNav" aria-label="Seseri">
  <div class="nav-brand">
    <span class="nav-brand-logo" aria-hidden="true">${BRAND_MARK}</span>
    <span class="nav-brand-name wm">Seseri</span>
  </div>
  <ul class="nav-items">
    <li><button class="nav-item" id="navHome" data-view="home" aria-current="page">
      <svg class="icon" aria-hidden="true"><use href="#ic-home"/></svg>
      <span data-i18n="nav_home">Ana Sayfa</span>
      <span class="nav-dot" aria-hidden="true"></span>
    </button></li>
    <li><button class="nav-item" id="navSearch" data-view="search">
      <svg class="icon" aria-hidden="true"><use href="#ic-search"/></svg>
      <span data-i18n="nav_search">Ara</span>
      <span class="nav-dot" aria-hidden="true"></span>
    </button></li>
    <li><button class="nav-item" id="navLibrary" data-view="library">
      <svg class="icon" aria-hidden="true"><use href="#ic-library"/></svg>
      <span data-i18n="nav_library">Kütüphane</span>
      <span class="nav-dot" aria-hidden="true"></span>
    </button></li>
    <li class="nav-spring" aria-hidden="true"></li>
    <li><button class="nav-item" id="navSettings" data-view="settings">
      <svg class="icon" aria-hidden="true"><use href="#ic-settings"/></svg>
      <span data-i18n="nav_settings">Ayarlar</span>
      <span class="nav-dot" aria-hidden="true"></span>
    </button></li>
  </ul>
</nav>`;

const MAIN = `
<main class="app-main" id="appMain">
  <section class="view" id="view-home" hidden tabindex="-1" data-i18n-aria="nav_home" aria-label="Ana Sayfa"></section>
  <section class="view" id="view-search" hidden tabindex="-1" data-i18n-aria="nav_search" aria-label="Ara"></section>
  <section class="view" id="view-library" hidden tabindex="-1" data-i18n-aria="nav_library" aria-label="Kütüphane"></section>
  <section class="view" id="view-podcast" hidden tabindex="-1"></section>
  <section class="view" id="view-queue" hidden tabindex="-1" data-i18n-aria="queue_title" aria-label="Çalma kuyruğu"></section>
  <section class="view" id="view-settings" hidden tabindex="-1" data-i18n-aria="nav_settings" aria-label="Ayarlar"></section>
</main>`;

const MINI_PLAYER = `
<div class="mini-player" id="miniPlayer">
  <div class="mini-signal" id="miniSignal" aria-hidden="true"></div>
  <div class="mini-progress-track" id="miniScrub" role="slider" tabindex="0"
       data-i18n-aria="seek_label" aria-label="Konum" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
    <div class="mini-progress" id="miniProgress"></div>
  </div>
  <div class="mini-main" id="miniMain" role="button" tabindex="0" data-i18n-aria="np_open" aria-label="Oynatıcıyı aç">
    <img class="mini-art" id="miniArt" alt="" loading="lazy" decoding="async">
    <div class="mini-info">
      <div class="mini-title" id="miniTitle">—</div>
      <div class="mini-feed" id="miniFeed"></div>
    </div>
  </div>
  <div class="mini-controls">
    <button class="icon-btn mini-tp mini-wide" id="miniPrev" data-i18n-aria="btn_prev" aria-label="Önceki" disabled><svg class="icon" aria-hidden="true"><use href="#ic-prev"/></svg></button>
    <button class="icon-btn mini-tp mini-skip" id="miniBack" data-i18n-aria="s_skip_back" aria-label="Geri Atla"><svg class="icon" aria-hidden="true"><use href="#ic-rewind"/></svg><span class="mini-skip-n" id="miniLblBack">15</span></button>
    <button class="mini-play" id="miniPlay" data-i18n-aria="play" aria-label="Oynat"><svg class="icon icon-fill" aria-hidden="true"><use href="#ic-play"/></svg></button>
    <button class="icon-btn mini-tp mini-skip" id="miniFwd" data-i18n-aria="s_skip_fwd" aria-label="İleri Atla"><svg class="icon" aria-hidden="true"><use href="#ic-forward"/></svg><span class="mini-skip-n" id="miniLblFwd">30</span></button>
    <button class="icon-btn mini-tp mini-wide" id="miniNext" data-i18n-aria="btn_next" aria-label="Sonraki" disabled><svg class="icon" aria-hidden="true"><use href="#ic-next"/></svg></button>
  </div>
  <div class="mini-secondary">
    <span class="mini-sec-ctl mini-wide2">
      <svg class="icon" aria-hidden="true"><use href="#ic-moon"/></svg>
      <select class="seri-select mini-sel" id="miniSleep" data-i18n-aria="sleep_timer" aria-label="Uyku zamanlayıcısı (dk)"></select>
    </span>
    <select class="seri-select mini-sel mini-speed mini-wide2" id="miniSpeed" data-i18n-aria="speed_label" aria-label="Oynatma hızı"></select>
    <button class="icon-btn mini-tp mini-expand" id="miniExpand" data-i18n-aria="np_open" aria-label="Oynatıcıyı aç"><svg class="icon" aria-hidden="true"><use href="#ic-up"/></svg></button>
  </div>
</div>`;

const NP_SHEET = `
<div class="np-sheet" id="npSheet" hidden role="dialog" aria-modal="false" data-i18n-aria="now_playing" aria-label="Şu an çalıyor"></div>`;

export function renderShell(app: HTMLElement): void {
  app.innerHTML =
    ICON_SPRITE + '<div class="app-frame">' + NAV + MAIN + '</div>' + MINI_PLAYER + NP_SHEET;
}

/** getElementById that must succeed (shell markup is static). */
export function must<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing from shell`);
  return el as T;
}
