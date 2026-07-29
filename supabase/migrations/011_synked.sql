-- Synked (Mind Match): gizli submissions + public game state (ready flags only)
create table if not exists public.synked_games (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  player_a uuid references public.profiles(id),
  player_b uuid references public.profiles(id),
  phase text not null default 'seed'
    check (phase in ('seed', 'guess', 'won')),
  round int not null default 0,
  word_a text,
  word_b text,
  history jsonb not null default '[]'::jsonb,
  ready_a boolean not null default false,
  ready_b boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.synked_submissions (
  room_id uuid not null references public.rooms(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  phase text not null check (phase in ('seed', 'guess')),
  round int not null default 0,
  word text not null,
  created_at timestamptz not null default now(),
  primary key (room_id, profile_id, phase, round)
);

alter table public.synked_games enable row level security;
alter table public.synked_submissions enable row level security;

drop policy if exists "synked_select_member" on public.synked_games;
drop policy if exists "synked_insert_host" on public.synked_games;
drop policy if exists "synked_update_member" on public.synked_games;
drop policy if exists "synked_sub_select_own" on public.synked_submissions;
drop policy if exists "synked_sub_insert_own" on public.synked_submissions;
drop policy if exists "synked_sub_update_own" on public.synked_submissions;
drop policy if exists "synked_sub_delete_own" on public.synked_submissions;

create policy "synked_select_member"
  on public.synked_games for select to authenticated
  using (public.is_room_member(room_id));

create policy "synked_insert_host"
  on public.synked_games for insert to authenticated
  with check (public.is_room_host(room_id));

create policy "synked_update_member"
  on public.synked_games for update to authenticated
  using (public.is_room_member(room_id))
  with check (public.is_room_member(room_id));

-- Kelimeler sızmasın: sadece kendi submission
create policy "synked_sub_select_own"
  on public.synked_submissions for select to authenticated
  using (profile_id = auth.uid() and public.is_room_member(room_id));

create policy "synked_sub_insert_own"
  on public.synked_submissions for insert to authenticated
  with check (profile_id = auth.uid() and public.is_room_member(room_id));

create policy "synked_sub_update_own"
  on public.synked_submissions for update to authenticated
  using (profile_id = auth.uid() and public.is_room_member(room_id))
  with check (profile_id = auth.uid() and public.is_room_member(room_id));

create policy "synked_sub_delete_own"
  on public.synked_submissions for delete to authenticated
  using (profile_id = auth.uid() and public.is_room_member(room_id));

create or replace function public.synked_normalize(p_word text)
returns text
language sql
immutable
as $$
  select lower(trim(both from coalesce(p_word, '')));
$$;

create or replace function public.synked_submit_word(p_room_id uuid, p_word text)
returns public.synked_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.synked_games%rowtype;
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

  select * into g from public.synked_games where room_id = p_room_id for update;
  if not found then
    raise exception 'Oyun yok';
  end if;
  if g.phase = 'won' then
    raise exception 'Oyun bitti';
  end if;
  if g.phase not in ('seed', 'guess') then
    raise exception 'Geçersiz faz';
  end if;

  if auth.uid() = g.player_a then
    v_is_a := true;
    v_other := g.player_b;
  elsif auth.uid() = g.player_b then
    v_is_a := false;
    v_other := g.player_a;
  else
    raise exception 'Oyuncu değilsin';
  end if;

  if v_is_a and g.ready_a then
    raise exception 'Zaten gönderdin';
  end if;
  if not v_is_a and g.ready_b then
    raise exception 'Zaten gönderdin';
  end if;

  insert into public.synked_submissions (room_id, profile_id, phase, round, word)
  values (p_room_id, auth.uid(), g.phase, g.round, v_word)
  on conflict (room_id, profile_id, phase, round)
  do update set word = excluded.word, created_at = now();

  if v_is_a then
    update public.synked_games set ready_a = true, updated_at = now()
    where room_id = p_room_id
    returning * into g;
  else
    update public.synked_games set ready_b = true, updated_at = now()
    where room_id = p_room_id
    returning * into g;
  end if;

  -- Rakip henüz hazır değil
  if not (g.ready_a and g.ready_b) then
    return g;
  end if;

  select word into v_other_word
  from public.synked_submissions
  where room_id = p_room_id
    and profile_id = v_other
    and phase = g.phase
    and round = g.round;

  if v_other_word is null then
    -- tutarsızlık: ready bayrağı var ama kelime yok
    return g;
  end if;
  v_other_norm := public.synked_normalize(v_other_word);

  -- A'nın kelimesi = v_word (şu an gönderen), B = other — ama gönderen B olabilir
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
    where room_id = p_room_id
    returning * into g;
    return g;
  end if;

  -- guess fazı
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
    where room_id = p_room_id
    returning * into g;
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
    where room_id = p_room_id
    returning * into g;
  end if;

  return g;
end;
$$;

revoke all on function public.synked_submit_word(uuid, text) from public;
grant execute on function public.synked_submit_word(uuid, text) to authenticated;

create or replace function public.synked_rematch(p_room_id uuid)
returns public.synked_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.synked_games%rowtype;
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
  where room_id = p_room_id
  returning * into g;

  if not found then
    raise exception 'Oyun yok';
  end if;
  return g;
end;
$$;

revoke all on function public.synked_rematch(uuid) from public;
grant execute on function public.synked_rematch(uuid) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.synked_games;
exception when duplicate_object then null;
end $$;
