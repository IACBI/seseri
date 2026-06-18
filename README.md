# Seseri

**English** · [Türkçe](README.tr.md)

Seseri — a free, no-account, browser-based podcast player.
Uses the iTunes Search API or any RSS feed URL — no backend, no sign-up, no tracking.

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-live-brightgreen)](https://iacbi.github.io/podcast-player/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-ready-5b8af5)](manifest.json)

**▶ Live demo:** https://iacbi.github.io/podcast-player/

---

## ✨ Features

| | |
|---|---|
| 🔍 **Podcast search** | by name, Apple Podcasts link, or a direct RSS feed URL |
| 🎛 **Full player** | play/pause, previous/next, skip back/forward, speed control (0.5×–2.5×) |
| ⏯ **Resume playback** | episode progress is saved to `localStorage` |
| ⭐ **Subscriptions** | star podcasts and find them on the home screen |
| 🔗 **Share links** | `?podcast=<id>` / `?rss=<url>` deep links to any podcast |
| 🌙 **Sleep timer** | pause automatically after 15/30/60 minutes |
| 📱 **Lock-screen controls** | Media Session API (headset / lock-screen buttons) |
| 📋 **Episode list** | date sorting, in-list filtering, download button |
| 🎨 **Themes** | Dark, Light, OLED Black; 7 accent colors |
| 🌍 **Multilingual** | TR / EN / DE / FR / ES / AR / JA / RU (incl. RTL) |
| 📲 **PWA** | "Add to Home Screen"; offline shell via Service Worker |

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / pause |
| `←` / `→` | Seek back / forward |
| `↑` / `↓` | Previous / next episode |

---

## 🚀 Getting started

Open directly in a browser — no build step required:

```bash
# Simple HTTP server for development
npx serve .
# or
python -m http.server 8080
```

Then visit `http://localhost:8080`.

### Deploy your own copy

Fork the repository and enable **GitHub Pages**:
`Settings → Pages → Source: GitHub Actions` (a deploy workflow is included).

> **Note:** the app is configured for the `/podcast-player/` subdirectory
> (`manifest.json` `start_url`/`scope`, `sw.js` precache paths, `404.html` redirect).
> If you deploy under a different path, update those values.

---

## 📁 File structure

```
.
├── index.html          # The app (single file — CSS + JS included)
├── manifest.json       # PWA manifest
├── sw.js               # Service Worker (cache-first)
├── privacy-policy.html # Privacy policy (TR + EN)
├── 404.html            # GitHub Pages SPA fallback
├── icons/              # PWA icons (192 / 512)
└── .github/workflows/  # GitHub Pages deployment
```

---

## 🛠 Technology

- Vanilla JS (ES2022) — no framework, no build tools, zero dependencies
- [iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/) for podcast search & episode lookup
- RSS feeds are fetched through public CORS proxies ([AllOrigins](https://allorigins.win/), with [corsproxy.io](https://corsproxy.io/) as fallback)
- `<audio>` element + Media Session API
- Cache API + Service Worker for the offline shell
- Content Security Policy + HTML escaping for all dynamic content

## 🔒 Privacy

No analytics, no accounts, no server. All settings and playback progress stay
in your browser's `localStorage`. See [privacy-policy.html](privacy-policy.html).

---

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.
Security reports: [SECURITY.md](SECURITY.md). Release history: [CHANGELOG.md](CHANGELOG.md).

## 👤 Author

**𝓐.𝓒.𝓑** — bozdogancanahmet@gmail.com

## 📄 License

[MIT](LICENSE) © 2026 𝓐.𝓒.𝓑
