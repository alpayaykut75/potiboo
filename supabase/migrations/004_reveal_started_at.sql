-- Kategori açılış süresi için zaman damgası
alter table public.rounds
  add column if not exists reveal_started_at timestamptz;
