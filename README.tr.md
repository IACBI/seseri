# 🎧 Podcast Player

[English](README.md) · **Türkçe**

Ücretsiz, üyeliksiz, tarayıcı tabanlı podcast dinleyici.
iTunes Search API veya herhangi bir RSS besleme URL'si kullanır — arka uç ve hesap gerekmez.

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-live-brightgreen)](https://iacbi.github.io/podcast-player/)

**▶ Canlı demo:** https://iacbi.github.io/podcast-player/

---

## Özellikler

- **Podcast Arama** — isim, Apple Podcasts linki veya doğrudan RSS besleme URL'si ile
- **Tam Oynatıcı** — play/pause, önceki/sonraki, ileri/geri atlama, hız kontrolü (0.5×–2.5×)
- **Kaldığın Yerden Devam** — bölüm ilerlemesi `localStorage`'a kaydedilir
- **Abonelikler** — podcast'leri yıldızla, açılış ekranında listele
- **Link Paylaşımı** — `?podcast=<id>` / `?rss=<url>` derin linkleri
- **Uyku Zamanlayıcısı** — 15/30/60 dakika sonra otomatik duraklat
- **Kilit Ekranı Kontrolleri** — Media Session API (kulaklık / kilit ekranı tuşları)
- **Bölüm Listesi** — tarih sıralama, bölüm içi arama, indirme butonu
- **Klavye Kısayolları** — Space oynat/duraklat, ←/→ sar, ↑/↓ önceki/sonraki bölüm
- **Çoklu Tema** — Koyu, Açık, OLED Siyah; 7 vurgu rengi
- **Çok Dilli** — TR / EN / DE / FR / ES / AR / JA / RU (RTL dahil)
- **PWA** — "Ana Ekrana Ekle" desteği; Service Worker ile offline kabuk

## Ekran Görüntüleri

<!-- TODO: ekran görüntüleri ekleyin, örn. docs/screenshot-player.png -->

---

## Kullanım

Doğrudan tarayıcıda açın — build adımı gerekmez:

```bash
# Geliştirme için basit HTTP sunucu
npx serve .
# veya
python -m http.server 8080
```

Ya da repository'i fork edin ve **GitHub Pages**'i etkinleştirin:
`Settings → Pages → Source: GitHub Actions` (deploy workflow'u dahildir).

> Not: uygulama `/podcast-player/` alt dizinine göre yapılandırılmıştır
> (`manifest.json` `start_url`/`scope`, `sw.js` precache yolları). Farklı bir
> yola dağıtıyorsanız bu değerleri güncelleyin.

---

## Dosya Yapısı

```
.
├── index.html          # Uygulama (tek dosya — CSS + JS dahil)
├── manifest.json       # PWA manifest
├── sw.js               # Service Worker (cache-first)
├── privacy-policy.html # Gizlilik politikası
├── 404.html            # GitHub Pages SPA fallback
├── icons/              # PWA ikonları (192 / 512)
└── .github/workflows/  # GitHub Pages dağıtımı
```

---

## Teknoloji

- Vanilla JS (ES2022) — framework yok, build aracı yok
- [iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/)
- RSS beslemeleri herkese açık CORS proxy'leri üzerinden çekilir ([AllOrigins](https://allorigins.win/), yedek olarak [corsproxy.io](https://corsproxy.io/))
- `<audio>` elementi + Media Session API
- Cache API + Service Worker

## Gizlilik

Analitik yok, hesap yok, sunucu yok. Tüm ayarlar ve dinleme ilerlemesi
tarayıcınızın `localStorage`'ında kalır. Bkz. [privacy-policy.html](privacy-policy.html).

---

## Katkı

Bkz. [CONTRIBUTING.md](CONTRIBUTING.md). Güvenlik bildirimleri: [SECURITY.md](SECURITY.md).

## Lisans

[MIT](LICENSE)
