# Seseri

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-live-brightgreen)](https://iacbi.github.io/seseri/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-ready-5b8af5)](public/manifest.webmanifest)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](tsconfig.json)

A free, no-account podcast player. Search Apple Podcasts, paste any RSS feed or
YouTube link — stream, resume, queue and download episodes for offline
listening. Vite + strict TypeScript frontend, optional Cloudflare Worker
backend, installable as a PWA / Microsoft Store / Google Play app.

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
| 🧾 **Play queue** | queue any episode as "up next" — the queue wins over list order |
| 🎧 **Mini player** | leaving a feed keeps playing; a floating transport on the home screen takes you back |
| 🌊 **Waveform scrubber** | per-episode waveform with drag-to-seek, live playhead and time tooltip |
| 🎛 **Full player** | play/pause, prev/next, skip, speed 0.5×–2.5×, sleep timer, resume position |
| 🖥 **Desktop layout** | ≥900px shows a library rail beside the episode pane |
| ⭐ **Subscriptions** | star podcasts; OPML import/export + JSON backup |
| 🎨 **Themes** | Auto (system), Dark, Light, OLED Black; 7 accent colors |
| 🌍 **Multilingual** | TR / EN / DE / FR / ES / AR / JA / RU (incl. RTL) |
| 📲 **Installable** | PWA with maskable/monochrome icons, shortcuts, store screenshots |
| ♿ **Accessible** | native `<dialog>` settings, aria-live status, keyboard-operable, `prefers-reduced-motion` |

#### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / pause |
| `←` / `→` | Seek back / forward |
| `↑` / `↓` | Previous / next episode |

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
│   ├── ui/                # shell, router, screens, mini player, theme, toast, waveform
│   ├── i18n/              # 8 languages, compile-time key completeness
│   ├── styles/            # tokens / themes / base / components
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

**▶ Canlı:** https://iacbi.github.io/seseri/ ·
**🪟 Windows uygulaması:** [kurulumu indir](https://github.com/IACBI/seseri/releases/latest)

### ✨ Özellikler

| | |
|---|---|
| 🔍 **Podcast arama** | isim, Apple Podcasts linki veya doğrudan RSS URL'si |
| ▶️ **YouTube yayınları** | **isimle ara** (kanal/playlist/videolar sonuçlarda listelenir) veya link yapıştır; ses Worker üzerinden akar (Innertube + range destekli proxy → arka plan/kilit ekranı çalma) ya da Piped'e, o da olmazsa resmi `youtube-nocookie` embed'e düşer |
| 📥 **Çevrimdışı bölümler** | indirilenler Cache API'de yaşar, bağlantısız çalar ve sarar; feed'ler IndexedDB'de önbelleklenir, arka planda tazelenir |
| 🧾 **Kuyruk** | bölümü "sıradaki" olarak işaretle — kuyruk, liste sırasından önce gelir |
| 🎧 **Mini oynatıcı** | feed'den çıkınca çalma sürer; ana ekrandaki yüzen bar seni geri götürür |
| 🌊 **Dalga-form çubuğu** | bölüme özel, sürüklenebilir dalga-form; canlı oynatma başı |
| 🎛 **Tam oynatıcı** | oynat/duraklat, önceki/sonraki, atlama, 0.5×–2.5× hız, uyku zamanlayıcısı |
| 🖥 **Masaüstü düzeni** | ≥900px'te solda kütüphane rayı, sağda bölüm paneli |
| ⭐ **Abonelikler** | yıldızla; OPML içe/dışa aktarma + JSON yedek |
| 🎨 **Temalar** | Otomatik (sistem), Koyu, Açık, OLED Siyah; 7 vurgu rengi |
| 🌍 **Çok dilli** | TR / EN / DE / FR / ES / AR / JA / RU (RTL dahil) |
| 📲 **Kurulabilir** | maskable/monochrome ikonlu PWA, kısayollar, mağaza görselleri |
| ♿ **Erişilebilir** | native `<dialog>` ayarlar, aria-live durum, klavye, `prefers-reduced-motion` |

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
