-- Potiboo: profiles (Auth + Profil adımı)
-- Supabase Dashboard → Authentication → Providers → Anonymous: Enable

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_key text not null,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

-- Anonim dahil authenticated kullanıcılar isim/avatar okuyabilir
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);
