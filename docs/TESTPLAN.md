# Seseri — Manuel Test Planı

Migrasyon sırasında her kontrol noktasında (P2 adım 3/6/9 ve her faz sonunda) bu liste baştan sona koşulur.
Referans davranış: `v1-legacy` git etiketi (`git checkout v1-legacy` + `npx serve .`).

## 1. Arama ve keşif

- [ ] **Ara** sekmesine geç, arama kutusuna "radyo tiyatrosu" yaz → iTunes sonuçları kapak + isim + sanatçıyla listelenir.
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

- [ ] Podcast'i favorile → **Kütüphane → Abonelikler** sekmesinde kart olarak görünür.
- [ ] Favoriden kaldır → karttan düşer.
- [ ] Favori karta tıkla → podcast açılır, son çalınan bölüm hatırlanır (`pp_last_*`).
- [ ] Aboneliği olan podcast'ler **Ana Sayfa**'daki abonelikler ızgarasında da görünür.

## 6. İndirme

- [ ] Bölüm indirme düğmesi mp3'ü indirir (https-only; dosya adı Unicode-güvenli).
- [ ] İndirilemeyen bölümde kullanıcıya görünür hata (alert — v2'de toast olacak).

## 7. Deep link'ler

- [ ] `?podcast=<appleId>` → podcast doğrudan açılır.
- [ ] `?rss=<url>` → RSS doğrudan açılır.
- [ ] `?yt=<token>` → YouTube kaynağı doğrudan açılır.

## 8. Ayarlar

- [ ] **Ayarlar** artık sekme çubuğu/kenar çubuğundan açılan tam sayfa bir görünüm (eski modal `<dialog>` değil); geri tuşu/kenar çubuğundan diğer sekmelere geçilebilir.
- [ ] Hız, atlama süreleri, auto-next, resume ayarları kalıcıdır (yenile → korunur).
- [ ] 7 vurgu rengi (Amber/Copper/Signal Red/Moss/Teal/Sky/Lilac) değişir ve tüm UI'a yansır; varsayılan Amber.
- [ ] Eski bir sürümden gelen (3.x) kayıtlı vurgu rengiyle açılınca en yakın yeni Sinyal rengine otomatik eşlenir (`normalizeAccent`), swatch'ta doğru olan aktif görünür.
- [ ] Yazı boyutu ve satır yüksekliği değişir.
- [ ] Varsayılan sıralama çalışır (yeni→eski / eski→yeni).
- [ ] "İlerlemeyi temizle" ve "Tümünü temizle" çalışır (onaylı, styled confirm dialog).
- [ ] Depolama satırı kullanım gösterir; "İndirilenleri Sil" onaylı çalışır.

## 9. Tema ve dil

- [ ] 4 tema: **Otomatik / Dark / Light / OLED Black** — hepsi Sinyal paletiyle (sıcak antrasit yüzeyler) tutarlı görünür.
- [ ] Ayarlar ekranından dil değiştir: **tr / en** tam kontrol; diğerlerinden en az biri spot kontrol.
- [ ] **ar** seçince RTL düzeni doğru (yönler, hizalar, sekme çubuğu/kenar çubuğu dahil).
- [ ] İlk açılışta tarayıcı diline göre otomatik dil.

## 10. Klavye

- [ ] Podcast ekranı açıkken **veya** Şimdi Çalıyor paneli açıkken: Space play/pause; ←/→ seek; ↑/↓ önceki/sonraki bölüm.
- [ ] Bir input/select/textarea'ya odaklanmışken bu kısayollar tetiklenmez.
- [ ] Ana Sayfa/Ara/Kütüphane görünümlerinde (feed kapalı, panel kapalı) bu kısayollar pasif.
- [ ] Şimdi Çalıyor paneli açıkken Esc paneli kapatır (geçmişe eklenmez — tek adımda kapanır).
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

## 14. Mini oynatıcı, Şimdi Çalıyor paneli & kuyruk

- [ ] Bölüm çalarken "Geri" → ana ekran (veya önceki sekme); **çalma devam eder**, altta kalıcı mini dock görünür.
- [ ] Mini dock'taki oynat/duraklat yerinde çalışır (gezinmez, panel açmaz).
- [ ] Mini dock'a dokun/Enter → tam ekran (mobil) / yüzen panel (masaüstü) **Şimdi Çalıyor** paneli açılır — feed yeniden yüklenmez, çalan bölüm işaretli.
- [ ] Çalarken mini dock'taki frekans-çizgisi animasyonlu; duraklatınca veya `prefers-reduced-motion` altında sabit çizgiye döner.
- [ ] Şimdi Çalıyor panelinde hero dalga-form üzerinde sürükle-bırak seek çalışır.
- [ ] Panelin kapat düğmesi ve Esc ikisi de paneli kapatır, odak tetikleyici elemana döner.
- [ ] **Kuyruk** görünümü (sekme çubuğu/kenar çubuğunda yok — Şimdi Çalıyor panelinden veya `?view=queue` ile açılır): sıralı liste, yukarı/aşağı taşı, kaldır, tümünü temizle çalışır.
- [ ] Satırdaki kuyruk düğmesi → sıra numarası rozeti; bölüm bitince **kuyruk her zaman auto-next'ten önce gelir** (kuyrukta bölüm varsa auto-next ayarı ne olursa olsun kuyruktaki çalar).
- [ ] Farklı feed açınca kuyruk sıfırlanır.

## 15. Masaüstü düzeni & tema

- [ ] ≥900px: sekme çubuğu yerine solda **kalıcı kenar çubuğu** (Ana Sayfa/Ara/Kütüphane/Ayarlar); aktif sekme vurgulanır (`aria-current="page"`).
- [ ] ≥900px: mini dock kenar çubuğunun sağında, tam genişlikte konumlanır (kenar çubuğunu örtmez).
- [ ] <900px: alttan sekme çubuğu + tek panelli ekran davranışı korunur.
- [ ] Tema "Otomatik": işletim sistemi teması değişince uygulama canlı uyar (4 tema: Dark/Light/OLED Black + Otomatik).
- [ ] Bölüm satırlarında ilerleme çizgisi; bitenler soluk + ✓.

## 16. Responsive & erişilebilirlik denetimi

Ekran görüntüsü altyapısı: `scripts/shot.cjs` (headless Edge + vite preview; önce `npm run build`).

- [ ] Genişlikler: **320 / 360 / 390 / 520 / 600 / 768 / 900 / 1280** — Ana Sayfa, Ara, feed, Ayarlar sayfası: yatay kaydırma yok, metinler taşmaz (ellipsis), bileşenler üst üste binmez.
- [ ] 360×640'ta Ayarlar sayfası dikey kaydırılabilir, tüm satırlar erişilebilir.
- [ ] ≤520px: sıralama etiketi gizli, sıralama düğmesi yönü göstermeye devam eder.
- [ ] Light temada aynı genişliklerde kontrast/okunabilirlik kontrolü (özellikle küçük mono etiketler).
- [ ] `ar` (RTL): başlık, kontroller, liste hizaları **ve sekme çubuğu/kenar çubuğu** aynalanır; taşma yok.
- [ ] Klavye: Tab ile arama sonuçları gezinilir, Enter/Space açar; select/range odak halkası görünür; sekme çubuğu/kenar çubuğu öğeleri Tab ile erişilebilir, aktif öğe `aria-current="page"` taşır; Şimdi Çalıyor paneli kapatma düğmesi anlamlı `aria-label` taşır.
- [ ] Arama hatasında kırmızı hata kutusu + "Tekrar dene" düğmesi; boş sonuçta boş durum mesajı; yükleme sırasında "Aranıyor..." kutusu.

## 17. Worker & derin linkler

- [ ] `npm run worker:dev` açıkken RSS worker üzerinden gelir (Network'te `/v1/feed`).
- [ ] Worker kapalıyken aynı feed halka açık proxy'lerle yine yüklenir.
- [ ] `?resume=1` → son açılan feed otomatik açılır (mağaza kısayolu).
- [ ] `?view=search` / `?view=library` / `?view=queue` / `?view=settings` → ilgili görünüm doğrudan açılır (soğuk yükleme).
- [ ] Legacy derin linkler (`?podcast=`, `?rss=`, `?yt=`) hâlâ çalışır — 3.x'ten paylaşılan bir link 4.0'da da aynı feed'i açar.
- [ ] Deep-link ile gelinen sayfada (feed **veya** `?view=`) "Geri" → siteden çıkmaz, tek adımda ana ekrana döner (tarayıcı geri tuşu **ve** uygulama içi geri tuşu).
- [ ] Bir view'dan başka bir view'a geçip sonra geri tuşuna basınca da tek adımda ana ekrana dönülür (aradaki view geçmişte "yığılmaz").
- [ ] PWA manifest kısayolu "Ara" → `?view=search` açar (eski davranış: boş başlangıç URL'i).

## 18. Oynatma regresyon matrisi

Her kaynak × eylem kombinasyonu en az bir kez denenir; ✓/✗ olarak işaretlenir.

| Kaynak / Eylem | Play | Seek | Sonraki/Önceki | Auto-next | Kuyruk auto-next'i ezer | Çevrimdışı indir+çal | Uyku zamanlayıcısı | Hız | Medya tuşları | Mini→Şimdi Çalıyor |
|---|---|---|---|---|---|---|---|---|---|---|
| RSS | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| iTunes (RSS'e çözümlenir) | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| YouTube — tekil video | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| YouTube — playlist | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |

Notlar:
- **Kuyruk auto-next'i ezer**: bir bölüm kuyruğa eklenmişken çalınan bölüm biterse, auto-next ayarı açık/kapalı fark etmeksizin kuyruktaki bölüm çalar (`playback-controller.ts` — `dequeueNext` her zaman `autoNext` kontrolünden önce denenir).
- **Çevrimdışı indir+çal**: DevTools → Network → Offline ile denenir; indirilen bölüm hem çalar hem seek eder. YouTube'da embed fallback'e düşen bölümler indirilemez (yalnızca Worker/Piped üzerinden çözümlenen ses indirilebilir) — bu durum ayrı satırda "N/A" olarak işaretlenebilir.
- **Medya tuşları**: kilit ekranı/bildirim paneli play/pause/next/prev; başlık+kapak görünür.
- **Mini transport**: mini dock üzerinde geri/ileri sarma + oynat/duraklat (≥640px'te önceki/sonraki ortada; uyku zamanlayıcısı + hız sağ kümede, panel seçicileriyle senkron); alt ilerleme çizgisi dokun/sürükle ile sarar. Başlık alanı veya genişletme oku (Enter/Space dahil) yeni bölüm başlatmadan Şimdi Çalıyor panelini açar.
- **Embed→ses kurtarma**: iframe fallback ile başlayan YouTube bölümünde uygulama arka planda ses çözümlemeyi yeniden dener ve akış çözüldüğünde aynı konumdan `<audio>`'ya kesintisiz geçer (kilit ekranı çalması + medya tuşları geri gelir).

### Yeni gezinme kontrolleri

- [ ] Sekme çubuğu (mobil) / kenar çubuğu (masaüstü): Ana Sayfa/Ara/Kütüphane/Ayarlar arasında geçiş, aktif sekme vurgusu.
- [ ] `?view=` derin linkleri (yukarıdaki bölüm 17) soğuk yükleme + uygulama-içi gezinme ile çalışır.
- [ ] Geri tuşu tek-adım-ana-ekran kuralı: feed → geri → ana ekran; view → geri → ana ekran; view → view → geri → ana ekran (asla iki adım gerekmez).
- [ ] Esc: Şimdi Çalıyor paneli açıkken kapatır; Onay diyaloğu açıkken iptal eder (odak Vazgeç'te varsayılan).
