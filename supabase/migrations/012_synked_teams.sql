-- Synked 2v2 — tek seferde çalıştır (kısmen uygulanmış olsa da güvenli)

create table if not exists public.synked_matches (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  mode text not null default 'duel'
    check (mode in ('duel', 'teams')),
  status text not null default 'playing'
    check (status in ('playing', 'finished')),
  winner_team int
    check (winner_team is null or winner_team in (0, 1)),
  team0_phase text not null default 'seed',
  team1_phase text not null default 'seed',
  team0_round int not null default 0,
  team1_round int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.synked_matches enable row level security;

drop policy if exists "synked_match_select" on public.synked_matches;
drop policy if exists "synked_match_insert_host" on public.synked_matches;
drop policy if exists "synked_match_update_member" on public.synked_matches;

create policy "synked_match_select"
  on public.synked_matches for select to authenticated
  using (public.is_room_member(room_id));

create policy "synked_match_insert_host"
  on public.synked_matches for insert to authenticated
  with check (public.is_room_host(room_id));

create policy "synked_match_update_member"
  on public.synked_matches for update to authenticated
  using (public.is_room_member(room_id))
  with check (public.is_room_member(room_id));

alter table public.synked_games
  add column if not exists team_id int not null default 0;

alter table public.synked_submissions
  add column if not exists team_id int not null default 0;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'synked_games_pkey'
      and conrelid = 'public.synked_games'::regclass
  ) then
    alter table public.synked_games drop constraint synked_games_pkey;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'synked_games_pkey'
      and conrelid = 'public.synked_games'::regclass
  ) then
    alter table public.synked_games add primary key (room_id, team_id);
  end if;
end $$;

alter table public.synked_games
  drop constraint if exists synked_games_team_id_check;

alter table public.synked_games
  add constraint synked_games_team_id_check check (team_id in (0, 1));

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'synked_submissions_pkey'
      and conrelid = 'public.synked_submissions'::regclass
  ) then
    alter table public.synked_submissions drop constraint synked_submissions_pkey;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'synked_submissions_pkey'
      and conrelid = 'public.synked_submissions'::regclass
  ) then
    alter table public.synked_submissions
      add primary key (room_id, team_id, profile_id, phase, round);
  end if;
end $$;

drop policy if exists "synked_select_member" on public.synked_games;
drop policy if exists "synked_select_own_team" on public.synked_games;
create policy "synked_select_own_team"
  on public.synked_games for select to authenticated
  using (
    public.is_room_member(room_id)
    and (player_a = auth.uid() or player_b = auth.uid())
  );

drop policy if exists "synked_delete_host" on public.synked_games;
create policy "synked_delete_host"
  on public.synked_games for delete to authenticated
  using (public.is_room_host(room_id));

create or replace function public.synked_sync_match_progress(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g0 public.synked_games%rowtype;
  g1 public.synked_games%rowtype;
  m public.synked_matches%rowtype;
begin
  select * into m from public.synked_matches where room_id = p_room_id for update;
  if not found then
    return;
  end if;

  select * into g0 from public.synked_games
  where room_id = p_room_id and team_id = 0;
  select * into g1 from public.synked_games
  where room_id = p_room_id and team_id = 1;

  update public.synked_matches set
    team0_phase = coalesce(g0.phase, 'seed'),
    team0_round = coalesce(g0.round, 0),
    team1_phase = coalesce(g1.phase, 'seed'),
    team1_round = coalesce(g1.round, 0),
    updated_at = now()
  where room_id = p_room_id;
end;
$$;

create or replace function public.synked_submit_word(p_room_id uuid, p_word text)
returns public.synked_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.synked_games%rowtype;
  m public.synked_matches%rowtype;
  v_word text;
  v_norm text;
  v_other uuid;
  v_other_word text;
  v_other_norm text;
  v_is_a boolean;
  v_hist jsonb;
  wa text;
  wb text;
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli';
  end if;
  if not public.is_room_member(p_room_id) then
    raise exception 'Oda üyesi değilsin';
  end if;

  v_word := trim(both from coalesce(p_word, ''));
  if length(v_word) < 1 or length(v_word) > 40 then
    raise exception 'Kelime 1–40 karakter olmalı';
  end if;
  v_norm := public.synked_normalize(v_word);

  select * into g from public.synked_games
  where room_id = p_room_id
    and (player_a = auth.uid() or player_b = auth.uid())
  for update;

  if not found then
    raise exception 'Oyun yok';
  end if;
  if g.phase = 'won' then
    raise exception 'Takımın eşleşti';
  end if;
  if g.phase not in ('seed', 'guess') then
    raise exception 'Geçersiz faz';
  end if;

  select * into m from public.synked_matches where room_id = p_room_id;
  if found and m.mode = 'teams' and m.status = 'finished' then
    raise exception 'Maç bitti';
  end if;

  if auth.uid() = g.player_a then
    v_is_a := true;
    v_other := g.player_b;
  else
    v_is_a := false;
    v_other := g.player_a;
  end if;

  if v_is_a and g.ready_a then
    raise exception 'Zaten gönderdin';
  end if;
  if not v_is_a and g.ready_b then
    raise exception 'Zaten gönderdin';
  end if;

  insert into public.synked_submissions as s
    (room_id, team_id, profile_id, phase, round, word)
  values (p_room_id, g.team_id, auth.uid(), g.phase, g.round, v_word)
  on conflict (room_id, team_id, profile_id, phase, round)
  do update set word = excluded.word, created_at = now();

  if v_is_a then
    update public.synked_games set ready_a = true, updated_at = now()
    where room_id = p_room_id and team_id = g.team_id
    returning * into g;
  else
    update public.synked_games set ready_b = true, updated_at = now()
    where room_id = p_room_id and team_id = g.team_id
    returning * into g;
  end if;

  if not (g.ready_a and g.ready_b) then
    perform public.synked_sync_match_progress(p_room_id);
    return g;
  end if;

  select word into v_other_word
  from public.synked_submissions
  where room_id = p_room_id
    and team_id = g.team_id
    and profile_id = v_other
    and phase = g.phase
    and round = g.round;

  if v_other_word is null then
    return g;
  end if;
  v_other_norm := public.synked_normalize(v_other_word);

  if v_is_a then
    wa := v_word;
    wb := v_other_word;
  else
    wa := v_other_word;
    wb := v_word;
  end if;

  if g.phase = 'seed' then
    v_hist := coalesce(g.history, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('a', wa, 'b', wb, 'kind', 'seed')
    );
    update public.synked_games set
      phase = 'guess',
      round = 1,
      word_a = wa,
      word_b = wb,
      history = v_hist,
      ready_a = false,
      ready_b = false,
      updated_at = now()
    where room_id = p_room_id and team_id = g.team_id
    returning * into g;
    perform public.synked_sync_match_progress(p_room_id);
    return g;
  end if;

  if v_norm = v_other_norm then
    v_hist := coalesce(g.history, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('a', wa, 'b', wb, 'kind', 'match')
    );
    update public.synked_games set
      phase = 'won',
      word_a = wa,
      word_b = wb,
      history = v_hist,
      ready_a = false,
      ready_b = false,
      updated_at = now()
    where room_id = p_room_id and team_id = g.team_id
    returning * into g;

    update public.synked_matches set
      status = 'finished',
      winner_team = g.team_id,
      updated_at = now()
    where room_id = p_room_id
      and mode = 'teams'
      and status = 'playing'
      and winner_team is null;

    perform public.synked_sync_match_progress(p_room_id);
  else
    v_hist := coalesce(g.history, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('a', wa, 'b', wb, 'kind', 'guess')
    );
    update public.synked_games set
      phase = 'guess',
      round = g.round + 1,
      word_a = wa,
      word_b = wb,
      history = v_hist,
      ready_a = false,
      ready_b = false,
      updated_at = now()
    where room_id = p_room_id and team_id = g.team_id
    returning * into g;
    perform public.synked_sync_match_progress(p_room_id);
  end if;

  return g;
end;
$$;

revoke all on function public.synked_submit_word(uuid, text) from public;
grant execute on function public.synked_submit_word(uuid, text) to authenticated;

drop function if exists public.synked_rematch(uuid);

create function public.synked_rematch(p_room_id uuid)
returns public.synked_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.synked_matches%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli';
  end if;
  if not public.is_room_host(p_room_id) then
    raise exception 'Sadece kurucu yeniden başlatabilir';
  end if;

  delete from public.synked_submissions where room_id = p_room_id;

  update public.synked_games set
    phase = 'seed',
    round = 0,
    word_a = null,
    word_b = null,
    history = '[]'::jsonb,
    ready_a = false,
    ready_b = false,
    updated_at = now()
  where room_id = p_room_id;

  update public.synked_matches set
    status = 'playing',
    winner_team = null,
    team0_phase = 'seed',
    team1_phase = 'seed',
    team0_round = 0,
    team1_round = 0,
    updated_at = now()
  where room_id = p_room_id
  returning * into m;

  if not found then
    raise exception 'Maç yok';
  end if;

  return m;
end;
$$;

revoke all on function public.synked_rematch(uuid) from public;
grant execute on function public.synked_rematch(uuid) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.synked_matches;
exception when duplicate_object then null;
end $$;
