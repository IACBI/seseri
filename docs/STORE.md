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
npx wrangler deploy
```

Hız sınırlayıcı ve senkron dışında kalıcı bir bağlama yok: sınırlayıcılar
platformun kendi `ratelimits` bağlamasında (elle bir şey oluşturman gerekmez),
senkron ise D1'de. Yeni bir hesaba kuruyorsan yalnızca `worker/wrangler.jsonc`
içindeki `database_id` alanını kendi veritabanınla değiştir.

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

Çıktı: `desktop/src-tauri/target/release/bundle/nsis/Seseri_4.1.27_x64-setup.exe`

### Dağıtma (GitHub Releases)

```bash
gh release create v4.1.27 \
  "desktop/src-tauri/target/release/bundle/nsis/Seseri_4.1.27_x64-setup.exe" \
  --repo IACBI/seseri --title "Seseri 4.1.27" \
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
  `node scripts/icons.cjs` ile `public/icons/seseri.svg`'den çıkar. Kurulum
  ikonları 4.0'taki marka değişiminden (S-monogramı → sinyal işareti) sonra
  yeniden üretildi; `tauri icon` adımı yalnızca marka görseli tekrar
  değişirse gerekir.

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
4. **Digital Asset Links — dikkat, bu repo'dan yayınlanamaz.** Android bu
   dosyayı **yalnızca origin kökünden** okur:
   `https://iacbi.github.io/.well-known/assetlinks.json`. Uygulama ise
   `/seseri/` alt yolunda yayınlanıyor, dolayısıyla dosyayı bu repo'ya koymak
   işe yaramaz — bu yüzden buradaki eski `public/.well-known/assetlinks.json`
   şablonu (hiç doldurulmamış bir yer tutucu içeriyordu) kaldırıldı.

   PWABuilder'ın verdiği `assetlinks.json` içeriğini **`iacbi.github.io`
   kullanıcı sitesi repo'suna** (`IACBI/iacbi.github.io`) `.well-known/`
   altına koy ve oradan yayınla. Doğrula:
   `https://iacbi.github.io/.well-known/assetlinks.json` parmak izini
   gösteriyor. *(Bu olmadan uygulama tarayıcı adres çubuğuyla açılır.)*

   Alternatif: uygulamayı kendi alan adına taşıyıp dosyayı o alan adının
   kökünden yayınlamak.
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

> **Not:** 4.2.0 öncesi sürümlerde bir YouTube ses özelliği vardı ve üçüncü-taraf
> ToS riski taşıyordu. Özellik tamamen kaldırıldı; uygulama artık yalnızca RSS
> ve Apple Podcasts kataloğuna bağlanıyor, dolayısıyla bu risk kalmadı.


### Arka planda çalma (kullanıcıya söylenmesi gereken)

TWA, Chrome'un kendi sürecinde çalışır: `navigator.mediaSession` metadata'sı
ayarlandığında Chrome medya bildirimini ve ön plan servisini kendisi açar, yani
ekran kapalıyken ses normalde devam eder. Kesildiği bildirilen durumların ikisi
gerçek sebeptir:

1. **Ağ.** Akış sırasında bölüm parça parça çekilir; telefon uyurken bir istek
   düşerse eskiden çalma kalıcı olarak ölüyordu. `src/player/recovery.ts` artık
   kaynağı yeniden çözümleyip aynı saniyeden devam ediyor,
   `src/player/prefetch.ts` ise bölümü arka planda tamamen önbelleğe alarak ağ
   bağımlılığını bitiriyor (Ayarlar → "Çalarken önbelleğe al").
2. **OEM pil yönetimi.** Xiaomi, Samsung ve Huawei cihazlarda agresif
   "uygulamayı öldür" davranışı hiçbir web tabanlı çözümün aşamayacağı bir
   sınırdır. Mağaza açıklamasına ve SSS'ye şu adımı koy: **Ayarlar →
   Uygulamalar → Seseri → Pil → "Kısıtlanmamış" (Unrestricted)**.

Doğrulama: `adb shell dumpsys media_session` çalarken bir oturum listelemeli;
`adb logcat` arka plandaki bölüm isteklerini gösterir.

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
   yerel değer katmanı (ör. offline indirme, medya oturumu) vurgulanmalı.

Somut adımlar, `capacitor.config.ts` içeriği, `Info.plist` anahtarları ve
`AppDelegate.swift` değişikliği için: [docs/IOS.md](IOS.md). O dosyadaki hiçbir
adım doğrulanmadı — macOS ve Apple Developer hesabı olmadan derlenemez.

Bu adımlar tamamlanana kadar iOS desteği "Safari PWA" olarak belgelenir.

---

## 6) Güncelleme akışı

- **Uygulama içeriği/kodu:** sadece web'i yeniden deploy et — Store/Play
  paketleri aynı canlı siteyi açtığı için kullanıcılar anında güncellenir.
- **Manifest kimliği, ikon, kısayollar** gibi paketlenmiş metadata değişirse:
  PWABuilder'dan yeni paket üret, sürüm numarasını artır, mağazaya yeniden
  gönder (Android'de **aynı keystore ile**).

## Sürüm kontrol listesi

- [ ] `npm run verify` yeşil (lint, tsc, 818 istemci + 136 worker birim testi, build)
- [ ] `v*` tag'i push edilince `.github/workflows/desktop.yml` NSIS
      kurulumunu taslak Release olarak üretir (imzasız — SmartScreen uyarısı)
- [ ] `npm run smoke` yeşil (altı headless tarayıcı smoke'u, 73 doğrulama)
- [ ] Worker deploy + `VITE_API_BASE` prod build'e gömülü
- [ ] CSP `connect-src` Worker adresini içeriyor
- [ ] Canlıda: arama, RSS, indirme→uçak modu, tema/dil değişimi
- [ ] `assetlinks.json` gerçek parmak iziyle **origin kökünde** canlıda
      (`iacbi.github.io/.well-known/`, bu repo'da değil — yalnızca Play için)
