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

`worker/wrangler.jsonc` içindeki `"id"` alanına bu id'yi yaz (mevcut depoda
canlı bir KV id'si zaten tanımlı — yalnızca **yeni bir hesaba** kurarken
değiştirmen gerekir), sonra:

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

## 3) Windows uygulaması (mağazasız — doğrudan indirilebilir kurulum)

Masaüstü sürümü `desktop/` altındaki **Tauri v2** sarmalayıcısıdır: canlı
siteyi WebView2 içinde açar, yani web'e yapılan her deploy masaüstü
kullanıcılarına da anında yansır. Kurulum dosyası ~3-5 MB'dir.

### Kurulum dosyasını üretme

```bash
cd desktop
npm install          # bir kez
npx tauri build      # ilk seferde Rust bağımlılıklarını derler (5-15 dk)
```

Çıktı: `desktop/src-tauri/target/release/bundle/nsis/Seseri_4.0.0_x64-setup.exe`

### Dağıtma (GitHub Releases)

```bash
gh release create v4.0.0 \
  "desktop/src-tauri/target/release/bundle/nsis/Seseri_4.0.0_x64-setup.exe" \
  --repo IACBI/seseri --title "Seseri 4.0.0" \
  --notes "Windows kurulumu — indir, çalıştır, kur."
```

İndirme linkini README'ye / siteye koy:
`https://github.com/IACBI/seseri/releases/latest`

### Bilinmesi gerekenler

- **SmartScreen uyarısı:** exe imzasız olduğu için Windows ilk açılışta
  "Windows korumalı" uyarısı gösterir — kullanıcı **Daha fazla bilgi →
  Yine de çalıştır** der. Bunu kaldırmak için kod imzalama sertifikası
  gerekir (Azure Trusted Signing ~10 $/ay veya OV sertifikası ~70+ $/yıl);
  indirme sayısı arttıkça SmartScreen uyarısı kendiliğinden de azalır.
- **Sürüm güncelleme:** uygulama içeriği web'den geldiği için yeni installer
  yalnızca ikon/pencere gibi kabuk değişikliklerinde gerekir
  (`tauri.conf.json` → `version` artır, yeniden `tauri build`, yeni release).
- İkonlar `npx tauri icon ../public/icons/icon-512.png` ile "sinyal"
  markasından (beş çubuklu frekans işareti) yeniden üretilir; kaynak PNG'ler
  `node scripts/icons.cjs` ile `public/icons/seseri.svg`'den çıkar. Not:
  4.0'ta marka S-monogramından sinyal işaretine geçti — bir sonraki masaüstü
  sürümünde `tauri icon` adımı yeniden koşulmalı.

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
   (`public/screenshots/narrow-*.png` kullanılabilir — 4.0 ile birlikte
   "Sinyal" kimliğini ve yeni gezinmeyi (Ana Sayfa/Ara/Kütüphane/Ayarlar +
   Şimdi Çalıyor paneli) yansıtacak şekilde yeniden üretilecek).
   Açıklama metni artık sıcak antrasit/kehribar "Sinyal" kimliğini ve
   alttan sekme çubuğu / soldan kenar çubuğu ile Ana Sayfa, Ara, Kütüphane,
   Ayarlar ekranlarını anlatmalı — eski iki ekranlı (arama + oynatıcı) ve
   menekşe renkli sürüm açıklaması artık geçerli değil.
8. **Policy → App content:** gizlilik politikası URL'i, Data safety formu
   (veri toplanmıyor; tüm veriler cihazda), IARC anketi.
9. **Production → Create release** → aynı `.aab` → **Submit for review**
   (ilk inceleme birkaç gün sürebilir).

> **Not (Play politikası):** YouTube seslendirme özelliği üçüncü-taraf ToS
> tartışması doğurabilir. İnceleme reddi gelirse YouTube özelliğini
> `VITE_ENABLE_YT=false` benzeri bir bayrakla Play build'inden çıkarmak
> plandaki azaltma yoludur.

---

## 5) iOS (App Store) — durum ve yol haritası

**Şu an paketlenmiş bir iOS sürümü yok.** Seseri iPhone/iPad'de Safari
üzerinden PWA olarak kullanılabilir (Paylaş → Ana Ekrana Ekle), ancak iOS
PWA'larının bilinen sınırları geçerlidir:

- Arka plan/kilit ekranı sesi Safari PWA'da çalışır ama medya kontrolleri
  Android'deki kadar tutarlı değildir.
- Depolama (Cache API/IndexedDB) Safari tarafından ~%80 doluluk veya uzun
  süre kullanmama durumunda **silinebilir** — indirilen bölümler kalıcılık
  garantisi taşımaz (`navigator.storage.persist()` iOS'ta sınırlı).
- Kurulum önerisi (install prompt) yoktur; kullanıcı elle eklemelidir.

**App Store'a gerçek paket için yol:** PWABuilder'ın iOS paketi (WKWebView
sarmalayıcı) veya Capacitor kabuğu. Her ikisi de şunları gerektirir
(**credential-blocked** — kod tarafında engel yok):

1. Apple Developer Program üyeliği ($99/yıl).
2. Xcode ile imzalama (macOS gerekir) + App Store Connect kaydı.
3. App Review: "sadece web sitesi sarmalayıcı" retleri riskine karşı
   yerel değer katmanı (ör. offline indirme, medya oturumu) vurgulanmalı;
   YouTube sesi özelliği Play'dekiyle aynı ToS riskini taşır — gerekirse
   `VITE_ENABLE_YT=false` bayrağıyla iOS build'inden çıkarılır.

Bu adımlar tamamlanana kadar iOS desteği "Safari PWA" olarak belgelenir.

---

## 6) Güncelleme akışı

- **Uygulama içeriği/kodu:** sadece web'i yeniden deploy et — Store/Play
  paketleri aynı canlı siteyi açtığı için kullanıcılar anında güncellenir.
- **Manifest kimliği, ikon, kısayollar** gibi paketlenmiş metadata değişirse:
  PWABuilder'dan yeni paket üret, sürüm numarasını artır, mağazaya yeniden
  gönder (Android'de **aynı keystore ile**).

## Sürüm kontrol listesi

- [ ] `npm run verify` yeşil (lint, tsc, 121 istemci + 26 worker birim testi, build)
- [ ] `v*` tag'i push edilince `.github/workflows/desktop.yml` NSIS
      kurulumunu taslak Release olarak üretir (imzasız — SmartScreen uyarısı)
- [ ] `node scripts/smoke-p3-offline.cjs` ve `smoke-p5-mini.cjs` yeşil
- [ ] Worker deploy + `VITE_API_BASE` prod build'e gömülü
- [ ] CSP `connect-src` Worker adresini içeriyor
- [ ] Canlıda: arama, RSS, indirme→uçak modu, tema/dil değişimi
- [ ] `assetlinks.json` gerçek parmak iziyle canlıda (Play için)
