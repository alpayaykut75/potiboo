-- Synked 4p yarış: ortak tohum (DUR) + split ekran yarışı

create table if not exists public.synked_races (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  phase text not null default 'spin1'
    check (phase in ('spin1', 'spin2', 'race', 'finished')),
  seed1 text,
  seed2 text,
  team0_a uuid references public.profiles(id),
  team0_b uuid references public.profiles(id),
  team1_a uuid references public.profiles(id),
  team1_b uuid references public.profiles(id),
  live_t0a text not null default '',
  live_t0b text not null default '',
  live_t1a text not null default '',
  live_t1b text not null default '',
  winner_team int check (winner_team is null or winner_team in (0, 1)),
  updated_at timestamptz not null default now()
);

alter table public.synked_races enable row level security;

drop policy if exists "synked_race_select" on public.synked_races;
drop policy if exists "synked_race_insert_host" on public.synked_races;
drop policy if exists "synked_race_update_member" on public.synked_races;
drop policy if exists "synked_race_delete_host" on public.synked_races;

create policy "synked_race_select"
  on public.synked_races for select to authenticated
  using (public.is_room_member(room_id));

create policy "synked_race_insert_host"
  on public.synked_races for insert to authenticated
  with check (public.is_room_host(room_id));

create policy "synked_race_update_member"
  on public.synked_races for update to authenticated
  using (public.is_room_member(room_id))
  with check (public.is_room_member(room_id));

create policy "synked_race_delete_host"
  on public.synked_races for delete to authenticated
  using (public.is_room_host(room_id));

create or replace function public.synked_normalize(p_word text)
returns text
language sql
immutable
as $$
  select lower(trim(both from coalesce(p_word, '')));
$$;

create or replace function public.synked_race_stop(p_room_id uuid, p_word text)
returns public.synked_races
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.synked_races%rowtype;
  v_word text;
  v_norm text;
  on_t0 boolean;
  on_t1 boolean;
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli';
  end if;
  if not public.is_room_member(p_room_id) then
    raise exception 'Oda üyesi değilsin';
  end if;

  v_word := trim(both from coalesce(p_word, ''));
  if length(v_word) < 2 or length(v_word) > 30 then
    raise exception 'Geçersiz kelime';
  end if;
  v_norm := public.synked_normalize(v_word);

  select * into r from public.synked_races where room_id = p_room_id for update;
  if not found then
    raise exception 'Yarış yok';
  end if;

  on_t0 := auth.uid() in (r.team0_a, r.team0_b);
  on_t1 := auth.uid() in (r.team1_a, r.team1_b);

  if r.phase = 'spin1' then
    if not on_t0 then
      raise exception 'İlk kelimeyi Takım A durdurur';
    end if;
    update public.synked_races set
      seed1 = v_word,
      phase = 'spin2',
      updated_at = now()
    where room_id = p_room_id
    returning * into r;
    return r;
  end if;

  if r.phase = 'spin2' then
    if not on_t1 then
      raise exception 'İkinci kelimeyi Takım B durdurur';
    end if;
    if public.synked_normalize(coalesce(r.seed1, '')) = v_norm then
      raise exception 'Aynı kelime olamaz';
    end if;
    update public.synked_races set
      seed2 = v_word,
      phase = 'race',
      live_t0a = '',
      live_t0b = '',
      live_t1a = '',
      live_t1b = '',
      updated_at = now()
    where room_id = p_room_id
    returning * into r;
    return r;
  end if;

  raise exception 'Şu an DUR yok';
end;
$$;

revoke all on function public.synked_race_stop(uuid, text) from public;
grant execute on function public.synked_race_stop(uuid, text) to authenticated;

create or replace function public.synked_race_set_word(p_room_id uuid, p_word text)
returns public.synked_races
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.synked_races%rowtype;
  v_word text;
  v_norm text;
  slot text;
  w0a text;
  w0b text;
  w1a text;
  w1b text;
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli';
  end if;

  select * into r from public.synked_races where room_id = p_room_id for update;
  if not found then
    raise exception 'Yarış yok';
  end if;
  if r.phase <> 'race' then
    raise exception 'Yarış başlamadı';
  end if;

  v_word := trim(both from coalesce(p_word, ''));
  if length(v_word) > 40 then
    raise exception 'Kelime çok uzun';
  end if;
  v_norm := public.synked_normalize(v_word);

  if auth.uid() = r.team0_a then slot := 't0a';
  elsif auth.uid() = r.team0_b then slot := 't0b';
  elsif auth.uid() = r.team1_a then slot := 't1a';
  elsif auth.uid() = r.team1_b then slot := 't1b';
  else
    raise exception 'Oyuncu değilsin';
  end if;

  w0a := r.live_t0a;
  w0b := r.live_t0b;
  w1a := r.live_t1a;
  w1b := r.live_t1b;

  if slot = 't0a' then w0a := v_word;
  elsif slot = 't0b' then w0b := v_word;
  elsif slot = 't1a' then w1a := v_word;
  else w1b := v_word;
  end if;

  -- Takım içi eşleşme?
  if length(v_norm) >= 1
     and public.synked_normalize(w0a) = public.synked_normalize(w0b)
     and public.synked_normalize(w0a) <> '' then
    update public.synked_races set
      live_t0a = w0a, live_t0b = w0b, live_t1a = w1a, live_t1b = w1b,
      phase = 'finished', winner_team = 0, updated_at = now()
    where room_id = p_room_id
    returning * into r;
    return r;
  end if;

  if length(v_norm) >= 1
     and public.synked_normalize(w1a) = public.synked_normalize(w1b)
     and public.synked_normalize(w1a) <> '' then
    update public.synked_races set
      live_t0a = w0a, live_t0b = w0b, live_t1a = w1a, live_t1b = w1b,
      phase = 'finished', winner_team = 1, updated_at = now()
    where room_id = p_room_id
    returning * into r;
    return r;
  end if;

  update public.synked_races set
    live_t0a = w0a, live_t0b = w0b, live_t1a = w1a, live_t1b = w1b,
    updated_at = now()
  where room_id = p_room_id
  returning * into r;

  return r;
end;
$$;

revoke all on function public.synked_race_set_word(uuid, text) from public;
grant execute on function public.synked_race_set_word(uuid, text) to authenticated;

create or replace function public.synked_race_rematch(p_room_id uuid)
returns public.synked_races
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.synked_races%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli';
  end if;
  if not public.is_room_host(p_room_id) then
    raise exception 'Sadece kurucu yeniden başlatabilir';
  end if;

  update public.synked_races set
    phase = 'spin1',
    seed1 = null,
    seed2 = null,
    live_t0a = '',
    live_t0b = '',
    live_t1a = '',
    live_t1b = '',
    winner_team = null,
    updated_at = now()
  where room_id = p_room_id
  returning * into r;

  if not found then
    raise exception 'Yarış yok';
  end if;
  return r;
end;
$$;

revoke all on function public.synked_race_rematch(uuid) from public;
grant execute on function public.synked_race_rematch(uuid) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.synked_races;
exception when duplicate_object then null;
end $$;
