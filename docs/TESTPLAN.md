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
