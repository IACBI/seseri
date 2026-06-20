# Seseri

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-live-brightgreen)](https://iacbi.github.io/seseri/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-ready-5b8af5)](manifest.json)
[![No dependencies](https://img.shields.io/badge/dependencies-0-success)](#technology)

A free, no-account, browser-based podcast player. Search with the iTunes API,
paste any RSS feed URL, or drop a YouTube playlist/channel link — no backend, no
sign-up, no tracking. One HTML file, zero dependencies.

**▶ Live:** https://iacbi.github.io/seseri/

**Language / Dil:** **[English](#lang-en)** · **[Türkçe](#lang-tr)**

---

<a id="lang-en"></a>

## English

### ✨ Features

| | |
|---|---|
| 🔍 **Podcast search** | by name, Apple Podcasts link, or a direct RSS feed URL |
| ▶️ **YouTube shows** | paste a YouTube playlist / channel / video link — streamed as audio via public Piped/Invidious instances (ad-free, background, download, full list with dates), with an official `youtube-nocookie` embed fallback when those servers are down |
| 🌊 **Waveform scrubber** | a per-episode waveform you can drag to seek, with a live playhead and time tooltip |
| 🎛 **Full player** | play/pause, previous/next, skip back/forward, speed control (0.5×–2.5×) |
| ⏯ **Resume playback** | episode progress is saved to `localStorage` |
| ⭐ **Subscriptions** | star podcasts and find them on the home screen |
| 🔗 **Share links** | `?podcast=<id>` / `?rss=<url>` deep links to any podcast |
| 🌙 **Sleep timer** | pause automatically after 15 / 30 / 60 minutes |
| 📱 **Lock-screen controls** | Media Session API (headset / lock-screen buttons) |
| 📋 **Episode list** | date sorting, in-list filtering, per-episode download |
| 🎨 **Themes** | Dark, Light, OLED Black; 7 accent colors |
| 🌍 **Multilingual** | TR / EN / DE / FR / ES / AR / JA / RU (incl. RTL) |
| 📲 **PWA** | "Add to Home Screen"; offline shell via Service Worker |
| ♿ **Accessible** | keyboard-operable, visible focus, full `prefers-reduced-motion` support |

#### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / pause |
| `←` / `→` | Seek back / forward |
| `↑` / `↓` | Previous / next episode |

### 🚀 Getting started

Open `index.html` directly in a browser — no build step required. For local
development, serve it over HTTP so the Service Worker can register:

```bash
npx serve .
# or
python -m http.server 8080
```

Then visit `http://localhost:8080`.

#### Deploy your own copy

Fork the repository and enable **GitHub Pages**:
`Settings → Pages → Source: GitHub Actions` (a deploy workflow is included).

> The app is **path-independent**: the manifest `scope`/`start_url`, the Service
> Worker, and the `404.html` redirect all resolve paths relative to where the app
> is served — so it works unchanged on a project page (`/seseri/`), a user/org
> page, or a custom domain, with no configuration.

### 📁 File structure

```
.
├── index.html          # The whole app (CSS + JS inline)
├── manifest.json       # PWA manifest
├── sw.js               # Service Worker (network-first HTML, cache-first assets)
├── privacy-policy.html # Privacy policy (TR + EN)
├── 404.html            # GitHub Pages SPA fallback
├── icons/              # PWA icons (192 / 512)
└── .github/workflows/  # GitHub Pages deployment
```

### 🛠 Technology

- Vanilla JS (ES2022) — no framework, no build tools, zero dependencies
- [iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/) for podcast search & episode lookup, with a cache-busting workaround for the iTunes CDN's cross-origin caching quirk
- RSS feeds (and an iTunes fallback) fetched through public CORS proxies — [AllOrigins](https://allorigins.win/), with [corsproxy.io](https://corsproxy.io/) as backup
- `<audio>` element + Media Session API; the waveform is generated locally from a deterministic per-episode seed
- Cache API + Service Worker for the offline shell
- Content Security Policy + HTML escaping for all dynamic content

### 🔒 Privacy

No analytics, no accounts, no server. All settings and playback progress stay in
your browser's `localStorage`. See [privacy-policy.html](privacy-policy.html).

### 🤝 Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
Security reports: [SECURITY.md](SECURITY.md). Release history: [CHANGELOG.md](CHANGELOG.md).

### 👤 Author

**𝓐.𝓒.𝓑** — bozdogancanahmet@gmail.com

### 📄 License

[MIT](LICENSE) © 2026 𝓐.𝓒.𝓑

<sub>[↑ Language / Dil](#seseri)</sub>

---

<a id="lang-tr"></a>

## Türkçe

Ücretsiz, üyeliksiz, tarayıcı tabanlı bir podcast dinleyici. iTunes API ile ara,
herhangi bir RSS besleme URL'si veya bir YouTube playlist/kanal linki yapıştır —
arka uç yok, kayıt yok, takip yok. Tek HTML dosyası, sıfır bağımlılık.

**▶ Canlı:** https://iacbi.github.io/seseri/

### ✨ Özellikler

| | |
|---|---|
| 🔍 **Podcast arama** | isim, Apple Podcasts linki veya doğrudan RSS besleme URL'si ile |
| ▶️ **YouTube yayınları** | YouTube playlist / kanal / video linki yapıştır — herkese açık Piped/Invidious sunucuları üzerinden ses olarak (reklamsız, arka plan, indirme, tarihli tam liste); sunucular kapalıysa resmi `youtube-nocookie` embed'e düşer |
| 🌊 **Dalga-form çubuğu** | bölüme özel, sürükleyerek konumlandırılabilen dalga-form; canlı oynatma başı ve zaman ipucu |
| 🎛 **Tam oynatıcı** | oynat/duraklat, önceki/sonraki, ileri/geri atlama, hız kontrolü (0.5×–2.5×) |
| ⏯ **Kaldığın yerden devam** | bölüm ilerlemesi `localStorage`'a kaydedilir |
| ⭐ **Abonelikler** | podcast'leri yıldızla, açılış ekranında listele |
| 🔗 **Link paylaşımı** | `?podcast=<id>` / `?rss=<url>` derin linkleri |
| 🌙 **Uyku zamanlayıcısı** | 15 / 30 / 60 dakika sonra otomatik duraklat |
| 📱 **Kilit ekranı kontrolleri** | Media Session API (kulaklık / kilit ekranı tuşları) |
| 📋 **Bölüm listesi** | tarih sıralama, liste içi arama, bölüm bazında indirme |
| 🎨 **Temalar** | Koyu, Açık, OLED Siyah; 7 vurgu rengi |
| 🌍 **Çok dilli** | TR / EN / DE / FR / ES / AR / JA / RU (RTL dahil) |
| 📲 **PWA** | "Ana Ekrana Ekle"; Service Worker ile çevrimdışı kabuk |
| ♿ **Erişilebilir** | klavyeyle kullanılabilir, görünür odak, tam `prefers-reduced-motion` desteği |

#### Klavye kısayolları

| Tuş | İşlev |
|-----|-------|
| `Space` | Oynat / duraklat |
| `←` / `→` | Geri / ileri sar |
| `↑` / `↓` | Önceki / sonraki bölüm |

### 🚀 Hızlı başlangıç

`index.html`'i doğrudan tarayıcıda açın — build adımı gerekmez. Yerel geliştirme
için Service Worker'ın kaydolabilmesi adına HTTP üzerinden sunun:

```bash
npx serve .
# veya
python -m http.server 8080
```

Ardından `http://localhost:8080` adresini ziyaret edin.

#### Kendi kopyanızı yayınlayın

Repository'yi fork edin ve **GitHub Pages**'i etkinleştirin:
`Settings → Pages → Source: GitHub Actions` (deploy workflow'u dahildir).

> Uygulama **yoldan bağımsızdır**: manifest `scope`/`start_url`, Service Worker ve
> `404.html` yönlendirmesi tüm yolları sunulduğu yere göre çözer — yani bir proje
> sayfasında (`/seseri/`), kullanıcı/organizasyon sayfasında veya özel alan adında
> hiçbir ayar yapmadan çalışır.

### 📁 Dosya yapısı

```
.
├── index.html          # Tüm uygulama (CSS + JS dahil)
├── manifest.json       # PWA manifest
├── sw.js               # Service Worker (HTML için network-first, varlıklar için cache-first)
├── privacy-policy.html # Gizlilik politikası (TR + EN)
├── 404.html            # GitHub Pages SPA fallback
├── icons/              # PWA ikonları (192 / 512)
└── .github/workflows/  # GitHub Pages dağıtımı
```

### 🛠 Teknoloji

- Vanilla JS (ES2022) — framework yok, build aracı yok, sıfır bağımlılık
- Podcast arama ve bölüm sorgulama için [iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/); iTunes CDN'inin çapraz-köken önbellek sorunu için cache-busting çözümü
- RSS beslemeleri (ve iTunes yedeği) herkese açık CORS proxy'leri üzerinden çekilir — [AllOrigins](https://allorigins.win/), yedek olarak [corsproxy.io](https://corsproxy.io/)
- `<audio>` elementi + Media Session API; dalga-form, bölüme özel deterministik bir tohumdan yerelde üretilir
- Çevrimdışı kabuk için Cache API + Service Worker
- Content Security Policy + tüm dinamik içerik için HTML kaçışlama

### 🔒 Gizlilik

Analitik yok, hesap yok, sunucu yok. Tüm ayarlar ve dinleme ilerlemesi
tarayıcınızın `localStorage`'ında kalır. Bkz. [privacy-policy.html](privacy-policy.html).

### 🤝 Katkı

Katkılarınızı bekliyoruz — bkz. [CONTRIBUTING.md](CONTRIBUTING.md).
Güvenlik bildirimleri: [SECURITY.md](SECURITY.md). Sürüm geçmişi: [CHANGELOG.md](CHANGELOG.md).

### 👤 Yazar

**𝓐.𝓒.𝓑** — bozdogancanahmet@gmail.com

### 📄 Lisans

[MIT](LICENSE) © 2026 𝓐.𝓒.𝓑

<sub>[↑ Language / Dil](#seseri)</sub>
