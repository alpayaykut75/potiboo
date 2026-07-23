-- Potiboo: harf tekrarsızlığı + kategori açılış indeksi
-- SQL Editor'da çalıştır

alter table public.rooms
  add column if not exists used_letters text[] not null default '{}';

alter table public.rounds
  add column if not exists reveal_index int not null default 0;

-- reveal_index:
--   0 .. categories.length-1  → o kategori açılıyor
--   categories.length         → tur özeti
