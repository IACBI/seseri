# Seseri

[![CI](https://github.com/IACBI/seseri/actions/workflows/ci.yml/badge.svg)](https://github.com/IACBI/seseri/actions/workflows/ci.yml)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-live-brightgreen)](https://iacbi.github.io/seseri/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-ready-5b8af5)](public/manifest.webmanifest)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](tsconfig.json)

A free, no-account podcast player. Search Apple Podcasts, paste any RSS feed or
YouTube link — stream, resume, queue and download episodes for offline
listening. Vite + strict TypeScript frontend, optional Cloudflare Worker
backend, installable as a PWA / Microsoft Store / Google Play app.

**"Sinyal" design** — warm charcoal surfaces, an amber "radio dial glow"
accent, and a signature frequency-line waveform motif. Navigation is a bottom
tab bar (mobile) / left sidebar (desktop) across four sections — **Home**
(continue-listening + subscriptions), **Search**, **Library**
(subscriptions/downloads) and **Settings** — with a full-screen **Now
Playing** sheet for transport, sleep timer, speed and queue access.

**▶ Live:** https://iacbi.github.io/seseri/ ·
**🪟 Windows app:** [download the installer](https://github.com/IACBI/seseri/releases/latest)

**Language / Dil:** **[English](#lang-en)** · **[Türkçe](#lang-tr)**

---

<a id="lang-en"></a>

## English

### ✨ Features

| | |
|---|---|
| 🔍 **Podcast search** | by name, Apple Podcasts link, or a direct RSS feed URL |
| ▶️ **YouTube shows** | search by name (channels/playlists/videos appear in results) or paste a link; audio streams through the Worker (Innertube + range-aware proxy → background/lock-screen playback) or public Piped instances, with an official `youtube-nocookie` embed fallback |
| 📥 **Offline episodes** | downloads live in the Cache API and play (and seek) with no connection; feeds are cached in IndexedDB and refresh in the background (stale-while-revalidate) |
| 🧾 **Play queue** | queue any episode as "up next" — the queue wins over list order; own page under **Queue** |
| 🎧 **Mini transport** | leaving a feed keeps playing; the persistent dock carries skip/play controls (plus prev/next & speed on wide screens) and a seekable progress line — the chevron expands the full **Now Playing** sheet |
| 🌊 **Frequency-line scrubber** | signature waveform motif — drag-to-seek hero scrubber in Now Playing, animated line on the mini player while playing |
| 🎛 **Now Playing sheet** | full-screen (mobile) / floating panel (desktop): play/pause, prev/next, skip, speed 0.5×–2.5×, sleep timer, resume position |
| 🖥 **Desktop layout** | ≥900px swaps the tab bar for a persistent left sidebar (Home/Search/Library/Settings) |
| ⭐ **Subscriptions** | star podcasts; live in **Library**; OPML import/export + JSON backup |
| 🎨 **Themes** | Auto (system), Dark, Light, OLED Black; 7 accent colors (amber "dial glow" default) |
| 🌍 **Multilingual** | TR / EN / DE / FR / ES / AR / JA / RU (incl. RTL) |
| 📲 **Installable** | PWA with maskable/monochrome icons, shortcuts, store screenshots |
| ♿ **Accessible** | keyboard-operable views, aria-live status/busy states, focus management on navigation, `prefers-reduced-motion` |

#### Keyboard shortcuts

Active while a podcast feed or the Now Playing sheet is open (not while typing in a field):

| Key | Action |
|-----|--------|
| `Space` | Play / pause |
| `←` / `→` | Seek back / forward |
| `↑` / `↓` | Previous / next episode |
| `Esc` | Close the Now Playing sheet |

### 🚀 Getting started

```bash
npm install           # once
npm run dev           # http://localhost:5199

# optional backend (feed/iTunes proxy + YouTube resolution)
npm --prefix worker install   # once
npm run worker:dev            # http://127.0.0.1:8787
```

The client tries the Worker first (`VITE_API_BASE`, see `.env.development`)
and falls back to public CORS proxies automatically when it is unreachable.

### 🧰 Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `preview` | Vite dev server / production build / serve `dist` |
| `npm test` | Vitest unit suites (parser, OPML, i18n completeness, proxy chain, formatters) |
| `npm run lint` / `typecheck` / `format` | ESLint · `tsc --noEmit` · Prettier |
| `npm run worker:dev` / `worker:test` | wrangler dev · Worker handler tests |
| `npm run verify` | lint + typecheck + tests + build + worker typecheck/tests |
| `node scripts/smoke-p3-offline.cjs` | headless-Edge smoke: download → offline reload → playback |
| `node scripts/smoke-p4-worker.cjs` | smoke: real RSS through the local Worker (needs `worker:dev`) |
| `node scripts/smoke-p5-mini.cjs` | smoke: mini player, queue, back-navigation |
| `node scripts/icons.cjs` | regenerate all PNG icons from `public/icons/seseri.svg` |
| `node scripts/store-shots.cjs` | regenerate manifest/store screenshots |

### 📁 Structure

```
.
├── index.html             # Vite entry (CSP, meta, manifest link)
├── src/
│   ├── app.ts             # boot & wiring
│   ├── feeds/             # iTunes / RSS / input parsing / proxy chain / resolveFeed
│   ├── youtube/           # Piped/Invidious/Atom resolvers + iframe embed fallback
│   ├── player/            # audio engine, media session, sleep timer, offline downloads
│   ├── state/             # signals: settings, queue, now-playing
│   ├── storage/           # localStorage (legacy keys), IndexedDB, OPML
│   ├── ui/
│   │   ├── playback-controller.ts  # headless playback session, shared by every view
│   │   ├── views/          # home, search, library, podcast, queue, settings, now-playing
│   │   ├── views.ts        # view registry (show/hide, focus hand-off)
│   │   ├── nav.ts          # tab bar / sidebar controller
│   │   ├── router.ts       # ?podcast= / ?rss= / ?yt= / ?view= ↔ history
│   │   └── shell.ts, theme.ts, mini-player.ts, toast.ts, waveform.ts, confirm.ts, …
│   ├── i18n/              # 8 languages, compile-time key completeness
│   ├── styles/
│   │   ├── tokens.css, themes.css, base.css, layout.css, controls.css,
│   │   │   overlays.css, signal-line.css   # design-system layers
│   │   ├── views/          # one stylesheet per view (home, search, library, podcast,
│   │   │                   # queue, settings, now-playing)
│   │   └── index.css       # barrel import
│   └── sw.ts              # service worker (injectManifest)
├── worker/                # Cloudflare Worker API (Hono): /v1/feed /v1/itunes /v1/yt/*
├── public/                # manifest, icons (incl. maskable/monochrome), screenshots,
│                          # privacy-policy, 404, .well-known/assetlinks.json
├── scripts/               # icon/screenshot generators + headless smoke tests
└── docs/                  # TESTPLAN, STORE guide, ci.yml, reference screenshots
```

### ☁️ Backend (optional but recommended)

`worker/` is a Cloudflare Worker (free tier friendly): RSS/iTunes proxying with
edge caching and SSRF guards, plus YouTube listing/stream resolution over a
cron-health-checked instance pool. Deploy with `npx wrangler deploy`, then set
`VITE_API_BASE` to the workers.dev URL at build time. See
[docs/STORE.md](docs/STORE.md) for the full release pipeline.

### 📦 Distribution

- **Windows**: a Tauri v2 shell (`desktop/`) wraps the live site in WebView2 —
  a ~4 MB NSIS installer published on
  [GitHub Releases](https://github.com/IACBI/seseri/releases/latest); the app
  updates itself with every web deploy.
- **Google Play**: TWA package produced from the live PWA with
  [PWABuilder](https://www.pwabuilder.com/).
- Step-by-step release guide: [docs/STORE.md](docs/STORE.md).

### 🔒 Privacy

No analytics, no accounts. Settings/progress stay in `localStorage`; downloads
stay in your browser's Cache API. See
[public/privacy-policy.html](public/privacy-policy.html).

### 👤 Author / License

**𝓐.𝓒.𝓑** — bozdogancanahmet@gmail.com · [MIT](LICENSE) © 2026

<sub>[↑ Language / Dil](#seseri)</sub>

---

<a id="lang-tr"></a>

## Türkçe

Ücretsiz, üyeliksiz podcast dinleyici. Apple Podcasts'te ara, RSS veya YouTube
linki yapıştır — çal, kaldığın yerden devam et, kuyruğa ekle, bölümleri
çevrimdışı dinlemek için indir. Vite + strict TypeScript ön yüz, isteğe bağlı
Cloudflare Worker arka ucu; PWA / Microsoft Store / Google Play uygulaması
olarak kurulabilir.

**"Sinyal" tasarımı** — sıcak antrasit yüzeyler, kehribar "radyo kadranı"
vurgusu ve imza niteliğindeki frekans-çizgisi dalga-form motifi. Gezinme;
alttan sekme çubuğu (mobil) / soldan kenar çubuğu (masaüstü) olmak üzere dört
bölümden oluşur — **Ana Sayfa** (kaldığın yerden devam et + abonelikler),
**Ara**, **Kütüphane** (abonelikler/indirilenler) ve **Ayarlar** — ayrıca
oynatma, uyku zamanlayıcısı, hız ve kuyruğa erişim için tam ekran **Şimdi
Çalıyor** paneli.

**▶ Canlı:** https://iacbi.github.io/seseri/ ·
**🪟 Windows uygulaması:** [kurulumu indir](https://github.com/IACBI/seseri/releases/latest)

### ✨ Özellikler

| | |
|---|---|
| 🔍 **Podcast arama** | isim, Apple Podcasts linki veya doğrudan RSS URL'si |
| ▶️ **YouTube yayınları** | **isimle ara** (kanal/playlist/videolar sonuçlarda listelenir) veya link yapıştır; ses Worker üzerinden akar (Innertube + range destekli proxy → arka plan/kilit ekranı çalma) ya da Piped'e, o da olmazsa resmi `youtube-nocookie` embed'e düşer |
| 📥 **Çevrimdışı bölümler** | indirilenler Cache API'de yaşar, bağlantısız çalar ve sarar; feed'ler IndexedDB'de önbelleklenir, arka planda tazelenir |
| 🧾 **Kuyruk** | bölümü "sıradaki" olarak işaretle — kuyruk, liste sırasından önce gelir; kendi sayfası **Kuyruk** görünümünde |
| 🎧 **Mini transport** | feed'den çıkınca çalma sürer; kalıcı dock üzerinde atlama/oynat kontrolleri (geniş ekranda önceki/sonraki ve hız) ve dokunarak sarılabilir ilerleme çizgisi — ok simgesi tam **Şimdi Çalıyor** panelini açar |
| 🌊 **Frekans-çizgisi dalga-form** | imza motif — Şimdi Çalıyor panelinde sürüklenebilir kahraman dalga-form, çalarken mini oynatıcıda animasyonlu çizgi |
| 🎛 **Şimdi Çalıyor paneli** | tam ekran (mobil) / yüzen panel (masaüstü): oynat/duraklat, önceki/sonraki, atlama, 0.5×–2.5× hız, uyku zamanlayıcısı |
| 🖥 **Masaüstü düzeni** | ≥900px'te sekme çubuğu yerini kalıcı soldan kenar çubuğuna bırakır (Ana Sayfa/Ara/Kütüphane/Ayarlar) |
| ⭐ **Abonelikler** | yıldızla; **Kütüphane**'de yaşar; OPML içe/dışa aktarma + JSON yedek |
| 🎨 **Temalar** | Otomatik (sistem), Koyu, Açık, OLED Siyah; 7 vurgu rengi (varsayılan kehribar "kadran ışıltısı") |
| 🌍 **Çok dilli** | TR / EN / DE / FR / ES / AR / JA / RU (RTL dahil) |
| 📲 **Kurulabilir** | maskable/monochrome ikonlu PWA, kısayollar, mağaza görselleri |
| ♿ **Erişilebilir** | klavyeyle kullanılabilir görünümler, aria-live durum/busy, gezinmede odak yönetimi, `prefers-reduced-motion` |

### 🚀 Hızlı başlangıç

```bash
npm install           # bir kez
npm run dev           # http://localhost:5199

# isteğe bağlı arka uç (feed/iTunes proxy + YouTube çözümleme)
npm --prefix worker install   # bir kez
npm run worker:dev            # http://127.0.0.1:8787
```

İstemci önce Worker'ı dener (`VITE_API_BASE`, bkz. `.env.development`),
ulaşamazsa otomatik olarak halka açık CORS proxy'lerine düşer.

### 📦 Dağıtım

- **Windows**: `desktop/` altındaki Tauri v2 kabuğu canlı siteyi WebView2
  içinde açar — ~4 MB'lık NSIS kurulumu
  [GitHub Releases](https://github.com/IACBI/seseri/releases/latest)'te;
  uygulama her web dağıtımıyla kendini günceller.
- **Google Play**: canlı PWA'dan [PWABuilder](https://www.pwabuilder.com/)
  ile TWA paketi.
- Adım adım rehber: [docs/STORE.md](docs/STORE.md).

### 🔒 Gizlilik

Analitik yok, hesap yok. Ayarlar/ilerleme `localStorage`'da, indirilenler
tarayıcının Cache API'sinde kalır. Bkz.
[public/privacy-policy.html](public/privacy-policy.html).

### 👤 Yazar / Lisans

**𝓐.𝓒.𝓑** — bozdogancanahmet@gmail.com · [MIT](LICENSE) © 2026

<sub>[↑ Language / Dil](#seseri)</sub>
