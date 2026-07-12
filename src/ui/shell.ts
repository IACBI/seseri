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
<div class="mini-player" id="miniPlayer" role="button" tabindex="0" data-i18n-aria="np_open" aria-label="Oynatıcıyı aç">
  <div class="mini-signal" id="miniSignal" aria-hidden="true"></div>
  <div class="mini-progress-track"><div class="mini-progress" id="miniProgress"></div></div>
  <img class="mini-art" id="miniArt" alt="" loading="lazy" decoding="async">
  <div class="mini-info">
    <div class="mini-title" id="miniTitle">—</div>
    <div class="mini-feed" id="miniFeed"></div>
  </div>
  <button class="mini-play" id="miniPlay" aria-label="Oynat"><svg class="icon icon-fill" aria-hidden="true"><use href="#ic-play"/></svg></button>
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
