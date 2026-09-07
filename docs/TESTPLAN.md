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

## 4. Abonelikler (favoriler)

- [ ] Podcast'i favorile → **Kütüphane → Abonelikler** sekmesinde kart olarak görünür.
- [ ] Favoriden kaldır → karttan düşer.
- [ ] Favori karta tıkla → podcast açılır, son çalınan bölüm hatırlanır (`pp_last_*`).
- [ ] Aboneliği olan podcast'ler **Ana Sayfa**'daki abonelikler ızgarasında da görünür.

## 5. İndirme

- [ ] Bölüm indirme düğmesi mp3'ü indirir (https-only; dosya adı Unicode-güvenli).
- [ ] İndirilemeyen bölümde kullanıcıya görünür hata (alert — v2'de toast olacak).

## 6. Deep link'ler

- [ ] `?podcast=<appleId>` → podcast doğrudan açılır.
- [ ] `?rss=<url>` → RSS doğrudan açılır.
- [ ] `?yt=<token>` → YouTube desteği kaldırıldı; link ana sayfaya düşer, hata vermez.

## 7. Ayarlar

- [ ] **Ayarlar** artık sekme çubuğu/kenar çubuğundan açılan tam sayfa bir görünüm (eski modal `<dialog>` değil); geri tuşu/kenar çubuğundan diğer sekmelere geçilebilir.
- [ ] Hız, atlama süreleri, auto-next, resume ayarları kalıcıdır (yenile → korunur).
- [ ] 7 vurgu rengi (Amber/Copper/Signal Red/Moss/Teal/Sky/Lilac) değişir ve tüm UI'a yansır; varsayılan Amber.
- [ ] Eski bir sürümden gelen (3.x) kayıtlı vurgu rengiyle açılınca en yakın yeni Sinyal rengine otomatik eşlenir (`normalizeAccent`), swatch'ta doğru olan aktif görünür.
- [ ] Yazı boyutu ve satır yüksekliği değişir.
- [ ] Varsayılan sıralama çalışır (yeni→eski / eski→yeni).
- [ ] "İlerlemeyi temizle" ve "Tümünü temizle" çalışır (onaylı, styled confirm dialog).
- [ ] Depolama satırı kullanım gösterir; "İndirilenleri Sil" onaylı çalışır.

## 8. Tema ve dil

- [ ] 4 tema: **Otomatik / Dark / Light / OLED Black** — hepsi Sinyal paletiyle (sıcak antrasit yüzeyler) tutarlı görünür.
- [ ] Ayarlar ekranından dil değiştir: **tr / en** tam kontrol; diğerlerinden en az biri spot kontrol.
- [ ] **ar** seçince RTL düzeni doğru (yönler, hizalar, sekme çubuğu/kenar çubuğu dahil).
- [ ] İlk açılışta tarayıcı diline göre otomatik dil.

## 9. Klavye

- [ ] Podcast ekranı açıkken **veya** Şimdi Çalıyor paneli açıkken: Space play/pause; ←/→ seek; ↑/↓ önceki/sonraki bölüm.
- [ ] Bir input/select/textarea'ya odaklanmışken bu kısayollar tetiklenmez.
- [ ] Ana Sayfa/Ara/Kütüphane görünümlerinde (feed kapalı, panel kapalı) bu kısayollar pasif.
- [ ] Şimdi Çalıyor paneli açıkken Esc paneli kapatır (geçmişe eklenmez — tek adımda kapanır).
- [ ] Bölüm listesinde klavyeyle gezinme + Enter ile çalma.

## 10. PWA

- [ ] `npx serve` üzerinden SW kaydolur; offline'da uygulama kabuğu açılır.
- [ ] Manifest yüklenir, yükleme istemi (install prompt) gelir.

## 11. Dayanıklılık

- [ ] Ağ yokken arama → görünür hata, sonsuz spinner yok.
- [ ] CORS proxy'lerinin biri ölüyken RSS yine yüklenir (fallback yarışı).
- [ ] localStorage dolu senaryosunda uygulama çökmez (quota pruning).

## 12. Offline & indirmeler (v3)

- [ ] Bölümün ⤓ düğmesi → "kaydedildi" bildirimi; düğme ✓ olur.
- [ ] DevTools → Network → Offline → sayfayı yenile: uygulama açılır, feed önbellekten listelenir, indirilen bölüm çalar **ve** seek eder.
- [ ] İndirilen bölüme ikinci dokunuş → indirilen silinir.
- [ ] Ayarlar → Depolama satırı kullanım gösterir; "İndirilenleri Sil" çalışır.
- [ ] CORS engelli bir feed'de indirme → dosya indirme fallback bildirimi.
- [ ] OPML dışa aktar → içe aktar → abonelikler aynı (round-trip).

## 13. Mini oynatıcı, Şimdi Çalıyor paneli & kuyruk

- [ ] Bölüm çalarken "Geri" → ana ekran (veya önceki sekme); **çalma devam eder**, altta kalıcı mini dock görünür.
- [ ] Mini dock'taki oynat/duraklat yerinde çalışır (gezinmez, panel açmaz).
- [ ] Mini dock'a dokun/Enter → **Şimdi Çalıyor** paneli tam ekran açılır (her boyutta) — feed yeniden yüklenmez, çalan bölüm işaretli.
- [ ] Çalarken mini dock'taki frekans-çizgisi animasyonlu; duraklatınca veya `prefers-reduced-motion` altında sabit çizgiye döner.
- [ ] Şimdi Çalıyor panelinde hero dalga-form üzerinde sürükle-bırak seek çalışır.
- [ ] Panelin kapat düğmesi ve Esc ikisi de paneli kapatır, odak tetikleyici elemana döner.
- [ ] **Kuyruk** görünümü (sekme çubuğu/kenar çubuğunda yok — Şimdi Çalıyor panelinden veya `?view=queue` ile açılır): sıralı liste, yukarı/aşağı taşı, kaldır, tümünü temizle çalışır.
- [ ] Satırdaki kuyruk düğmesi → sıra numarası rozeti; bölüm bitince **kuyruk her zaman auto-next'ten önce gelir** (kuyrukta bölüm varsa auto-next ayarı ne olursa olsun kuyruktaki çalar).
- [ ] **Farklı feed açınca kuyruk korunur** ve sayfa yenilendikten sonra da durur (`pp_queue`).
- [ ] Kuyruk satırları hangi podcast'ten geldiğini gösterir; başka bir feed'in bölümü
      sıradaysa bölüm bitince o feed yüklenip çalınır.

### Ses düzeyi

- [ ] Şimdi Çalıyor panelinde hoparlör düğmesi + sürgü her ekran boyutunda var; sürgüyü sürüklemek sesi anında değiştirir.
- [ ] ≥1024px: mini dock'ta da hoparlör + sürgü görünür; iki yüzey birbirini anında yansıtır (birinde değiştir, diğerinde kontrol et).
- [ ] Hoparlör düğmesi sessize alır ve geri açar; geri açınca **seçilmiş seviye** geri gelir, tam ses değil.
- [ ] Sürgü sıfıra çekilince simge sessiz haline döner; hoparlöre basınca ses duyulur bir seviyeye çıkar (düğme boşa basılmış olmaz).
- [ ] Sessizken sürgüyü sıfırdan yukarı çekmek sessizliği kaldırır.
- [ ] Seviye sayfa yenilenince korunur; yeni bölüme geçince de korunur.
- [ ] Uyku zamanlayıcısı son 30 sn'de kısarken sürgü **oynamaz**; zamanlayıcı iptal edilince ses seçilen seviyeye döner (tam sese değil).
- [ ] Klavye: sürgüye Tab ile ulaşılır, ok tuşları / Home / End çalışır, odak halkası görünür.
- [ ] iOS (Safari): kontrol hiç görünmez — orada `audio.volume` salt okunurdur, donanım tuşları kullanılır.


## 14. Masaüstü düzeni & tema

- [ ] ≥900px: sekme çubuğu yerine solda **kalıcı kenar çubuğu** (Ana Sayfa/Ara/Kütüphane/Ayarlar); aktif sekme vurgulanır (`aria-current="page"`).
- [ ] ≥900px: mini dock kenar çubuğunun sağında, tam genişlikte konumlanır (kenar çubuğunu örtmez).
- [ ] ≥900px: kelime markasının yanındaki düğme **simge şeridine daraltır**; etiketler gizlenir, simgeler tooltip kazanır, mini dock ve içerik alanı birlikte kayar; seçim sayfa yenilenince korunur (`aria-expanded` durumu yansıtır).
- [ ] Daraltılmışken daraltma ikonu **hiç çizilmez**; şeritte yalnızca marka işareti ve simgeler durur.
- [ ] Fare şeridin üzerine gelince şerit tam genişliğe açılır (etiketler görünür) ama **içerik yerinden oynamaz** — panel sayfanın üstünde durur. Fare uzaklaşınca kapanır. Kenardan hızlıca geçmek paneli titretmemeli (açılış ~120 ms, kapanış ~320 ms gecikmeli).
- [ ] **Daraltma düğmesine basınca şerit anında kapanmaya başlar** — fare hâlâ şeridin üzerinde olsa bile beklemez, takılmaz, geri açılmaz. Şerit ve içerik birlikte kayar (biri diğerini beklemez). Fare şeritten çıkıp geri girene kadar peek açılmaz.
- [ ] Açma da aynı şekilde akıcıdır: şerit genişlerken içerik onunla birlikte kayar.
- [ ] Şeritte bir hedefe (Ana Sayfa/Ara/…) tıklamak yalnızca oraya gider, şerit daralmış kalır; şeridin **başka herhangi bir yerine** (marka işareti, boşluk) tıklamak şeridi açık hâle getirir.
- [ ] Simgeler açılırken/kapanırken yer değiştirmez; sadece genişlik ve etiketler değişir.
- [ ] Tab ile şeride girmek paneli açar; marka işaretinin üzerindeki görünmez düğme odaklanınca çizilir ve `aria-label` taşır.
- [ ] `[` tuşu her görünümden şeridi açıp kapatır; **Türkçe-Q klavyede aynı fiziksel tuş** (`ğ`) de çalışır; bir metin alanına yazarken çalışmaz; <900px'te hiçbir şey yapmaz. Kısayol listesinde (`?`) görünür.
- [ ] ≥900px: Ana Sayfa'daki dil seçici, 720px'lik okuma sütununun değil **pencerenin** sağ üst köşesindedir; ilk satırın altına girmez.
- [ ] <900px: alttan sekme çubuğu + tek panelli ekran davranışı korunur; daraltma düğmesi görünmez.
- [ ] Tema "Otomatik": işletim sistemi teması değişince uygulama canlı uyar (4 tema: Dark/Light/OLED Black + Otomatik).
- [ ] Bölüm satırlarında ilerleme çizgisi; bitenler soluk + ✓.

## 15. Responsive & erişilebilirlik denetimi

Ekran görüntüsü altyapısı: `scripts/shot.cjs` (headless Edge + vite preview; önce `npm run build`).

- [ ] Genişlikler: **320 / 360 / 390 / 520 / 600 / 768 / 900 / 1280** — Ana Sayfa, Ara, feed, Ayarlar sayfası: yatay kaydırma yok, metinler taşmaz (ellipsis), bileşenler üst üste binmez.
- [ ] 360×640'ta Ayarlar sayfası dikey kaydırılabilir, tüm satırlar erişilebilir.
- [ ] ≤520px: sıralama etiketi gizli, sıralama düğmesi yönü göstermeye devam eder.
- [ ] Light temada aynı genişliklerde kontrast/okunabilirlik kontrolü (özellikle küçük mono etiketler).
- [ ] `ar` (RTL): başlık, kontroller, liste hizaları **ve sekme çubuğu/kenar çubuğu** aynalanır; taşma yok.
- [ ] Klavye: Tab ile arama sonuçları gezinilir, Enter/Space açar; select/range odak halkası görünür; sekme çubuğu/kenar çubuğu öğeleri Tab ile erişilebilir, aktif öğe `aria-current="page"` taşır; Şimdi Çalıyor paneli kapatma düğmesi anlamlı `aria-label` taşır.
- [ ] Uzun başlıklar: dock'a sığmayan bölüm başlığı baştan sona kayar ve başa döner; sığan başlık **hiç** kıpırdamaz; `prefers-reduced-motion: reduce` altında kaymaz, üç noktaya döner. `ar` (RTL) dilinde kayma ters yöne gider.
- [ ] Bölüm listesi: dar ekranda başlık iki satıra sarar (tek satırda kesilmez); ikinci satır da taşarsa üç nokta ile biter.
- [ ] Uyku zamanlayıcısı seçicisi gösterdiği metnin genişliğinde durur: kapalıyken dar (hız seçicisiyle aynı ağırlıkta), "Bölüm sonunda" seçiliyken genişler; açılır liste seçenekleri tam okunur.
- [ ] Şimdi Çalıyor paneli **320×568, 375×667 ve 390×844**'te kendi kontrollerini (transport + ses + uyku/hız/kuyruk) gösterebilmelidir; ≤740px yükseklikte kapak görseli ve boşluklar küçülür.
- [ ] Atlama düğmelerindeki saniye rakamları dairesel okun tam ortasındadır (her iki yüzeyde ve ayarlardaki tüm değerlerde: 5/10/15/30/60 · 10/15/30/45/60/90).
- [ ] Arama hatasında kırmızı hata kutusu + "Tekrar dene" düğmesi; boş sonuçta boş durum mesajı; yükleme sırasında "Aranıyor..." kutusu.

## 16. Worker & derin linkler

- [ ] `npm run worker:dev` açıkken RSS worker üzerinden gelir (Network'te `/v1/feed`).
- [ ] Worker kapalıyken aynı feed halka açık proxy'lerle yine yüklenir.
- [ ] `?resume=1` → son açılan feed otomatik açılır (mağaza kısayolu).
- [ ] `?view=search` / `?view=library` / `?view=queue` / `?view=settings` → ilgili görünüm doğrudan açılır (soğuk yükleme).
- [ ] Legacy derin linkler (`?podcast=`, `?rss=`) hâlâ çalışır — 3.x'ten paylaşılan bir link bugün de aynı feed'i açar.
- [ ] Deep-link ile gelinen sayfada (feed **veya** `?view=`) "Geri" → siteden çıkmaz, tek adımda ana ekrana döner (tarayıcı geri tuşu **ve** uygulama içi geri tuşu).
- [ ] Bir view'dan başka bir view'a geçip sonra geri tuşuna basınca da tek adımda ana ekrana dönülür (aradaki view geçmişte "yığılmaz").
- [ ] PWA manifest kısayolu "Ara" → `?view=search` açar (eski davranış: boş başlangıç URL'i).

## 17. Oynatma regresyon matrisi

Her kaynak × eylem kombinasyonu en az bir kez denenir; ✓/✗ olarak işaretlenir.

| Kaynak / Eylem | Play | Seek | Sonraki/Önceki | Auto-next | Kuyruk auto-next'i ezer | Çevrimdışı indir+çal | Uyku zamanlayıcısı | Hız | Medya tuşları | Mini→Şimdi Çalıyor |
|---|---|---|---|---|---|---|---|---|---|---|
| RSS | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| iTunes (RSS'e çözümlenir) | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |

Notlar:
- **Kuyruk auto-next'i ezer**: bir bölüm kuyruğa eklenmişken çalınan bölüm biterse, auto-next ayarı açık/kapalı fark etmeksizin kuyruktaki bölüm çalar (`playback-controller.ts` — `dequeueNext` her zaman `autoNext` kontrolünden önce denenir).
- **Çevrimdışı indir+çal**: DevTools → Network → Offline ile denenir; indirilen bölüm hem çalar hem seek eder.
- **Medya tuşları**: kilit ekranı/bildirim paneli play/pause/next/prev; başlık+kapak görünür.
- **Mini transport**: mini dock üzerinde geri/ileri sarma + oynat/duraklat (≥640px'te önceki/sonraki ortada; uyku zamanlayıcısı + hız sağ kümede, panel seçicileriyle senkron); alt ilerleme çizgisi dokun/sürükle ile sarar. Başlık alanı veya genişletme oku (Enter/Space dahil) yeni bölüm başlatmadan Şimdi Çalıyor panelini açar.
- **Oynatma gezinmeden bağımsız**: bir bölüm çalarken başka bir podcast açmak (daha önce
  dinlenmiş olan dahil) sesi kesmez, kuyruğu silmez; ileri/geri **çalan** feed'de yürür.
- **Üçüncü taraf vekiller**: Ayarlar → Gizlilik'te varsayılan kapalı. Kapalıyken Worker'a
  ulaşılamazsa feed açılışı net bir mesajla başarısız olur (sessizce üçüncü tarafa gitmez).

### Yeni gezinme kontrolleri

- [ ] Sekme çubuğu (mobil) / kenar çubuğu (masaüstü): Ana Sayfa/Ara/Kütüphane/Ayarlar arasında geçiş, aktif sekme vurgusu.
- [ ] `?view=` derin linkleri (yukarıdaki bölüm 16) soğuk yükleme + uygulama-içi gezinme ile çalışır.
- [ ] Geri tuşu tek-adım-ana-ekran kuralı: feed → geri → ana ekran; view → geri → ana ekran; view → view → geri → ana ekran (asla iki adım gerekmez).
- [ ] Esc: Şimdi Çalıyor paneli açıkken kapatır; Onay diyaloğu açıkken iptal eder (odak Vazgeç'te varsayılan).

## 18. Cihazlar arası eşitleme

Otomatik testler (`src/sync/*.test.ts`, `worker/test/sync.test.ts`,
`node scripts/smoke-p6-sync.cjs`) tek makinede, tek saatte ve sahte bir arka uçla
çalışır. Aşağıdakiler yalnızca elle doğrulanabilir.

- [ ] Farklı ağlardaki **iki gerçek cihaz** (PC + telefon) eşleşiyor.
- [ ] **Gerçek saat kayması:** telefonun saatini elle 3 saat ileri al, iki
      cihazda da dinle; PC'nin daha yeni konumu yine kazanıyor. *(Tasarımın en
      riskli davranışı; hiçbir headless test OS saatini oynatamaz.)*
- [ ] **Gerçek Worker + gerçek D1**'e karşı (`wrangler dev`, sonra dağıtılmış
      API): CORS, TLS ve D1 gecikmesi smoke'takinden farklı.
- [ ] **iOS Safari**, ana ekrana kurulu PWA: uygulama arka plana atıldığında
      keepalive push gerçekten çıkıyor mu? (`beforeunload` orada tetiklenmez.)
- [ ] Uçak modu → dinle → yeniden bağlan → bekleyen gönderim boşalıyor.
- [ ] Kodu **telefon klavyesinde** yazmak: gruplar okunaklı, kopyala düğmesi iOS
      pano izniyle çalışıyor, tek harf hatası "kod hatalı" veriyor (404 değil).
- [ ] Aynı kod **üçüncü bir cihaza** yapıştırıldığında da çalışıyor.
- [ ] Alıcı cihazda **depolama dolu**: sidecar yazması kota altında düşse bile
      konum kaybolmuyor (bayat damga çatışmayı kaybeder, bu güvenli yön).
- [ ] 2 saatlik dinlemede pil ve hücresel veri maliyeti kabul edilebilir.
- [ ] Bir cihazdan "sunucudaki veriyi sil": diğeri durumu bildiriyor ve
      **yerel verisini silmiyor**.
- [ ] **Senkron öncesi bir JSON yedeğini** geri yükle, sonra eşitle: eski
      konumlar taze damga takıp diğer cihazı geri almıyor.
