# Potiboo — Ürün Spesifikasyonu ve Geliştirme Prompt'u

> Bu dosyayı Cursor'da projenin köküne `SPEC.md` olarak koy ve Composer'a
> "Bu spec'e göre projeyi kur" diye başla. Bölüm bölüm ilerlemesi daha sağlıklı olur;
> hepsini tek seferde isteme.

---

## 1. Ürün Özeti

**Potiboo**, klasik Türk "İsim Şehir" oyununun (İng. *Categories* / *Scattergories*) çok cihazlı,
gerçek zamanlı web versiyonudur. Kahoot benzeri bir katılım modeli kullanır: bir kurucu oda açar,
diğer oyuncular karekod veya PIN ile katılır, oyun herkesin kendi telefonunda/tabletinde eş zamanlı akar.

**Hedef kitle:** Aileler ve arkadaş grupları. 7 yaş ve üzeri. Türkçe.

**Oyuncu sayısı: en az 3, en fazla 8.**
- 3'ten az oyuncuyla "Başlat" butonu pasif kalır (2 kişide aynı-cevap/benzersiz-cevap dengesi
  ve itiraz oylaması anlamsızlaşır)
- 8 dolduğunda oda otomatik kilitlenir, yeni katılım kabul edilmez
- Üst sınır teknik değil, kullanılabilirlik kaynaklıdır: sonuç tablosu telefon ekranında
  8 sütundan sonra okunamaz hale gelir

**İki kullanım senaryosu:**
1. Aynı evde birkaç kişi — karekod okutarak saniyeler içinde katılım
2. Farklı evlerdeki arkadaşlar — WhatsApp linki ile katılım

**Platform:** Mobil öncelikli responsive web. Uygulama indirme yok, hesap açma yok.

---

## 2. Teknoloji Yığını

| Katman | Seçim |
|---|---|
| Framework | Next.js (App Router) + TypeScript |
| Stil | Tailwind CSS |
| Backend | Supabase (Postgres + Realtime + Anonymous Auth) |
| Karekod | `qrcode` npm paketi |
| Deploy | Vercel |

**Önemli:** `SUPABASE_SERVICE_ROLE_KEY` sadece server-side kullanılacak, asla client'a sızmayacak.
Client tarafında yalnızca `NEXT_PUBLIC_SUPABASE_URL` ve `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

---

## 3. Oyun Kuralları

### 3.1 Temel akış
- Varsayılan **5 tur**, tur başına **60 saniye**, **5 kategori**
- Varsayılan kategoriler: İsim, Şehir, Hayvan, Bitki, Eşya
- Her tur bir harf ile oynanır, herkes o harfle başlayan cevap yazar

### 3.2 Harf havuzu
Türk alfabesinden **Ğ çıkarılmıştır** (hiçbir kelime Ğ ile başlamaz).

Havuzda şu harfler **sade formda** bulunur ve iki varyantı da kabul edilir:

| Havuzdaki harf | Kabul edilen başlangıçlar |
|---|---|
| C | C, Ç |
| S | S, Ş |
| U | U, Ü |
| O | O, Ö |
| I | I, İ |

Yani harf "O" çıktıysa "Ördek" de "Orman" da geçerlidir.
Ç, Ş, Ü, Ö, İ havuzda **ayrıca** çıkmaz.

Kalan harfler normal havuzda: A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, R, S, T, U, V, Y, Z

### 3.3 "Dur" mekanizması
Harf rastgele değil, **sırayla bir oyuncu tarafından durdurulur**.

- Her turda sıra bir sonraki oyuncuya geçer (round-robin, lobiye katılım sırasına göre)
- O turun "durdurucu" oyuncusunun ekranında büyük **DUR** butonu vardır
- Diğer oyuncular "*Ayşe harfi seçiyor...*" mesajı görür
- Ekranda harfler hızla döner (~80ms aralıkla), durdurucu basar
- Seçilen harf **herkeste eş zamanlı** büyük gösterilir → 3-2-1 geri sayım → süre başlar

> Bu tasarım bilinçlidir: "ilk basan kazanır" modeli ağ gecikmesi nedeniyle adaletsizdir,
> tamamen rastgele harf ise oyunun en eğlenceli anını yok eder.

### 3.4 Süre ve bitirme
- Süre kurucunun ayarladığı değerdir (varsayılan 60 sn)
- Oyuncu erken bitirirse **"Bitirdim"** butonuna basar → bitirme sırası kaydedilir
- **Herkes bitirdiğinde tur otomatik olarak biter**, süre dolmasını beklemez
- Süre dolarsa yazılmış her şey otomatik gönderilir

### 3.5 Puanlama

**Temel puan (kategori başına):**
- **20 puan** — geçerli cevap, başka kimse aynısını yazmamış
- **10 puan** — geçerli cevap, en az bir başka oyuncu da aynısını yazmış
- **0 puan** — boş, harfle başlamıyor, veya itiraz sonucu geçersiz sayılmış

Aynılık karşılaştırması: küçük harfe çevrilmiş, baş/son boşlukları kırpılmış hâliyle yapılır.
Türkçe karakter denkliği burada **uygulanmaz** ("Ördek" ile "Ordek" farklı cevaplardır).

**Hız bonusu (tur başına, ayarlardan kapatılabilir):**
- Sadece **tüm kategorileri doldurmuş** oyuncular arasında dağıtılır
- Bitirme sırasına göre: **1. → 10, 2. → 6, 3. → 3, 4. → 1, 5. ve sonrası → 0**

> 4. sıraya 1 puan verilmesi kalabalık gruplar içindir: 8 kişilik oyunda
> yalnızca ilk üçün bonus alması, ortada kalanlar için bonusu tamamen anlamsız kılar.
- Eksik bırakıp erken bitiren hız bonusu **alamaz**

> Bu kısıt bilinçlidir: ham hızı ödüllendirmek, çocukları "Ali, Ankara, At" gibi
> en kolay cevapları yazıp hemen bitirmeye iter ve oyunu sığlaştırır.
> Hız bonusunun küçük tutulması (max 10, tur toplamı 100 iken) da aynı sebepledir.

Ayarlarda kapatılabilir olması yaş farkı olan gruplar içindir — 7 yaşındaki çocuk
12 yaşındakiyle yazma hızında yarışamaz.

### 3.6 Doğrulama ve itiraz

**Otomatik elemeler (itiraz gerektirmez):**
- Boş cevap → 0
- Doğru harfle başlamayan cevap → 0 (denklik kuralı uygulanarak kontrol edilir)

**İtiraz sistemi:**
- Süre bitince sonuç tablosu görünür: satır = kategori, sütun = oyuncu
- Puanlar önceden hesaplanmış gelir
- Her cevabın yanında **"İtiraz"** butonu vardır
- **Tur başına kişi başı en fazla 2 itiraz hakkı**
- Kendi cevabına itiraz edilemez
- İtiraz edilince o cevap için hızlı oylama açılır:
  - İtiraz eden hariç herkes "Geçerli" / "Geçersiz" der
  - **15 saniye** sayaç; süre dolarsa mevcut oylar geçerli sayılır
  - **Oylar eşitse cevap GEÇERLİ sayılır** (masumiyet karinesi — çift sayılı gruplarda
    2-2 veya 3-3 kilitlenmesin)
- Kimse itiraz etmezse kurucu "Devam" der

**Kalabalık grup kuralları:**
- Aynı anda birden fazla itiraz açılabilir, ancak **sırayla** oylanır (kuyruk mantığı).
  8 kişilik oyunda 6 itiraz paralel açılırsa ekran kaosa döner.
- Kuyrukta bekleyen itirazlar "2/5" gibi bir sayaçla gösterilir
- Bağlantısı kopuk oyuncular oy sayımına dahil edilmez

> Neden "her cevaba oylama" değil de "itiraz üzerine oylama": 5 kişi × 5 kategori = 25 oylama
> her turda oyunu tamamen tıkar. İtiraz modeli hem hızlıdır hem de
> "at evcil hayvan mı?" tartışmasının keyfini korur.

### 3.7 ⚠️ Yeniden hesaplama (KRİTİK — atlanması kolay)

Bir cevap itiraz sonucu **geçersiz** sayılırsa, o turun puanları **baştan hesaplanmalıdır**:

**Örnek:** Kategori "Hayvan", harf K.
- Ali: "Kedi" → 10 puan (Ayşe de yazmış)
- Ayşe: "Kedi" → 10 puan
- Mehmet: "Kanguru" → 20 puan

Ayşe'nin "Kedi" cevabı itirazla geçersiz sayılırsa:
- Ayşe: 0 puan
- **Ali: 10 → 20 puan** (artık tek yazan o)
- Mehmet: 20 puan (değişmez)

Ayrıca: geçersiz sayılan cevap yüzünden oyuncunun **tüm kategorileri dolu** durumu bozulursa,
**hız bonusu da geri alınmalı** ve sıradaki oyunculara kaydırılmalıdır.

Puan hesaplama saf bir fonksiyon olarak yazılmalı ve her itiraz çözümünden sonra
tur verisi üzerinde **yeniden çalıştırılmalıdır** — artımlı düzeltme yapılmamalı.

---

## 4. Kullanıcı Akışı

### 4.1 İlk açılış — Profil
Site açıldığında Supabase `signInAnonymously()` arka planda çalışır.
Kullanıcı hiçbir şey yapmaz, e-posta/şifre yok.

Profil ekranı: **isim** (metin girişi) + **avatar** (hayvan setinden seçim).
Bir kez yapılır, `localStorage` + Supabase profil tablosunda saklanır.
Sonraki girişlerde doğrudan ana ekrana gider.

*(İleride: tarayıcı verisi silinirse profil kaybolur. v2 için "profil aktar kodu" düşünülebilir, şimdilik gerekmez.)*

### 4.2 Ana ekran
İki büyük buton: **Yeni Oyun** ve **Odaya Katıl** (PIN girişi).

### 4.3 Oda kurma (kurucu)
1. "Yeni Oyun" → 4 haneli PIN üretilir (karışabilecek karakterler hariç: 0/O, 1/I/l)
2. Ekranda **büyük karekod + PIN yan yana** görünür
3. Altında: **"Linki Paylaş"** butonu — `navigator.share()` ile WhatsApp'a gider
4. Katılanlar listesi canlı dolar (avatar + isim)
5. Üstte tek satır **Ayarlar**: süre / tur sayısı / kategoriler / hız bonusu aç-kapa
   - **Varsayılanlar hazır gelir, hiç dokunmadan başlatılabilir**
6. **Başlat** butonu

> Aynı evde karekod en hızlı yoldur (kod yazmaya gerek yok).
> Uzaktaki arkadaş için paylaş linki. İkisi de aynı ekranda.

### 4.4 Katılım (oyuncu)
- Karekod okut → link doğrudan odaya sokar
- Veya ana ekranda PIN gir → katıl
- **Geç katılım yok**: oyun başladıktan sonra oda kilitlenir
- **Yeniden bağlanma var**: bağlantısı kopan oyuncu aynı PIN ile geri girebilir, puanları korunur

### 4.5 Tur akışı
```
Lobi
 → Kurucu "Başlat"
 → Herkes tur ekranına geçer
 → Durdurucu oyuncuda DUR butonu, diğerlerinde bekleme mesajı
 → Harfler döner, DUR basılır
 → Harf herkeste eş zamanlı büyük görünür
 → 3-2-1 geri sayım
 → Süre başlar, herkes yazar
 → "Bitirdim" (hız sırası kaydedilir)
 → Herkes bitince VEYA süre dolunca → sonuç ekranı
 → Cevap tablosu + puanlar + itiraz butonları
 → İtirazlar çözülür, puanlar yeniden hesaplanır
 → Kurucu "Sonraki Tur"
```
5 tur sonunda: **final sıralaması** (podyum + toplam puanlar + tur bazlı kırılım).

### 4.6 Kurucu düşerse
Kurucu bağlantısı koparsa, **odada en uzun süredir bulunan oyuncuya** kurucu yetkisi devredilir.
Aksi hâlde oyun kilitlenir.

---

## 5. Veri Modeli (Supabase)

```sql
-- Oyuncu profilleri (anonim auth user'a bağlı)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_key text not null,
  created_at timestamptz default now()
);

-- Oyun odaları
create table rooms (
  id uuid primary key default gen_random_uuid(),
  pin text unique not null,
  host_id uuid references profiles(id),
  status text not null default 'lobby',   -- lobby | playing | finished
  settings jsonb not null,                -- {duration, roundCount, categories[], speedBonus}
  current_round int default 0,
  created_at timestamptz default now()
);

-- Odadaki oyuncular
create table room_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade,
  profile_id uuid references profiles(id),
  join_order int not null,                -- "Dur" sırası ve kurucu devri için
  is_connected boolean default true,
  total_score int default 0,
  joined_at timestamptz default now(),
  unique (room_id, profile_id)
);

-- Turlar
create table rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade,
  round_number int not null,
  letter text,
  stopper_id uuid references profiles(id),  -- bu turda DUR'a basan
  phase text not null default 'waiting',    -- waiting | spinning | countdown | writing | scoring | done
  started_at timestamptz,
  ended_at timestamptz,
  unique (room_id, round_number)
);

-- Cevaplar
create table answers (
  id uuid primary key default gen_random_uuid(),
  round_id uuid references rounds(id) on delete cascade,
  profile_id uuid references profiles(id),
  category text not null,
  value text,
  score int default 0,
  is_invalidated boolean default false,     -- itiraz sonucu
  unique (round_id, profile_id, category)
);

-- Tur bazlı oyuncu durumu (hız sırası, bonus)
create table round_players (
  id uuid primary key default gen_random_uuid(),
  round_id uuid references rounds(id) on delete cascade,
  profile_id uuid references profiles(id),
  finished_at timestamptz,
  finish_rank int,
  speed_bonus int default 0,
  objections_used int default 0,            -- max 2
  round_score int default 0,
  unique (round_id, profile_id)
);

-- İtirazlar
create table objections (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid references answers(id) on delete cascade,
  raised_by uuid references profiles(id),
  status text not null default 'voting',    -- voting | valid | invalid
  created_at timestamptz default now(),
  resolved_at timestamptz
);

-- İtiraz oyları
create table objection_votes (
  id uuid primary key default gen_random_uuid(),
  objection_id uuid references objections(id) on delete cascade,
  profile_id uuid references profiles(id),
  is_valid boolean not null,
  unique (objection_id, profile_id)
);
```

### RLS Politikaları
Tüm tablolarda RLS **açık** olacak. Temel kural:
**Oyuncu yalnızca üyesi olduğu odanın verisini okuyabilir/yazabilir.**

Kritik detay: **yazma süresi devam ederken bir oyuncu diğerlerinin cevaplarını görememelidir.**
`answers` tablosunda okuma politikası, ilgili turun `phase` alanı `scoring` veya `done` olduğunda
başkalarının cevaplarını açacak şekilde kurulmalı. Aksi hâlde çocuklar
Supabase isteklerini izleyerek kopya çekebilir.

### Realtime
Supabase Realtime aboneliği: `rooms`, `rounds`, `room_players`, `objections` tablolarındaki
değişiklikler tüm istemcilere yayınlanır. Faz geçişleri (`rounds.phase`) senkronizasyonun
temelidir.

---

## 6. Marka ve Tasarım

**Marka adı:** Potiboo

**Not:** Görsel dil, aynı ekibin daha önce yaptığı **Quiboo** uygulamasıyla kardeş olacak şekilde
kurgulanmıştır. Quiboo'nun mevcut varlıkları (avatar görselleri, renk değişkenleri, font seçimi)
yeni projeye doğrudan taşınabilir.

**Renk paleti:**
- Zemin: çok koyu lacivert-siyah (`#0a0f14` civarı), hafif radial gradient ile derinlik
- Vurgu: turkuaz-mavi (`#3d9dc4` civarı)
- Kart yüzeyleri: zeminden bir ton açık, ince açık-gri kenarlık, yuvarlak köşe (16-20px)
- Metin: beyaz (başlık), açık gri (gövde)

**Tipografi:** Yuvarlak geometrik sans-serif. Türkçe karakter desteği şart.
Google Fonts'tan **Poppins** veya **Baloo 2**. Başlıklar kalın ve büyük.

**Avatarlar:** Takım elbiseli hayvan portreleri (panda, aslan, kedi vb.) — Quiboo'daki set.
Dosyalar mevcut projeden taşınacak. **En az 16 farklı avatar** olmalı — 8 kişilik tam dolu
odada herkes farklı avatar seçebilmeli, üstelik seçim özgürlüğü kalmalı.
Bir avatar bir odada yalnızca bir oyuncu tarafından kullanılabilir; alınmış olanlar
seçim ekranında soluk gösterilir.

**Ton:** Enerjik ama sakin. Kahoot'un aşırı doygun renklerinden ziyade koyu-şık bir zemin
üzerinde tek güçlü vurgu rengi. Çocuklara sevimli, yetişkinlere ucuz görünmeyen bir denge.

**Mobil öncelikli:** Tüm ekranlar önce dar viewport için tasarlanacak.
Yazma ekranında 5 giriş alanı klavye açıkken de rahat kullanılabilmeli.

**Kalabalık grup için sonuç ekranı (önemli):**
8 oyuncu × 5 kategori bir telefon ekranına sığmaz. Sonuç tablosu şöyle çalışmalı:

- Varsayılan görünüm **kategori kategori**: tek seferde bir kategori gösterilir,
  o kategorideki tüm oyuncuların cevapları alt alta listelenir (yatay kaydırma yok)
- Kategoriler arasında sekme veya kaydırma ile geçilir
- Her cevabın yanında puan rozeti ve itiraz butonu
- Geniş ekranda (tablet/masaüstü) klasik ızgara görünümüne geçilebilir

Bu, yatay kaydırmalı bir tabloyu telefonda okumaya çalışmaktan çok daha kullanışlıdır.

---

## 7. Geliştirme Sırası

Cursor'a bu sırayla ilerlet, her adımdan sonra test et:

1. **İskelet** — Next.js + Tailwind + Supabase client kurulumu, tasarım tokenları
2. **Auth + Profil** — anonim giriş, isim/avatar seçimi, kalıcılık
3. **Veri modeli** — SQL migration'ları, RLS politikaları
4. **Lobi** — oda kurma, PIN, karekod, paylaş linki, katılım, canlı oyuncu listesi
5. **Realtime senkronizasyon** — faz geçişleri tüm cihazlarda çalışıyor mu
6. **Tur mekaniği** — DUR butonu, harf dönüşü, geri sayım, süre, yazma ekranı
7. **Puanlama** — saf fonksiyon olarak, birim testleriyle (özellikle yeniden hesaplama)
8. **İtiraz sistemi** — oylama, 15sn sayaç, puan yeniden hesaplama
9. **Final ekranı** — sıralama, podyum, tur kırılımı
10. **Dayanıklılık** — yeniden bağlanma, kurucu devri, kenar durumlar

**Öncelikli birim testleri:** Puanlama fonksiyonu. Özellikle:
- İtiraz sonrası 10 → 20 yükselmesi
- Hız bonusunun geri alınması
- Türkçe harf denkliği kontrolü (O harfinde "Ördek" geçerli mi)

---

## 8. Sonraki Sürüm Fikirleri (şimdi yapma)

- Kategori havuzu genişletme (Ünlü, Ülke, Meslek, Marka, Film)
- Kalıcı istatistikler: en çok tur kazanan, favori kategori
- Profil aktarma kodu (cihaz değişikliği için)
- Tek kişilik pratik modu
- Otomatik kelime doğrulama (Türkçe sözlük + il listesi entegrasyonu)
