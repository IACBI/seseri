# Seseri — Yayınlama Rehberi (Web → Microsoft Store → Google Play)

Mağaza paketleri **canlı HTTPS adresinden** üretilir; uygulama güncellemeleri
web'den gelir (paketleri yeniden yüklemek gerekmez). Sıra önemli: önce Worker,
sonra web sitesi, sonra mağazalar.

---

## 0) Ön koşullar

- Cloudflare hesabı (ücretsiz plan yeterli)
- GitHub hesabı (canlı site `seseri` reposundan GitHub Pages ile yayınlanıyor)
- Microsoft Partner Center hesabı (~19 $ bir kez, bireysel)
- Google Play Console hesabı (25 $ bir kez)
- Gizlilik politikası URL'i (dağıtımla birlikte gelir):
  `https://iacbi.github.io/seseri/privacy-policy.html`

---

## 1) Worker'ı yayınla (Cloudflare)

```bash
cd worker
npx wrangler login                      # tarayıcıda onayla
npx wrangler kv namespace create KV     # çıktıdaki id'yi kopyala
```

`worker/wrangler.jsonc` içindeki `"id": "REPLACE_ON_DEPLOY"` alanına bu id'yi
yaz, sonra:

```bash
npx wrangler deploy
```

Çıktıdaki adresi not et: `https://seseri-api.<hesap>.workers.dev`

**Doğrula:**
`https://seseri-api.<hesap>.workers.dev/v1/itunes?url=https%3A%2F%2Fitunes.apple.com%2Flookup%3Fid%3D1200361736`
JSON dönmeli.

---

## 2) Web sitesini yayınla (GitHub Pages)

1. `index.html` → CSP `connect-src` listesine Worker adresini ekle:
   `https://seseri-api.<hesap>.workers.dev`
2. Prod build al ve `seseri` reposuna kopyala:

   ```bash
   VITE_API_BASE=https://seseri-api.<hesap>.workers.dev npm run build
   # dist/ içeriğini seseri reposunun köküne kopyala, commit + push
   ```

   *(Alternatif: bu repoyu GitHub'a taşıyıp `.github/workflows/pages.yml` ile
   otomatik dağıt — workflow `VITE_API_BASE` repo değişkenini okur.)*
3. `https://iacbi.github.io/seseri/` adresinde test et:
   arama çalışıyor, bir bölüm indirilip uçak modunda çalıyor, ayarlar açılıyor.

---

## 3) Microsoft Store (Windows / MSIX)

1. **PWABuilder**: https://www.pwabuilder.com → `https://iacbi.github.io/seseri/`
   adresini gir → **Start**. Rapor kartının yeşil olduğunu doğrula
   (manifest, service worker, HTTPS).
2. **Package for Stores → Windows** seç.
3. Partner Center'da uygulama adını rezerve et:
   https://partner.microsoft.com/dashboard → **Apps and games → New product →
   MSIX or PWA app** → ad: `Seseri`.
4. Partner Center'ın verdiği üç değeri PWABuilder formuna gir:
   **Package ID**, **Publisher ID** (`CN=...`), **Publisher display name**
   (Partner Center → Product identity sayfasında).
5. PWABuilder'ın ürettiği `.msixbundle` dosyasını indir.
6. **Önce yerelde dene (sideload):** dosyaya çift tıkla → kur → uygulamayı aç;
   ses çalarken pencereyi simge durumuna küçült ve kilit ekranında medya
   tuşlarını doğrula.
7. Partner Center → ürünün → **Start submission**:
   - Paket: `.msixbundle`'ı yükle
   - Fiyat: Free · Pazarlar: tümü (veya seçim)
   - Yaş: IARC anketi (podcast çalar → genellikle 3+/E)
   - Store listing: açıklama + `public/screenshots/` görselleri
     (wide-feed.png vb.) + 512 ikon
   - Privacy policy URL: yukarıdaki adres
8. **Submit** → inceleme genellikle 24–72 saat.

---

## 4) Google Play (Android / TWA)

1. PWABuilder'da aynı URL → **Package for Stores → Android**.
2. Ayarlar:
   - Package ID: `io.github.iacbi.seseri`
     (assetlinks şablonundakiyle aynı olmalı)
   - App name `Seseri`, tema rengi otomatik gelir
   - **Signing key: "Create new"** → PWABuilder imza anahtarını üretir.
     İndirilen zip'teki `signing.keystore` + şifreleri **kalıcı olarak sakla**
     (kaybedersen güncelleme yayınlayamazsın).
3. Zip'ten çıkanlar: `app-release-bundle.aab` (Play'e yüklenecek),
   `assetlinks.json` (SHA-256 parmak izi içerir).
4. **Digital Asset Links:** PWABuilder'ın verdiği `assetlinks.json` içeriğini
   `public/.well-known/assetlinks.json` dosyasındaki
   `REPLACE_WITH_SHA256_FROM_PWABUILDER` alanına işle → yeniden build + deploy.
   Doğrula: `https://iacbi.github.io/seseri/.well-known/assetlinks.json`
   parmak izini gösteriyor. *(Bu olmadan uygulama tarayıcı çubuğuyla açılır.)*
5. Play Console: https://play.google.com/console → **Create app** →
   ad `Seseri`, App (game değil), Free.
6. **Testing → Internal testing → Create release** → `.aab` dosyasını yükle →
   kendini test kullanıcısı ekle → telefonda kur:
   kurulum, çevrimdışı açılış, arka planda ses, bildirim panelinde medya
   kontrolleri, URL çubuğunun görünmediği doğrulanır.
7. **Grow → Store presence → Main store listing:** açıklama, 512 ikon,
   1024×500 feature graphic, telefon ekran görüntüleri
   (`public/screenshots/narrow-*.png` kullanılabilir).
8. **Policy → App content:** gizlilik politikası URL'i, Data safety formu
   (veri toplanmıyor; tüm veriler cihazda), IARC anketi.
9. **Production → Create release** → aynı `.aab` → **Submit for review**
   (ilk inceleme birkaç gün sürebilir).

> **Not (Play politikası):** YouTube seslendirme özelliği üçüncü-taraf ToS
> tartışması doğurabilir. İnceleme reddi gelirse YouTube özelliğini
> `VITE_ENABLE_YT=false` benzeri bir bayrakla Play build'inden çıkarmak
> plandaki azaltma yoludur.

---

## 5) Güncelleme akışı

- **Uygulama içeriği/kodu:** sadece web'i yeniden deploy et — Store/Play
  paketleri aynı canlı siteyi açtığı için kullanıcılar anında güncellenir.
- **Manifest kimliği, ikon, kısayollar** gibi paketlenmiş metadata değişirse:
  PWABuilder'dan yeni paket üret, sürüm numarasını artır, mağazaya yeniden
  gönder (Android'de **aynı keystore ile**).

## Sürüm kontrol listesi

- [ ] `npm run verify` yeşil (lint, tsc, 51+22 test, build)
- [ ] `node scripts/smoke-p3-offline.cjs` ve `smoke-p5-mini.cjs` yeşil
- [ ] Worker deploy + `VITE_API_BASE` prod build'e gömülü
- [ ] CSP `connect-src` Worker adresini içeriyor
- [ ] Canlıda: arama, RSS, indirme→uçak modu, tema/dil değişimi
- [ ] `assetlinks.json` gerçek parmak iziyle canlıda (Play için)
