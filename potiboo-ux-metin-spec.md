# Potiboo — UX Metin & Akış Revizyonu (Cursor Agent Spec)

Bu doküman bir uygulama görevidir. Aşağıdaki değişiklikleri mevcut kod tabanına uygula.
Kapsam: **ana sayfa, oyun sayfası, lobi (bekleme odası) ve dil altyapısı.** Oyunların iç mekanikleri (oyun içi ekranlar) bu kapsamın dışındadır — dokunma.

---

## 0. Genel Kurallar

Bu kurallar tüm ekranlarda geçerlidir; çakışma olursa bu bölüm kazanır.

### Marka kilidi
- **"Potiboo"** ve **"Fun, together"** hiçbir dilde çevrilmez, hiçbir koşulda değişmez.
- `Fun together` → **`Fun, together`** olarak güncellenecek (virgül eklendi).
- Slogan yalnızca logo bloğunun içinde, logonun altında yaşar. Sayfa gövdesinde bağımsız bir cümle olarak tekrar etmez.
- Slogan i18n dosyalarına **girmez**; logo bileşenine sabit yazılır.

### Yazım tonu
- Tüm oyun açıklamaları **emir kipi** ve **ikinci tekil şahıs** olacak. (`Aynı anda yaz` ✔ / `Klasik üç taş; hızlı turlar` ✘)
- Kısa UI metinlerinin (başlık, kart açıklaması, buton, etiket) **sonunda nokta yok.** Cümle içi virgül serbest.
- Noktalı virgül ve uzun tire (—) UI metinlerinde kullanılmaz.
- Butonlar **fiil** içerir, isim değil. (`Oyunu Kur` ✔ / `Yeni Oyun` ✘)
- Aynı ifade iki satır arayla tekrar etmez.

### Sayı & format standardı
- Oyuncu sayısı **her yerde tireli aralık**: `2–8 kişi`. Tek değerse `2 kişi`. Slash formatı (`2 / 4 / 8`) kaldırılacak.
- Kısa çizgi değil, **en dash (–)** kullanılacak.
- Meta satırı formatı: `2–8 kişi · ~7 dk` (orta nokta ayraçlı).
- Süre bilgisi **zorunlu alan**. Her oyunun kartında ve sayfasında görünecek.

---

## 1. Dil Altyapısı (i18n)

- Diller: **Türkçe (varsayılan)** ve **İngilizce**.
- Rotalama: `/tr/...` ve `/en/...` şeklinde **ayrı URL yolları**. Tek sayfada JS ile içerik değiştirme yapma (SEO kaybı).
- İlk ziyarette tarayıcı diline göre otomatik yönlendir; kullanıcı seçimini `localStorage` + cookie'de sakla, sonraki ziyaretlerde otomatik algılamayı ez.
- Dil değiştirici **sağ üstte, avatarın hemen solunda**. Sade `TR / EN` toggle, bayrak ikonu kullanma.
- `<html lang>` ve `hreflang` etiketleri doğru dile ayarlanacak.
- İngilizce metinler Türkçe'nin birebir çevirisi **değildir**; aşağıdaki tabloda verilen İngilizce metinler aynen kullanılacak.
- Tüm metinler `locales/tr.json` ve `locales/en.json` dosyalarına taşınacak. Bileşenlerde sabit metin (hardcoded string) kalmayacak.

---

## 2. Oyun İsimleri ve Metinleri

### 2.1 İsim değişiklikleri

Mevcut isimlerin bir kısmı **tescilli markalarla çakışıyor** ve/veya iki dilli kullanıma uygun değil. Yeni isimler `Synked` modelini takip ediyor: kısa, uydurma, iki dilde de aynı yazılıp okunuyor, marka ailesine ait.

| Mevcut | Yeni ad | Değişim nedeni |
|---|---|---|
| İsim Şehir | **Stoppa** | İngilizce karşılığı yok; `Scattergories` tescilli |
| XOX | **XOX** | Değişmiyor — jenerik sembol, risk yok |
| Synked | **Synked** | Değişmiyor — model alınan isim |
| Harf Bul | **Lettro** | `Wordle` tescilli (NYT); jenerik ad marka olmuyor |
| Amiral Battı | **Flotto** | `Battleship` tescilli (Hasbro) |
| Tabu | **Muto** | `Taboo` tescilli (Hasbro) — mevcut ad doğrudan ihlal riski |

**Uygulama notu:** Oyun isimleri kod içinde sabit yazılmayacak; `games.config.ts` benzeri tek bir kaynak dosyada tanımlanacak, tüm ekranlar oradan okuyacak. Böylece isim değişikliği tek yerden yapılabilir.
Oyun isimleri **i18n'e girmez** — her iki dilde de aynıdır.

### 2.2 Metin tablosu

**Türkçe**

| Oyun | Açıklama | Meta | Durum |
|---|---|---|---|
| Stoppa | Aynı anda yaz, ilk biten DUR desin | 2–8 kişi · ~7 dk | Aktif |
| XOX | Üç taşı diz, turu kap | 2–8 kişi · ~2 dk | Aktif |
| Synked | Aynı kelimeyi düşünün, 4 turda tutturun | 2–4 kişi · ~3 dk | Aktif |
| Lettro | İpuçlarını takip et, gizli kelimeyi bul | 1–4 kişi · ~4 dk | Yakında |
| Flotto | Filonu gizle, rakibini batır | 2 kişi · ~8 dk | Yakında |
| Muto | Yasaklı kelimelere takılmadan anlat | 4–8 kişi · ~10 dk | Yakında |

**İngilizce**

| Oyun | Açıklama | Meta | Durum |
|---|---|---|---|
| Stoppa | Write together, first one done calls STOP | 2–8 players · ~7 min | Active |
| XOX | Line up three, take the round | 2–8 players · ~2 min | Active |
| Synked | Think the same word, match within 4 rounds | 2–4 players · ~3 min | Active |
| Lettro | Follow the clues, catch the hidden word | 1–4 players · ~4 min | Coming soon |
| Flotto | Hide your fleet, sink theirs | 2 players · ~8 min | Coming soon |
| Muto | Describe it without the banned words | 4–8 players · ~10 min | Coming soon |

> Not: XOX'un `2 / 4 / 8` formatı turnuva modunu anlatıyorsa bu bilgi meta satırında değil, oyun sayfasındaki "Nasıl oynanır" bölümünde açıklanmalı.

---

## 3. Ana Sayfa

### 3.1 Hero metinleri

| Alan | TR | EN |
|---|---|---|
| Başlık | Bugün ne oynuyoruz? | What are we playing? |
| Alt başlık | Oyunu aç, PIN'i paylaş — arkadaşların saniyeler içinde masada | Start a game, share the PIN — your friends are in within seconds |

### 3.2 PIN girişi — YENİ, ZORUNLU

**Mimari değişiklik:** PIN artık **oyun bazlı değil, platform bazlıdır.**

Gerekçe: Arkadaşı telefonda "Potiboo'ya gir, PIN 4821" diyen kullanıcı hangi oyuna tıklayacağını bilmez. PIN zaten hangi odaya ait olduğunu söylüyor; kullanıcıya oyun sordurmak gereksiz sürtünme.

Uygulanacak davranış:
- Ana sayfada, **header'da kalıcı bir "PIN ile katıl" girişi** bulunacak (dar ekranda hero'nun hemen altına düşebilir).
- Girilen PIN backend'de çözülecek: sistem odayı bulur, **oyunu kendisi belirler**, kullanıcıyı doğrudan o odanın lobisine alır.
- Oyun sayfasındaki PIN kutusu kalabilir ama **asıl kapı ana sayfadaki giriştir** ve o da aynı platform-bazlı endpoint'i kullanır.
- Geçersiz PIN'de net hata: `Bu PIN'e ait açık oda yok` / `No open room for this PIN`.

| Alan | TR | EN |
|---|---|---|
| Başlık | PIN'in var mı? | Got a PIN? |
| Placeholder | PIN'in gerçek formatı (bkz. §5.1) | aynı |
| Buton | Katıl | Join |

### 3.3 Oyun kartları

- Grid sıralaması: **aktif oyunlar önce**, "Yakında" olanlar sonra.
- "Yakında" kartları görsel olarak daha da geriye itilecek (opaklık düşük, hover efekti yok, tıklanamaz).
- **Her "Yakında" kartına `Haber ver` / `Notify me` butonu eklenecek.** Tıklanınca e-posta alan küçük bir modal açılır, kayıt hangi oyuna ait olduğu bilgisiyle saklanır. Amaç: ölü alanı talep ölçümüne ve e-posta toplamaya çevirmek.
- Kart yapısı: `Oyun adı` + `Rozet (OYNA / YAKINDA)` + `Açıklama` + `Meta satırı (kişi · süre)`.
- Rozet metinleri: TR `OYNA` / `YAKINDA`, EN `PLAY` / `SOON`.

---

## 4. Oyun Sayfası

### 4.1 Hiyerarşi düzeltmesi — kritik

Şu an sayfanın en büyük metni platform vaadi (`Arkadaşlarınla aynı anda oyna`), oyun adı ise en küçük öğe. Bu ters; kullanıcı buraya **o oyunu oynamaya** geldi. Ayrıca bu başlık her oyun sayfasında aynı olduğu için altı sayfa birbirinin kopyası oluyor (SEO kaybı).

Yeni sıralama:

```
Oyun adı              ← H1, en büyük
Oyun açıklaması       ← alt satır
2–8 kişi · ~7 dk      ← meta
[ Oyunu Kur ]         ← birincil CTA
```

- Platform vaadi bu sayfadan **tamamen kaldırılacak** (ana sayfanın işi).
- Üstteki küçük rozetin içindeki **mavi nokta kaldırılacak** — canlı/aktif durum çağrıştırıyor ama bir anlam taşımıyor. Gerçek bir sinyale bağlanacaksa (`3 oda açık`) kalabilir, aksi halde silinecek.
- Sayfa `<title>` ve meta description oyun bazlı üretilecek.

### 4.2 Metinler

| Alan | TR | EN |
|---|---|---|
| Geri linki | ← Oyunlar | ← Games |
| Birincil CTA | Oyunu Kur | Start a Room |
| Katılma bloğu başlığı | Oyuna katıl | Join a game |
| Katılma bloğu alt metni | Arkadaşının paylaştığı PIN'i gir | Enter the PIN your friend shared |
| Katıl butonu | Katıl | Join |

`Ekrandaki PIN'i gir` metni kaldırılacak — hangi ekran olduğu belirsiz, kullanıcı kendi ekranına bakıyor ve orada PIN yok.

### 4.3 "Nasıl oynanır" bölümü — YENİ

- Birincil CTA'nın altında **açılır (accordion) bir "Nasıl oynanır?" / "How to play"** bloğu olacak, varsayılan kapalı.
- İçerik: en fazla 3 madde, kısa cümleler.
- Gerekçe: Oyunların bilindiği varsayılamaz — küçük çocuklar ve özellikle **İngilizce sürümdeki kullanıcılar** için Stoppa gibi oyunların kültürel karşılığı yok.
- İçerik `games.config` içinde oyun başına tanımlanacak, i18n'den okunacak.

---

## 5. Lobi (Bekleme Odası)

### 5.1 PIN formatı — kritik değişiklik

Mevcut harf PIN'i (`ZRCF`) **sayısal PIN'e çevrilecek.**

Gerekçe: PIN'in tek işi telefonda söylenebilmek. Harf okumak hem Türkçe hem İngilizce'de belirsizlik üretiyor (Z/ze-zet, C/ce-se, I/i-ay, büyük-küçük harf karışıklığı) ve mobilde harf klavyesi açılıyor.

- **6 haneli sayısal PIN** kullanılacak.
- Tüm PIN girdi alanlarında `inputmode="numeric"` ve `pattern="[0-9]*"` — mobilde sayı tuş takımı açılmalı.
- Placeholder gerçek formatı göstermeli: `4 8 2 1 9 3` gibi (kaç hane olduğunu anında öğretir). `PIN` yazan placeholder kaldırılacak.
- PIN kutusuna değer **yapıştırıldığında veya hane sayısı tamamlandığında otomatik gönderim** yapılacak; kullanıcı "Katıl"a basmak zorunda kalmayacak.
- **PIN'in kendisi tıklanabilir olacak**: dokununca panoya kopyalanır, `Kopyalandı` / `Copied` geri bildirimi gösterilir.

### 5.2 Düzen değişiklikleri

**Ayarlar bloğu katlanacak.** Şu an PIN bloğu ile oyuncu listesinin arasına giriyor ve "davet ettim → geliyorlar" hikâyesini ikiye bölüyor.

- Varsayılan **kapalı**, tek satır özet gösterilecek:
  `⚙ Ayarlar · 60 sn · 5 tur · 7 kategori`
- Açıldığında mevcut ayar alanları görünür.
- Böylece PIN bloğu ile oyuncu listesi yan yana gelir.

**Paylaşım önceliği ekran boyutuna göre değişecek:**
- Mobil/dar ekran: **`Linki Paylaş` en üstte**, karekod altında veya gizli. (Kurucu kendi telefonundan kendi karekodunu okuyamaz.)
- Masaüstü/geniş ekran: karekod baş köşede kalır.

**Yedek link kısaltılacak:** Karekod okunamadığında tek yedek elle yazılan linktir. Prodüksiyonda `potiboo.com/4821 93` gibi **elle yazılabilecek kadar kısa** olmalı. Uzun IP/port formatı yalnızca lokal geliştirmede kalsın.

### 5.3 Oyuncu listesi

- Üstteki `1 / 8 oyuncu` sayacı kaldırılacak, listenin başlığına taşınacak: `OYUNCULAR (1/8)` / `PLAYERS (1/8)`.
- Liste **boş slotlar** gösterecek: doldurulmamış sıralar soluk placeholder olarak görünür. Boşluğun kendisi kurucuyu paylaşmaya iter.
- Yeni oyuncu katıldığında **kısa bir giriş animasyonu + hafif ses efekti** (ses varsayılan açık, kapatılabilir).
- Kurucuya **oyuncu çıkarma yetkisi** eklenecek: her oyuncu satırında (kendisi hariç) küçük bir kaldırma aksiyonu. PIN tahmin edilebilir olduğu için yanlış kişi girdiğinde kurucu çaresiz kalmamalı.

### 5.4 Başlat butonu

`Başlat (en az 2 oyuncu)` etiketi kaldırılacak — buton etiketinin içine hata mesajı gömülmüş durumda.

Yeni davranış:

```
Arkadaşların katılmayı bekliyor…     ← butonun üstünde, durum metni
[ Oyunu Başlat ]                      ← pasif durumda
```

- 2. oyuncu katıldığı anda durum metni kaybolur ve buton **belirgin şekilde canlanır** (renk + hafif animasyon). Bu geçiş kurucuya "başlayabilirsin" sinyali verir.
- TR: `Arkadaşların katılmayı bekliyor…` / `Oyunu Başlat`
- EN: `Waiting for friends to join…` / `Start Game`

### 5.5 Ayarlar bloğu içi düzeltmeler

**Kategori çipleri — görsel hiyerarşi ters, düzeltilecek.**
Şu an seçili kategoriler soluk düz metin, eklenebilecekler çerçeveli ve parlak görünüyor; yani seçili olanlar pasif, olmayanlar aktif duruyor. Tersine çevrilecek:
- **Seçili kategoriler:** dolu/vurgulu çip, yanında `×` ile kaldırılabilir.
- **Eklenebilir kategoriler:** soluk kenarlıklı, `+` ile eklenir.

**Sayaç netleştirilecek:** `Kategoriler · +2 ilave` belirsiz (2 eklendi mi, 2 daha eklenebilir mi?). Yerine: `Kategoriler 5/7` / `Categories 5/7`.

**Hız bonusuna açıklama eklenecek:** Şu an ne yaptığı yazmıyor; kurucu bilmediği ayarı ya kapatır ya rastgele bırakır.
- TR alt metin: `Turu ilk bitirene ek puan`
- EN alt metin: `Bonus points for finishing first`

**Tur alanı:** Etiket `Tur`, değer `5 tur` → etiket **`Tur sayısı`**, değer **`5`**. (EN: `Rounds` / `5`) Aynı kelime iki kez tekrar etmesin.

**Tahmini süre gösterilecek:** Süre × tur zaten belli; toplamı kullanıcıya hesaplatma. Ayarların altında canlı güncellenen bir satır:
`Tahmini süre ~7 dk` / `Estimated ~7 min`

### 5.6 Diğer metinler

| Alan | TR | EN |
|---|---|---|
| Çıkış (kurucu) | Odayı Kapat | Close Room |
| Çıkış (oyuncu) | Ayrıl | Leave |
| PIN etiketi | Oda PIN'i | Room PIN |
| Paylaş butonu | Linki Paylaş | Share Link |
| Ayarlar başlığı | Ayarlar | Settings |
| Oyuncular başlığı | OYUNCULAR (1/8) | PLAYERS (1/8) |
| Kurucu rozeti | Kurucu | Host |

- `Çık` metni kurucu için belirsiz (oda kapanıyor mu, arka planda mı duruyor?). Kurucuya **`Odayı Kapat`** gösterilecek ve **onay modalı** istenecek: `Oda kapanacak ve herkes düşecek. Emin misin?`
- Kurucu olmayan oyuncular için `Ayrıl`, onay gerekmez.
- `Oda PIN` → `Oda PIN'i` (Türkçe iyelik eki).

---

## 6. Uygulama Kontrol Listesi

- [ ] `Fun together` → `Fun, together`, logo bileşenine sabitlendi, i18n dışında
- [ ] `/tr` ve `/en` rotaları, dil toggle'ı sağ üstte, tercih saklanıyor
- [ ] Tüm metinler `tr.json` / `en.json`'a taşındı, hardcoded string kalmadı
- [ ] Oyun isimleri `games.config` içinde tek kaynakta, i18n dışında
- [ ] 6 oyunun adı, açıklaması, meta bilgisi ve durumu iki dilde güncellendi
- [ ] Tüm meta satırları `X–Y kişi · ~Z dk` formatında, süre bilgisi her yerde var
- [ ] Ana sayfada platform-bazlı PIN girişi çalışıyor, oyun sormadan odaya alıyor
- [ ] Aktif oyunlar üstte, "Yakında" kartlarında `Haber ver` butonu ve e-posta kaydı
- [ ] Oyun sayfasında oyun adı H1, platform vaadi kaldırıldı, mavi nokta silindi
- [ ] Oyun sayfasında açılır "Nasıl oynanır" bölümü, oyun başına 3 madde
- [ ] PIN 6 haneli sayısal, `inputmode="numeric"`, otomatik gönderim, tıkla-kopyala
- [ ] Lobide ayarlar katlanır ve özet satırı gösteriyor
- [ ] Oyuncu listesinde boş slotlar, katılım animasyonu, kurucu çıkarma yetkisi
- [ ] Başlat butonundaki parantezli açıklama kaldırıldı, durum metni butonun dışında
- [ ] Kategori çiplerinin aktif/pasif görselleri ters çevrildi, sayaç `5/7` formatında
- [ ] Hız bonusu açıklaması, `Tur sayısı` etiketi, canlı tahmini süre eklendi
- [ ] Kurucuya `Odayı Kapat` + onay modalı, oyuncuya `Ayrıl`
- [ ] Mobilde `Linki Paylaş` karekodun üstünde
- [ ] Hiçbir UI metni nokta ile bitmiyor, tüm açıklamalar emir kipinde

---

## 7. Kapsam Dışı

- Oyunların iç ekranları ve mekanikleri (tur akışı, DUR anı, itiraz/oylama, skor tablosu)
- Görsel kimlik, renk paleti, tipografi seçimi
- Backend oda yönetimi mimarisi (yalnızca PIN çözümleme davranışı bu kapsamda)
