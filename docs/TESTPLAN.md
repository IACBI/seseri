# Seseri — Manuel Test Planı

Migrasyon sırasında her kontrol noktasında (P2 adım 3/6/9 ve her faz sonunda) bu liste baştan sona koşulur.
Referans davranış: `v1-legacy` git etiketi (`git checkout v1-legacy` + `npx serve .`).

## 1. Arama ve keşif

- [ ] Ana ekranda arama kutusuna "radyo tiyatrosu" yaz → iTunes sonuçları kapak + isim + sanatçıyla listelenir.
- [ ] Sonuca tıkla → podcast ekranı açılır, bölümler listelenir (tarih + süre görünür).
- [ ] Arama kutusuna Apple podcast **sayısal ID** yapıştır → doğrudan o podcast açılır.
- [ ] Arama kutusuna **ham RSS URL** yapıştır (örn. `https://feeds.simplecast.com/54nAGcIl`) → feed açılır.
- [ ] Geçersiz/ölü RSS URL → kullanıcıya görünür hata, uygulama kilitlenmez.
- [ ] Boş arama sonucu → boş durum mesajı görünür.

## 2. Oynatma (temel)

- [ ] Bölüme tıkla → çalmaya başlar; başlık/durum alanı güncellenir.
- [ ] Play/pause düğmesi çalışır.
- [ ] Waveform üzerinde sürükleyerek seek çalışır; süre etiketleri güncellenir.
- [ ] Geri/ileri atlama düğmeleri ayarlanan saniye kadar atlar.
- [ ] Önceki/sonraki bölüm düğmeleri liste üzerinde gezinir.
- [ ] Hız 0.5×–2.5× arası değişir ve sese yansır.
- [ ] Bölüm biterken otomatik sonrakine geçer (ayar açıkken).
- [ ] Sayfayı yenile → aynı bölüm kaldığı pozisyondan devam eder (resume).
- [ ] Kilit ekranı / medya tuşları (Media Session): başlık+kapak görünür, play/pause/next çalışır.

## 3. Sleep timer

- [ ] 15/30/60 dk seçenekleri ayarlanabilir; seçim durumda görünür.
- [ ] Süre dolunca oynatma durur.

## 4. YouTube

- [ ] Tek video linki yapıştır → ses olarak çalar (Piped) ya da embed fallback devreye girer.
- [ ] Playlist linki yapıştır → tüm liste bölüm olarak gelir, başlıklar dolu.
- [ ] Kanal linki yapıştır → videolar listelenir.
- [ ] Piped ölüyse embed fallback'te oynatma kontrolleri (play/pause/seek) çalışır.
- [ ] YouTube bölümü için tarih bilgisi görünür.

## 5. Abonelikler (favoriler)

- [ ] Podcast'i favorile → ana ekranda kart olarak görünür.
- [ ] Favoriden kaldır → karttan düşer.
- [ ] Favori karta tıkla → podcast açılır, son çalınan bölüm hatırlanır (`pp_last_*`).

## 6. İndirme

- [ ] Bölüm indirme düğmesi mp3'ü indirir (https-only; dosya adı Unicode-güvenli).
- [ ] İndirilemeyen bölümde kullanıcıya görünür hata (alert — v2'de toast olacak).

## 7. Deep link'ler

- [ ] `?podcast=<appleId>` → podcast doğrudan açılır.
- [ ] `?rss=<url>` → RSS doğrudan açılır.
- [ ] `?yt=<token>` → YouTube kaynağı doğrudan açılır.

## 8. Ayarlar

- [ ] Ayarlar paneli açılır/kapanır; Esc ile kapanır.
- [ ] Hız, atlama süreleri, auto-next, resume ayarları kalıcıdır (yenile → korunur).
- [ ] 7 vurgu rengi değişir ve tüm UI'a yansır.
- [ ] Yazı boyutu ve satır yüksekliği değişir.
- [ ] Varsayılan sıralama çalışır (yeni→eski / eski→yeni).
- [ ] "İlerlemeyi temizle" ve "Tümünü temizle" çalışır (onaylı).

## 9. Tema ve dil

- [ ] 3 tema: dark / light / oled — hepsi tutarlı görünür.
- [ ] Dil değiştir: **tr / en** tam kontrol; diğerlerinden en az biri spot kontrol.
- [ ] **ar** seçince RTL düzeni doğru (yönler, hizalar).
- [ ] İlk açılışta tarayıcı diline göre otomatik dil.

## 10. Klavye

- [ ] Space: play/pause; ←/→: seek; ↑/↓ veya liste okları: bölüm gezinme (mevcut kısayol seti).
- [ ] Bölüm listesinde klavyeyle gezinme + Enter ile çalma.

## 11. PWA

- [ ] `npx serve` üzerinden SW kaydolur; offline'da uygulama kabuğu açılır.
- [ ] Manifest yüklenir, yükleme istemi (install prompt) gelir.

## 12. Dayanıklılık

- [ ] Ağ yokken arama → görünür hata, sonsuz spinner yok.
- [ ] CORS proxy'lerinin biri ölüyken RSS yine yüklenir (fallback yarışı).
- [ ] localStorage dolu senaryosunda uygulama çökmez (quota pruning).

## 13. Offline & indirmeler (v3)

- [ ] Bölümün ⤓ düğmesi → "kaydedildi" bildirimi; düğme ✓ olur.
- [ ] DevTools → Network → Offline → sayfayı yenile: uygulama açılır, feed önbellekten listelenir, indirilen bölüm çalar **ve** seek eder.
- [ ] İndirilen bölüme ikinci dokunuş → indirilen silinir.
- [ ] Ayarlar → Depolama satırı kullanım gösterir; "İndirilenleri Sil" çalışır.
- [ ] CORS engelli bir feed'de indirme → dosya indirme fallback bildirimi.
- [ ] OPML dışa aktar → içe aktar → abonelikler aynı (round-trip).

## 14. Mini oynatıcı & kuyruk (v3)

- [ ] Bölüm çalarken "Geri" → ana ekran; **çalma devam eder**, altta mini bar görünür.
- [ ] Mini bardaki oynat/duraklat yerinde çalışır (gezinmez).
- [ ] Mini bara dokun → aynı feed'e döner (yeniden yüklenmez, çalan bölüm işaretli).
- [ ] Satırdaki kuyruk düğmesi → sıra numarası rozeti; bölüm bitince kuyruktaki çalar.
- [ ] Farklı feed açınca kuyruk sıfırlanır.

## 15. Masaüstü düzeni & tema (v3)

- [ ] ≥900px + feed açık: solda kütüphane rayı (arama + abonelikler), sağda bölümler; ray'dan abonelik tıklamak sağı değiştirir.
- [ ] <900px: tek ekran davranışı korunur.
- [ ] Tema "Otomatik": işletim sistemi teması değişince uygulama canlı uyar.
- [ ] Bölüm satırlarında ilerleme çizgisi; bitenler soluk + ✓.

## 16. Responsive & erişilebilirlik denetimi

Ekran görüntüsü altyapısı: `scripts/shot.cjs` (headless Edge + vite preview; önce `npm run build`).

- [ ] Genişlikler: **320 / 360 / 390 / 520 / 600 / 768 / 900 / 1280** — ana ekran, arama sonuçları, feed, ayarlar paneli: yatay kaydırma yok, metinler taşmaz (ellipsis), bileşenler üst üste binmez.
- [ ] 360×640'ta ayarlar paneli dikey kaydırılabilir, tüm satırlar erişilebilir.
- [ ] ≤520px: sıralama etiketi gizli, sıralama düğmesi yönü göstermeye devam eder.
- [ ] Light temada aynı genişliklerde kontrast/okunabilirlik kontrolü (özellikle küçük mono etiketler).
- [ ] `ar` (RTL): başlık, kontroller ve liste hizaları aynalanır; taşma yok.
- [ ] Klavye: Tab ile arama sonuçları gezinilir, Enter/Space açar; select/range odak halkası görünür; ayarlar kapatma düğmesi anlamlı `aria-label` taşır.
- [ ] Arama hatasında kırmızı hata kutusu + "Tekrar dene" düğmesi; boş sonuçta boş durum mesajı; yükleme sırasında "Aranıyor..." kutusu.

## 17. Worker & derin linkler (v3)

- [ ] `npm run worker:dev` açıkken RSS worker üzerinden gelir (Network'te `/v1/feed`).
- [ ] Worker kapalıyken aynı feed halka açık proxy'lerle yine yüklenir.
- [ ] `?resume=1` → son açılan feed otomatik açılır (mağaza kısayolu).
- [ ] Deep-link ile gelinen sayfada "Geri" → siteden çıkmaz, ana ekrana döner.
