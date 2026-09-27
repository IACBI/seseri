<a id="top"></a>
# Seseri

A free, no-account podcast player that runs in the browser, installs as an app, and plays offline.

[![CI](https://github.com/IACBI/seseri/actions/workflows/ci.yml/badge.svg)](https://github.com/IACBI/seseri/actions/workflows/ci.yml)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-live-brightgreen)](https://iacbi.github.io/seseri/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-ready-5b8af5)](public/manifest.webmanifest)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](tsconfig.json)

**Read this in:** [English](#english) · [Türkçe](#turkce)

---

<a id="english"></a>
## English

### Overview

Search Apple Podcasts or paste any RSS feed URL, then stream, resume, queue and
download episodes for offline listening. No account, no analytics, nothing to
sign up for.

The front end is Vite and strict TypeScript with no UI framework. An optional
Cloudflare Worker proxies and parses feeds, and stores the encrypted blob that
cross-device sync uses. The app ships as a PWA on GitHub Pages and as a Windows
app (a Tauri shell around the live site).

**Live:** https://iacbi.github.io/seseri/ ·
**Windows app:** [download the installer](https://github.com/IACBI/seseri/releases/latest)

The design is called "Sinyal": warm charcoal surfaces, an amber accent and a
frequency-line waveform. There are four sections — **Home** (new episodes,
continue listening, subscriptions), **Search**, **Library** (subscriptions and
downloads) and **Settings** — in a bottom tab bar on phones and a left rail on
desktop, plus a full-screen **Now Playing** sheet.

### Features

| | |
|---|---|
| **Podcast search** | by name, Apple Podcasts link, or a direct RSS feed URL — or start from one of eight topics |
| **The whole archive** | episode lists come from the show's own feed, so they are the complete back catalogue, not the slice Apple returns (41 episodes of The Daily's 2 676). The Worker parses the feed when one is configured (The Daily: 19.95 MB of XML in, 2.28 MB of JSON out) and pages through archives longer than 5 000 episodes; without a Worker the device parses it |
| **Played state** | finishing an episode marks it, or mark it yourself; filter a list to **All**, **Unplayed**, **In progress** or **Downloaded**. Marking an episode unplayed clears its saved position |
| **New episodes** | what has appeared across every show you follow since you last looked, on the home screen, with an app badge where the platform has one. "Check for new episodes" tells you when a show could not be reached |
| **Chapters & transcripts** | Podcasting 2.0 chapters as a list plus markers on the scrubber, and VTT/SRT transcripts cue by cue with the playing line highlighted and every line seekable. Both fetched only when opened |
| **Offline episodes** | downloads live in the Cache API and play (and seek) with no connection, showing a real percentage and cancellable while they run. Feeds are cached in IndexedDB, bounded (anything over 30 days old goes, then the oldest until the cache is under 80 MB, never below five feeds) and refreshed in the background |
| **Automatic downloads** | optionally fetch new episodes of the shows you follow in the background, and optionally delete a download once the episode is finished — finished only, so nothing you are part-way through is removed |
| **Play queue** | queue any episode as "up next"; the queue wins over list order |
| **Mini player** | leaving a feed keeps playing; the dock carries skip/play controls (plus prev/next and speed on wide screens) and a seekable progress line, and opens the full **Now Playing** sheet. A title too long for the dock drifts end to end instead of ending in an ellipsis |
| **Now Playing sheet** | full-screen at every size: play/pause, prev/next, skip, speed 0.5×–2.5×, volume, sleep timer, episode notes, chapters, transcript — around a drag-to-seek waveform |
| **Episode links** | share a link that opens on that episode, and from Now Playing at the moment you are at |
| **Per-show speed** | a show can play at its own speed instead of the default; Settings lists the ones that do and resets them |
| **Sleep timer** | presets or any duration, or stop at the end of the episode; live countdown, **+5 min**, gentle fade-out, pauses with playback and survives a reload |
| **Sharp artwork** | each surface requests the right rendition, so covers are never upscaled from a thumbnail; the Now Playing background can take the cover's dominant colour |
| **Volume** | a slider in Now Playing on every device, and in the dock from 1024px up; mute keeps the level you chose. Hidden on iOS, where the page may not set it |
| **Desktop layout** | from 900px a left rail replaces the tab bar, with Settings at its foot. Collapse it to an icon rail from the toggle beside the wordmark or with `[`; pointing at the collapsed rail peeks it open over the page |
| **Subscriptions** | star a show to follow it; OPML import and export (shows followed through Apple are exported with their feed address, so other podcast apps can read the file, and an import skips shows you already follow) plus a JSON backup |
| **Themes** | Auto (system), Dark, Light, OLED Black; seven accent colours |
| **Multilingual** | TR / EN / DE / FR / ES / AR / JA / RU, including right-to-left |
| **Accessible** | keyboard-operable throughout, live status regions, focus moved sensibly on navigation, `prefers-reduced-motion` respected. A long episode list is one tab stop with arrow keys between rows and across each row's buttons |
| **Private by construction** | no analytics, no accounts, and no third-party request to draw the interface — the typefaces are served from the app's own origin |
| **Recoverable** | if start-up fails the app says so, with a reload button and a two-tap data wipe, instead of a blank page. Settings can copy a diagnostics report to the clipboard; it is sent nowhere |

#### Cross-device sync

Off until you turn it on, and account-free. One device generates a pairing code
in **Settings → Cross-device sync**; type it into the other and they share
resume positions, played marks, the last-played episode per show,
subscriptions and the queue.

The payload is encrypted on the device. Two independent values are derived from
the code with HKDF-SHA256 — the id the server files the row under, and the
AES-GCM key — so the backend holds bytes it cannot read.

- Font size, theme, volume and speeds are **not** synced; they belong to the
  device.
- Writes on two devices within a minute of each other count as simultaneous,
  and the further position wins.
- Unlinking stops syncing on that device and keeps everything it already has.
  **Delete server data** removes the stored copy for every device.
- **Keep the code.** It is the only credential; lose it and the synced copy is
  gone, though each device keeps its own data.

### Requirements

To use it: any current browser. Chromium-based browsers and Safari can install
it as an app.

To work on it:

- **Node.js 22** or newer (the Worker's tooling needs 22; CI runs 22).
- A Chromium browser for the headless smoke tests — Chrome is found
  automatically, `SESERI_BROWSER` points at another.
- For the Worker: a Cloudflare account (the free tier is enough).
- For the Windows app: the Rust toolchain, which Tauri needs.

### Installation

**As a listener**

- **Web:** open https://iacbi.github.io/seseri/ and use the browser's
  *Install app* option to put it on the home screen or desktop.
- **Windows:** the ~1.8 MB NSIS installer on
  [GitHub Releases](https://github.com/IACBI/seseri/releases/latest). It loads
  the live site, so it updates with every web release. It is not code-signed
  yet, so SmartScreen warns on first run.
- **Android:** a Trusted Web Activity built from the live PWA with
  [PWABuilder](https://www.pwabuilder.com/).

The release steps for each channel are in [docs/STORE.md](docs/STORE.md).

**For development**

```bash
git clone https://github.com/IACBI/seseri.git
cd seseri
npm install
npm --prefix worker install   # only if you run the Worker
```

### Usage

```bash
npm run dev           # http://localhost:5199
npm run worker:dev    # the Worker on http://127.0.0.1:8787 (optional)
```

`.env.development` points the dev server at the local Worker; without it
running, the app falls back as described under [Configuration](#configuration).

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `preview` | dev server / production build / serve `dist` |
| `npm test` | the unit suites (Vitest) |
| `npm run lint` / `typecheck` | ESLint / `tsc --noEmit` |
| `npm run worker:dev` / `worker:test` | the Worker under `wrangler dev` / its tests in the Workers runtime |
| `npm run verify` | lint, typecheck, unit tests, build, Worker typecheck and tests — the gate before any change |
| `npm run smoke` | the seven headless browser smokes CI runs |
| `node scripts/smoke-p4-worker.cjs` | a real RSS feed through the local Worker (needs `worker:dev`) |
| `node scripts/smoke-live.cjs [url]` | the deployed site against real CDNs, including CSP violations |
| `node scripts/store-shots.cjs` | regenerate the install screenshots in `public/screenshots/` |
| `node scripts/shot.cjs [dir]` | regenerate the reference screenshots in `docs/screens-v4/` |
| `node scripts/icons.cjs` | regenerate every PNG icon from `public/icons/seseri.svg` |

#### Keyboard shortcuts

None of them fire while you type in a field. The transport keys follow whatever
is playing, so they work from any view.

| Key | Action |
|-----|--------|
| `Space` | Play / pause |
| `←` / `→` | Seek back / forward |
| `↑` / `↓` | Previous / next episode |
| `Home` / `End` | Jump to the start / end of the episode |
| `[` | Collapse or expand the rail (desktop) |
| `Esc` | Close the Now Playing sheet |
| `?` | Show the shortcut list |
| `↑` / `↓` in a list | Move between episode rows (`←` / `→` for a row's own buttons) |

### Configuration

Build-time variables:

| Variable | Meaning |
|---|---|
| `VITE_API_BASE` | the Worker's URL. Empty means no Worker: feeds are fetched and parsed on the device |
| `VITE_SYNC` | `1` turns on cross-device sync, which also needs `VITE_API_BASE`. Separate on purpose, so sync can be switched off without losing the feed and iTunes proxies |

The GitHub Pages workflow reads both from repository variables of the same
names.

**Running your own Worker.** Deploy with `cd worker && npx wrangler login && npx wrangler deploy`.
On a new Cloudflare account, put your own D1 database id in
`worker/wrangler.jsonc` and create the table with
`npx wrangler d1 migrations apply seseri-sync --remote`. The Worker answers only
the origins listed in `ALLOWED_ORIGINS` in `worker/src/index.ts`, so add your
own site there.

**Without a Worker, or when it cannot answer,** the app asks iTunes directly
from the browser. Apple sometimes refuses requests from Cloudflare's servers;
when the Worker reports that, the app goes to iTunes directly for the next 30
minutes and then tries the Worker again. Public CORS proxies for feeds are a
last resort and **off by default** (Settings → Privacy): their operators would
see every feed you open. A feed URL that carries a private subscriber token
(Patreon, Memberful, Substack and the like) is never sent to them, whatever the
setting — it goes through your own Worker or fails with a clear message.

### Contributing

The rules a change has to satisfy — the XSS invariant, complete translations,
design tokens, settings validation, the CSP — are in
[CONTRIBUTING.md](CONTRIBUTING.md). Run `npm run verify`, and the smoke that
covers the area you touched, before opening a pull request. The manual release
checklist is [docs/TESTPLAN.md](docs/TESTPLAN.md).

```
.
├── index.html             # Vite entry (CSP, meta, manifest link)
├── src/
│   ├── app.ts             # boot & wiring
│   ├── feeds/             # search, RSS scanning (shared with the Worker), proxy chain,
│   │                      # archive paging, Apple→feed id remap, new episodes, show notes
│   ├── player/            # audio engine, recovery, prefetch, downloads, chapters,
│   │                      # transcripts, sleep timer, media session
│   ├── state/             # signals: settings, queue, per-show speed, sleep timer
│   ├── storage/           # localStorage keys, IndexedDB, OPML, backup
│   ├── sync/              # pairing code, encryption, merge, transport
│   ├── ui/                # views, router, playback controller, shell and widgets
│   ├── i18n/              # 8 languages, completeness checked at compile time
│   ├── styles/            # design tokens, layers, one stylesheet per view, fonts
│   └── sw.ts              # service worker
├── worker/                # Cloudflare Worker (Hono): /v1/feed /v1/parse /v1/itunes /v1/sync
├── desktop/               # Tauri v2 shell for Windows
├── public/                # manifest, icons, install screenshots, privacy policy
├── scripts/               # smoke tests, screenshot and icon generators
└── docs/                  # test plan, store guide, reference screenshots
```

### License

[MIT](LICENSE) © 2026 **𝓐.𝓒.𝓑** — bozdogancanahmet@gmail.com. Privacy policy:
[public/privacy-policy.html](public/privacy-policy.html).

[⬆ Back to top](#top)

---

<a id="turkce"></a>
## Türkçe

### Genel Bakış

Apple Podcasts'te ara ya da herhangi bir RSS adresini yapıştır; bölümleri
dinle, kaldığın yerden devam et, kuyruğa ekle, çevrimdışı dinlemek için indir.
Hesap yok, analitik yok, üye olunacak bir şey yok.

Ön yüz, arayüz çatısı kullanmadan Vite ve strict TypeScript ile yazıldı.
İsteğe bağlı bir Cloudflare Worker feed'leri vekil olarak çeker ve ayrıştırır,
cihazlar arası eşitlemenin şifreli verisini de o saklar. Uygulama GitHub
Pages'te PWA olarak ve Windows uygulaması olarak (canlı siteyi saran bir Tauri
kabuğu) yayınlanıyor.

**Canlı:** https://iacbi.github.io/seseri/ ·
**Windows uygulaması:** [kurulumu indir](https://github.com/IACBI/seseri/releases/latest)

Tasarımın adı "Sinyal": sıcak antrasit yüzeyler, kehribar vurgu rengi ve
frekans çizgisi biçiminde bir dalga-form. Dört bölüm var — **Ana Sayfa** (yeni
bölümler, kaldığın yerden devam et, abonelikler), **Ara**, **Kütüphane**
(abonelikler ve indirilenler) ve **Ayarlar**. Telefonda alttaki sekme
çubuğunda, masaüstünde soldaki şeritte durur; bir de tam ekran **Şimdi Çalıyor**
paneli var.

### Özellikler

| | |
|---|---|
| **Podcast arama** | isim, Apple Podcasts linki veya doğrudan RSS adresi — ya da sekiz konu başlığından biriyle başla |
| **Arşivin tamamı** | bölüm listeleri yayının kendi feed'inden gelir; Apple'ın döndürdüğü dilim değil (The Daily'nin 2 676 bölümünden 41'i), arşivin tümü. Worker yapılandırılmışsa feed'i o ayrıştırır (The Daily: 19,95 MB XML girer, 2,28 MB JSON çıkar) ve 5 000 bölümden uzun arşivleri sayfa sayfa getirir; Worker yoksa cihaz ayrıştırır |
| **Dinlendi durumu** | bölümü bitirmek işaretler, istersen kendin de işaretlersin; liste **Tümü**, **Dinlenmemiş**, **Devam eden** veya **İndirilenler** olarak süzülür. Bir bölümü dinlenmedi işaretlemek kayıtlı konumunu da siler |
| **Yeni bölümler** | takip ettiğin yayınlarda en son baktığından beri ne çıktıysa ana sayfada toplanır, platform destekliyorsa uygulama simgesinde sayıyla. "Yenilikleri denetle", ulaşılamayan yayın olursa bunu söyler |
| **Bölüm işaretleri ve konuşma metni** | Podcasting 2.0 bölüm işaretleri liste olarak ve sarma çizgisinde işaretlerle; VTT/SRT konuşma metni satır satır, çalan satır vurgulu, her satıra atlanabilir. İkisi de ancak açınca indirilir |
| **Çevrimdışı bölümler** | indirilenler Cache API'de durur, bağlantısız çalar ve sarılır; inerken gerçek yüzde gösterir, iptal edilebilir. Feed'ler IndexedDB'de önbelleğe alınır ve sınırlıdır (30 günden eskiler silinir, sonra önbellek 80 MB'ın altına inene kadar en eskiler — ama hiçbir zaman beş feed'in altına inmez) ve arka planda tazelenir |
| **Otomatik indirme** | takip ettiğin yayınların yeni bölümleri istersen arka planda iner; istersen bölüm bitince kopyası silinir — yalnızca bitenler, yarısında bıraktığın hiçbir şey silinmez |
| **Kuyruk** | herhangi bir bölümü "sıradaki" yap; kuyruk, liste sırasından önce gelir |
| **Mini oynatıcı** | feed'den çıkınca çalma sürer; alttaki çubukta atlama/oynatma düğmeleri (geniş ekranda önceki/sonraki ve hız) ve sarılabilir bir ilerleme çizgisi var, tam **Şimdi Çalıyor** panelini açar. Sığmayan başlık üç noktayla kesilmek yerine baştan sona kayar |
| **Şimdi Çalıyor paneli** | her ekran boyutunda tam ekran: oynat/duraklat, önceki/sonraki, atlama, 0.5×–2.5× hız, ses düzeyi, uyku zamanlayıcısı, bölüm notları, bölüm işaretleri, konuşma metni — sürüklenerek sarılan bir dalga-formun çevresinde |
| **Bölüm linkleri** | o bölümü açan bir link paylaş; Şimdi Çalıyor'dan paylaşırsan bulunduğun andan açılır |
| **Yayın başına hız** | bir yayın varsayılan hız yerine kendi hızıyla çalabilir; Ayarlar bunları listeler ve sıfırlar |
| **Uyku zamanlayıcısı** | hazır süreler ya da istediğin süre, veya bölüm sonunda dur; canlı geri sayım, **+5 dk**, sesi yavaşça kısarak kapanma; duraklatınca durur, sayfa yenilenince kaybolmaz |
| **Net kapak görselleri** | her yüzey doğru çözünürlüğü ister, kapak küçük bir görselden büyütülmez; Şimdi Çalıyor arka planı kapağın baskın rengini alabilir |
| **Ses düzeyi** | her cihazda Şimdi Çalıyor'da, 1024px'ten itibaren alttaki çubukta da bir sürgü; sessize almak seçtiğin seviyeyi korur. iOS'ta gizlidir, orada sayfanın sesi ayarlamasına izin verilmez |
| **Masaüstü düzeni** | 900px'ten itibaren sekme çubuğunun yerini soldaki şerit alır, Ayarlar en altta durur. Kelime markasının yanındaki düğmeyle ya da `[` tuşuyla simge şeridine daraltılır; daraltılmış şeridin üzerine gelince sayfanın üstünde açılır |
| **Abonelikler** | bir yayını takip etmek için yıldızla; OPML içe ve dışa aktarma (Apple üzerinden takip edilen yayınlar feed adresleriyle dışa aktarılır, böylece diğer podcast uygulamaları dosyayı okuyabilir; içe aktarma zaten takip ettiklerini atlar) ve JSON yedek |
| **Temalar** | Otomatik (sistem), Koyu, Açık, OLED Siyah; yedi vurgu rengi |
| **Çok dilli** | TR / EN / DE / FR / ES / AR / JA / RU, sağdan sola yazılan diller dahil |
| **Erişilebilir** | baştan sona klavyeyle kullanılır, durum mesajları ekran okuyucuya duyurulur, gezinmede odak yerinde kalır, `prefers-reduced-motion`'a uyulur. Uzun bir bölüm listesi tek sekme durağıdır; satırlar arasında ve satırın düğmeleri arasında ok tuşlarıyla gezilir |
| **Yapısı gereği özel** | analitik yok, hesap yok, arayüzü çizmek için üçüncü tarafa istek yok — yazı tipleri de uygulamanın kendi adresinden gelir |
| **Kendini kurtarabilir** | açılış başarısız olursa boş sayfa yerine bunu söyler: yeniden yükleme düğmesi ve iki dokunuşla veri silme. Ayarlar bir tanılama raporunu panoya kopyalayabilir; rapor hiçbir yere gönderilmez |

#### Cihazlar arası eşitleme

Sen açana kadar kapalı ve hesap gerektirmiyor. Bir cihaz **Ayarlar → Cihazlar
Arası Eşitleme**'de bir eşleştirme kodu üretir; kodu öbürüne yazınca kaldığın
konumlar, dinlendi işaretleri, her yayında en son dinlenen bölüm, abonelikler
ve kuyruk ortak olur.

Veri cihazda şifrelenir. Koddan HKDF-SHA256 ile birbirinden bağımsız iki değer
türetilir — sunucunun satırı sakladığı kimlik ve AES-GCM anahtarı — yani arka
uç okuyamadığı baytları tutar.

- Yazı boyutu, tema, ses düzeyi ve hızlar eşitlenmez; bunlar cihaza aittir.
- İki cihazın bir dakika içindeki yazmaları eşzamanlı sayılır, daha ileri olan
  konum kazanır.
- Bağlantıyı kesmek yalnızca o cihazda eşitlemeyi durdurur, cihazdaki veriye
  dokunmaz. **Sunucudaki Veriyi Sil** saklanan kopyayı tüm cihazlar için
  kaldırır.
- **Kodu sakla.** Tek kimlik bilgisi odur; kaybedersen eşitlenen kopya da gider,
  ama her cihaz kendi verisini korur.

### Gereksinimler

Kullanmak için: güncel herhangi bir tarayıcı. Chromium tabanlı tarayıcılar ve
Safari uygulama olarak kurabilir.

Üzerinde çalışmak için:

- **Node.js 22** veya üstü (Worker araçları 22 istiyor; CI da 22 kullanıyor).
- Tarayıcıda koşan smoke testleri için bir Chromium — Chrome kendiliğinden
  bulunur, başkası için `SESERI_BROWSER` kullanılır.
- Worker için bir Cloudflare hesabı (ücretsiz katman yeterli).
- Windows uygulaması için Tauri'nin istediği Rust araç zinciri.

### Kurulum

**Dinleyici olarak**

- **Web:** https://iacbi.github.io/seseri/ adresini aç, tarayıcının
  *Uygulamayı yükle* seçeneğiyle ana ekrana ya da masaüstüne ekle.
- **Windows:** [GitHub Releases](https://github.com/IACBI/seseri/releases/latest)'teki
  ~1,8 MB'lık NSIS kurulumu. Canlı siteyi açtığı için her web sürümüyle
  kendiliğinden güncellenir. Henüz kod imzası yok, bu yüzden SmartScreen ilk
  açılışta uyarır.
- **Android:** canlı PWA'dan [PWABuilder](https://www.pwabuilder.com/) ile
  üretilen bir Trusted Web Activity.

Her kanalın yayın adımları [docs/STORE.md](docs/STORE.md)'de.

**Geliştirme için**

```bash
git clone https://github.com/IACBI/seseri.git
cd seseri
npm install
npm --prefix worker install   # only if you run the Worker
```

### Kullanım

```bash
npm run dev           # http://localhost:5199
npm run worker:dev    # the Worker on http://127.0.0.1:8787 (optional)
```

`.env.development` geliştirme sunucusunu yerel Worker'a yönlendirir; Worker
çalışmıyorsa uygulama [Yapılandırma](#yapilandirma)'da anlatıldığı gibi başka
yola düşer.

| Betik | Ne yapar |
|---|---|
| `npm run dev` / `build` / `preview` | geliştirme sunucusu / üretim derlemesi / `dist`'i sunar |
| `npm test` | birim testleri (Vitest) |
| `npm run lint` / `typecheck` | ESLint / `tsc --noEmit` |
| `npm run worker:dev` / `worker:test` | Worker'ı `wrangler dev` altında çalıştırır / testlerini Workers çalışma ortamında koşar |
| `npm run verify` | lint, tip denetimi, birim testleri, derleme, Worker tip denetimi ve testleri — her değişiklikten önceki kapı |
| `npm run smoke` | CI'ın koştuğu yedi tarayıcı smoke testi |
| `node scripts/smoke-p4-worker.cjs` | gerçek bir RSS feed'ini yerel Worker üzerinden dener (`worker:dev` gerekir) |
| `node scripts/smoke-live.cjs [url]` | yayındaki siteyi gerçek CDN'lere karşı dener, CSP ihlalleri dahil |
| `node scripts/store-shots.cjs` | `public/screenshots/` içindeki yükleme ekran görüntülerini yeniden üretir |
| `node scripts/shot.cjs [dir]` | `docs/screens-v4/` içindeki başvuru ekran görüntülerini yeniden üretir |
| `node scripts/icons.cjs` | tüm PNG simgeleri `public/icons/seseri.svg`'den yeniden üretir |

#### Klavye kısayolları

Bir alana yazarken hiçbiri çalışmaz. Oynatma tuşları o an çalanı izler, yani
her görünümde işe yarar.

| Tuş | İşlev |
|-----|--------|
| `Space` | Oynat / duraklat |
| `←` / `→` | Geri / ileri sar |
| `↑` / `↓` | Önceki / sonraki bölüm |
| `Home` / `End` | Bölümün başına / sonuna git |
| `[` | Şeridi daralt veya genişlet (masaüstü) |
| `Esc` | Şimdi Çalıyor panelini kapat |
| `?` | Kısayol listesini göster |
| Listede `↑` / `↓` | Bölüm satırları arasında gezin (`←` / `→` satırın kendi düğmeleri) |

<a id="yapilandirma"></a>
### Yapılandırma

Derleme sırasındaki değişkenler:

| Değişken | Anlamı |
|---|---|
| `VITE_API_BASE` | Worker'ın adresi. Boşsa Worker yok demektir: feed'ler cihazda çekilip ayrıştırılır |
| `VITE_SYNC` | `1`, cihazlar arası eşitlemeyi açar; ayrıca `VITE_API_BASE` gerekir. Bilerek ayrı: eşitleme kapatılırken feed ve iTunes vekilleri ayakta kalır |

GitHub Pages iş akışı ikisini de aynı adlı repo değişkenlerinden okur.

**Kendi Worker'ını çalıştırmak.** `cd worker && npx wrangler login && npx wrangler deploy`
ile yayınla. Yeni bir Cloudflare hesabında `worker/wrangler.jsonc`'deki D1
veritabanı kimliğini kendininkiyle değiştir ve tabloyu
`npx wrangler d1 migrations apply seseri-sync --remote` ile oluştur. Worker
yalnızca `worker/src/index.ts`'deki `ALLOWED_ORIGINS` listesindeki adreslere
yanıt verir; kendi siteni oraya ekle.

**Worker yoksa ya da yanıt veremiyorsa** uygulama iTunes'a tarayıcıdan
doğrudan gider. Apple zaman zaman Cloudflare sunucularından gelen istekleri
reddediyor; Worker bunu bildirince uygulama sonraki 30 dakika doğrudan gider,
sonra Worker'ı yeniden dener. Feed'ler için herkese açık CORS vekilleri son
çaredir ve **varsayılan olarak kapalıdır** (Ayarlar → Gizlilik): işletmecileri
açtığın her feed'i görür. Özel abone anahtarı taşıyan bir feed adresi (Patreon,
Memberful, Substack ve benzerleri) ayar ne olursa olsun onlara gönderilmez —
kendi Worker'ından geçer ya da açık bir hata mesajıyla başarısız olur.

### Katkı

Bir değişikliğin uyması gereken kurallar — XSS değişmezi, eksiksiz çeviriler,
tasarım token'ları, ayar doğrulaması, CSP —
[CONTRIBUTING.md](CONTRIBUTING.md)'de. Pull request açmadan önce `npm run verify`'ı
ve dokunduğun alanı kapsayan smoke testini çalıştır. Elle yapılan sürüm kontrol
listesi [docs/TESTPLAN.md](docs/TESTPLAN.md)'de.

```
.
├── index.html             # Vite entry (CSP, meta, manifest link)
├── src/
│   ├── app.ts             # boot & wiring
│   ├── feeds/             # search, RSS scanning (shared with the Worker), proxy chain,
│   │                      # archive paging, Apple→feed id remap, new episodes, show notes
│   ├── player/            # audio engine, recovery, prefetch, downloads, chapters,
│   │                      # transcripts, sleep timer, media session
│   ├── state/             # signals: settings, queue, per-show speed, sleep timer
│   ├── storage/           # localStorage keys, IndexedDB, OPML, backup
│   ├── sync/              # pairing code, encryption, merge, transport
│   ├── ui/                # views, router, playback controller, shell and widgets
│   ├── i18n/              # 8 languages, completeness checked at compile time
│   ├── styles/            # design tokens, layers, one stylesheet per view, fonts
│   └── sw.ts              # service worker
├── worker/                # Cloudflare Worker (Hono): /v1/feed /v1/parse /v1/itunes /v1/sync
├── desktop/               # Tauri v2 shell for Windows
├── public/                # manifest, icons, install screenshots, privacy policy
├── scripts/               # smoke tests, screenshot and icon generators
└── docs/                  # test plan, store guide, reference screenshots
```

### Lisans

[MIT](LICENSE) © 2026 **𝓐.𝓒.𝓑** — bozdogancanahmet@gmail.com. Gizlilik
politikası: [public/privacy-policy.html](public/privacy-policy.html).

[⬆ Başa Dön](#top)
