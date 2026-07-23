# Potiboo

Klasik Türk **İsim Şehir** oyununun çok cihazlı, gerçek zamanlı web versiyonu.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS
- Supabase (Postgres + Realtime + Anonymous Auth)

## Kurulum

```bash
cp .env.example .env.local
# Supabase URL ve anahtarlarını doldur

npm install
npm run dev
```

Açık [http://localhost:3000](http://localhost:3000).

### Supabase (Auth + Profil + Oda)

1. Dashboard → **Authentication → Providers → Anonymous** → Enable
2. SQL Editor’da sırayla çalıştır:
   - `supabase/migrations/001_profiles.sql`
   - `supabase/migrations/002_game_tables.sql` (tümünü kopyala-yapıştır)
3. `.env.local` içine project URL, anon key ve service role key yaz

Anahtarlar yokken uygulama **yerel moda** düşer: profil yalnızca `localStorage`’da saklanır.

Ürün spesifikasyonu: [`potiboo-spec.md`](./potiboo-spec.md).
