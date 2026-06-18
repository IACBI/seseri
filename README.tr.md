# Seseri

[English](README.md) · **Türkçe**

Seseri — ücretsiz, üyeliksiz, tarayıcı tabanlı podcast dinleyici.
iTunes Search API veya herhangi bir RSS besleme URL'si kullanır — arka uç yok, hesap yok, takip yok.

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-live-brightgreen)](https://iacbi.github.io/podcast-player/)
[![Lisans: MIT](https://img.shields.io/badge/Lisans-MIT-blue.svg)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-hazır-5b8af5)](manifest.json)

**▶ Canlı demo:** https://iacbi.github.io/podcast-player/

---

## ✨ Özellikler

| | |
|---|---|
| 🔍 **Podcast arama** | isim, Apple Podcasts linki veya doğrudan RSS besleme URL'si ile |
| 🎛 **Tam oynatıcı** | oynat/duraklat, önceki/sonraki, ileri/geri atlama, hız kontrolü (0.5×–2.5×) |
| ⏯ **Kaldığın yerden devam** | bölüm ilerlemesi `localStorage`'a kaydedilir |
| ⭐ **Abonelikler** | podcast'leri yıldızla, açılış ekranında listele |
| 🔗 **Link paylaşımı** | `?podcast=<id>` / `?rss=<url>` derin linkleri |
| 🌙 **Uyku zamanlayıcısı** | 15/30/60 dakika sonra otomatik duraklat |
| 📱 **Kilit ekranı kontrolleri** | Media Session API (kulaklık / kilit ekranı tuşları) |
| 📋 **Bölüm listesi** | tarih sıralama, liste içi arama, indirme butonu |
| 🎨 **Temalar** | Koyu, Açık, OLED Siyah; 7 vurgu rengi |
| 🌍 **Çok dilli** | TR / EN / DE / FR / ES / AR / JA / RU (RTL dahil) |
| 📲 **PWA** | "Ana Ekrana Ekle" desteği; Service Worker ile çevrimdışı kabuk |

### Klavye kısayolları

| Tuş | İşlev |
|-----|-------|
| `Space` | Oynat / duraklat |
| `←` / `→` | Geri / ileri sar |
| `↑` / `↓` | Önceki / sonraki bölüm |

---

## 🚀 Hızlı başlangıç

Doğrudan tarayıcıda açın — build adımı gerekmez:

```bash
# Geliştirme için basit HTTP sunucu
npx serve .
# veya
python -m http.server 8080
```

Ardından `http://localhost:8080` adresini ziyaret edin.

### Kendi kopyanızı yayınlayın

Repository'i fork edin ve **GitHub Pages**'i etkinleştirin:
`Settings → Pages → Source: GitHub Actions` (deploy workflow'u dahildir).

> **Not:** uygulama `/podcast-player/` alt dizinine göre yapılandırılmıştır
> (`manifest.json` `start_url`/`scope`, `sw.js` precache yolları, `404.html` yönlendirmesi).
> Farklı bir yola dağıtıyorsanız bu değerleri güncelleyin.

---

## 📁 Dosya yapısı

```
.
├── index.html          # Uygulama (tek dosya — CSS + JS dahil)
├── manifest.json       # PWA manifest
├── sw.js               # Service Worker (cache-first)
├── privacy-policy.html # Gizlilik politikası (TR + EN)
├── 404.html            # GitHub Pages SPA fallback
├── icons/              # PWA ikonları (192 / 512)
└── .github/workflows/  # GitHub Pages dağıtımı
```

---

## 🛠 Teknoloji

- Vanilla JS (ES2022) — framework yok, build aracı yok, sıfır bağımlılık
- Podcast arama ve bölüm sorgulama için [iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/)
- RSS beslemeleri herkese açık CORS proxy'leri üzerinden çekilir ([AllOrigins](https://allorigins.win/), yedek olarak [corsproxy.io](https://corsproxy.io/))
- `<audio>` elementi + Media Session API
- Çevrimdışı kabuk için Cache API + Service Worker
- Content Security Policy + tüm dinamik içerik için HTML kaçışlama

## 🔒 Gizlilik

Analitik yok, hesap yok, sunucu yok. Tüm ayarlar ve dinleme ilerlemesi
tarayıcınızın `localStorage`'ında kalır. Bkz. [privacy-policy.html](privacy-policy.html).

---

## 🤝 Katkı

Katkılarınızı bekliyoruz! Yönergeler için bkz. [CONTRIBUTING.md](CONTRIBUTING.md).
Güvenlik bildirimleri: [SECURITY.md](SECURITY.md). Sürüm geçmişi: [CHANGELOG.md](CHANGELOG.md).

## 👤 Yazar

**𝓐.𝓒.𝓑** — bozdogancanahmet@gmail.com

## 📄 Lisans

[MIT](LICENSE) © 2026 𝓐.𝓒.𝓑
