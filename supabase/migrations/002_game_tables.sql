-- Potiboo: oyun tabloları + RLS + Realtime
-- Sıra önemli: önce tablolar, sonra fonksiyonlar, en sonda politikalar.
-- profiles (001) zaten var olmalı.

-- ─── 1) Tablolar ───────────────────────────────────────────
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  pin text unique not null,
  host_id uuid references public.profiles(id),
  status text not null default 'lobby'
    check (status in ('lobby', 'playing', 'finished')),
  settings jsonb not null,
  current_round int default 0,
  created_at timestamptz default now()
);

create table if not exists public.room_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  profile_id uuid not null references public.profiles(id),
  join_order int not null,
  is_connected boolean default true,
  total_score int default 0,
  joined_at timestamptz default now(),
  unique (room_id, profile_id)
);

create index if not exists room_players_room_id_idx on public.room_players(room_id);

create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_number int not null,
  letter text,
  stopper_id uuid references public.profiles(id),
  phase text not null default 'waiting'
    check (phase in ('waiting', 'spinning', 'countdown', 'writing', 'scoring', 'done')),
  started_at timestamptz,
  ended_at timestamptz,
  unique (room_id, round_number)
);

create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  profile_id uuid not null references public.profiles(id),
  category text not null,
  value text,
  score int default 0,
  is_invalidated boolean default false,
  unique (round_id, profile_id, category)
);

create table if not exists public.round_players (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  profile_id uuid not null references public.profiles(id),
  finished_at timestamptz,
  finish_rank int,
  speed_bonus int default 0,
  objections_used int default 0,
  round_score int default 0,
  unique (round_id, profile_id)
);

create table if not exists public.objections (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null references public.answers(id) on delete cascade,
  raised_by uuid not null references public.profiles(id),
  status text not null default 'voting'
    check (status in ('voting', 'valid', 'invalid')),
  created_at timestamptz default now(),
  resolved_at timestamptz
);

create table if not exists public.objection_votes (
  id uuid primary key default gen_random_uuid(),
  objection_id uuid not null references public.objections(id) on delete cascade,
  profile_id uuid not null references public.profiles(id),
  is_valid boolean not null,
  unique (objection_id, profile_id)
);

-- ─── 2) Helper fonksiyonlar (tablolar hazır olduktan sonra) ─
create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_players
    where room_id = p_room_id and profile_id = auth.uid()
  );
$$;

create or replace function public.is_room_host(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.rooms
    where id = p_room_id and host_id = auth.uid()
  );
$$;

create or replace function public.room_player_count(p_room_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.room_players where room_id = p_room_id;
$$;

create or replace function public.next_join_order(p_room_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(max(join_order), 0) + 1
  from public.room_players
  where room_id = p_room_id;
$$;

grant execute on function public.is_room_member(uuid) to authenticated;
grant execute on function public.is_room_host(uuid) to authenticated;
grant execute on function public.room_player_count(uuid) to authenticated;
grant execute on function public.next_join_order(uuid) to authenticated;

-- ─── 3) RLS ────────────────────────────────────────────────
alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.rounds enable row level security;
alter table public.answers enable row level security;
alter table public.round_players enable row level security;
alter table public.objections enable row level security;
alter table public.objection_votes enable row level security;

-- Eski denemeden kalmış politikalar varsa temizle
drop policy if exists "rooms_select" on public.rooms;
drop policy if exists "rooms_insert" on public.rooms;
drop policy if exists "rooms_update_host" on public.rooms;
drop policy if exists "room_players_select" on public.room_players;
drop policy if exists "room_players_insert" on public.room_players;
drop policy if exists "room_players_update_own" on public.room_players;
drop policy if exists "rounds_select" on public.rounds;
drop policy if exists "rounds_insert_host" on public.rounds;
drop policy if exists "rounds_update_member" on public.rounds;
drop policy if exists "answers_select" on public.answers;
drop policy if exists "answers_insert_own" on public.answers;
drop policy if exists "answers_update_own_or_scoring" on public.answers;
drop policy if exists "round_players_select" on public.round_players;
drop policy if exists "round_players_insert" on public.round_players;
drop policy if exists "round_players_update" on public.round_players;
drop policy if exists "objections_select" on public.objections;
drop policy if exists "objections_insert" on public.objections;
drop policy if exists "objections_update" on public.objections;
drop policy if exists "objection_votes_select" on public.objection_votes;
drop policy if exists "objection_votes_insert" on public.objection_votes;

create policy "rooms_select"
  on public.rooms for select to authenticated
  using (
    status = 'lobby'
    or public.is_room_member(id)
  );

create policy "rooms_insert"
  on public.rooms for insert to authenticated
  with check (host_id = auth.uid());

create policy "rooms_update_host"
  on public.rooms for update to authenticated
  using (host_id = auth.uid())
  with check (host_id = auth.uid());

create policy "room_players_select"
  on public.room_players for select to authenticated
  using (public.is_room_member(room_id));

create policy "room_players_insert"
  on public.room_players for insert to authenticated
  with check (
    profile_id = auth.uid()
    and exists (
      select 1 from public.rooms r
      where r.id = room_id and r.status = 'lobby'
    )
    and public.room_player_count(room_id) < 8
  );

create policy "room_players_update_own"
  on public.room_players for update to authenticated
  using (
    profile_id = auth.uid()
    or public.is_room_host(room_id)
  )
  with check (
    profile_id = auth.uid()
    or public.is_room_host(room_id)
  );

create policy "rounds_select"
  on public.rounds for select to authenticated
  using (public.is_room_member(room_id));

create policy "rounds_insert_host"
  on public.rounds for insert to authenticated
  with check (public.is_room_host(room_id));

create policy "rounds_update_member"
  on public.rounds for update to authenticated
  using (public.is_room_member(room_id))
  with check (public.is_room_member(room_id));

create policy "answers_select"
  on public.answers for select to authenticated
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from public.rounds r
      where r.id = round_id
        and public.is_room_member(r.room_id)
        and r.phase in ('scoring', 'done')
    )
  );

create policy "answers_insert_own"
  on public.answers for insert to authenticated
  with check (
    profile_id = auth.uid()
    and exists (
      select 1 from public.rounds r
      where r.id = round_id
        and public.is_room_member(r.room_id)
        and r.phase in ('writing', 'scoring')
    )
  );

create policy "answers_update_own_or_scoring"
  on public.answers for update to authenticated
  using (
    (
      profile_id = auth.uid()
      and exists (
        select 1 from public.rounds r
        where r.id = round_id and public.is_room_member(r.room_id)
      )
    )
    or exists (
      select 1 from public.rounds r
      where r.id = round_id
        and public.is_room_member(r.room_id)
        and r.phase in ('scoring', 'done')
    )
  )
  with check (
    exists (
      select 1 from public.rounds r
      where r.id = round_id and public.is_room_member(r.room_id)
    )
  );

create policy "round_players_select"
  on public.round_players for select to authenticated
  using (
    exists (
      select 1 from public.rounds r
      where r.id = round_id and public.is_room_member(r.room_id)
    )
  );

create policy "round_players_insert"
  on public.round_players for insert to authenticated
  with check (
    profile_id = auth.uid()
    and exists (
      select 1 from public.rounds r
      where r.id = round_id and public.is_room_member(r.room_id)
    )
  );

create policy "round_players_update"
  on public.round_players for update to authenticated
  using (
    exists (
      select 1 from public.rounds r
      where r.id = round_id and public.is_room_member(r.room_id)
    )
  )
  with check (
    exists (
      select 1 from public.rounds r
      where r.id = round_id and public.is_room_member(r.room_id)
    )
  );

create policy "objections_select"
  on public.objections for select to authenticated
  using (
    exists (
      select 1
      from public.answers a
      join public.rounds r on r.id = a.round_id
      where a.id = answer_id and public.is_room_member(r.room_id)
    )
  );

create policy "objections_insert"
  on public.objections for insert to authenticated
  with check (
    raised_by = auth.uid()
    and exists (
      select 1
      from public.answers a
      join public.rounds r on r.id = a.round_id
      where a.id = answer_id
        and public.is_room_member(r.room_id)
        and r.phase = 'scoring'
    )
  );

create policy "objections_update"
  on public.objections for update to authenticated
  using (
    exists (
      select 1
      from public.answers a
      join public.rounds r on r.id = a.round_id
      where a.id = answer_id and public.is_room_member(r.room_id)
    )
  )
  with check (
    exists (
      select 1
      from public.answers a
      join public.rounds r on r.id = a.round_id
      where a.id = answer_id and public.is_room_member(r.room_id)
    )
  );

create policy "objection_votes_select"
  on public.objection_votes for select to authenticated
  using (
    exists (
      select 1
      from public.objections o
      join public.answers a on a.id = o.answer_id
      join public.rounds r on r.id = a.round_id
      where o.id = objection_id and public.is_room_member(r.room_id)
    )
  );

create policy "objection_votes_insert"
  on public.objection_votes for insert to authenticated
  with check (
    profile_id = auth.uid()
    and exists (
      select 1
      from public.objections o
      join public.answers a on a.id = o.answer_id
      join public.rounds r on r.id = a.round_id
      where o.id = objection_id and public.is_room_member(r.room_id)
    )
  );

-- ─── 4) Realtime ───────────────────────────────────────────
do $$
begin
  begin
    alter publication supabase_realtime add table public.rooms;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.room_players;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.rounds;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.objections;
  exception when duplicate_object then null;
  end;
end $$;
