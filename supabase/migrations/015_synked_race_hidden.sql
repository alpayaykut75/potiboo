-- Synked yarış: canlı yazı yerine gizli gönder + 4 hazır olunca aç

alter table public.synked_races
  add column if not exists round int not null default 1,
  add column if not exists ready_t0a boolean not null default false,
  add column if not exists ready_t0b boolean not null default false,
  add column if not exists ready_t1a boolean not null default false,
  add column if not exists ready_t1b boolean not null default false;

create table if not exists public.synked_race_submissions (
  room_id uuid not null references public.rooms(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  round int not null,
  word text not null,
  created_at timestamptz not null default now(),
  primary key (room_id, profile_id, round)
);

alter table public.synked_race_submissions enable row level security;

drop policy if exists "synked_race_sub_select_own" on public.synked_race_submissions;
drop policy if exists "synked_race_sub_insert_own" on public.synked_race_submissions;

-- Herkes sadece kendi gizli kelimesini okur (açılınca live_* üzerinden görünür)
create policy "synked_race_sub_select_own"
  on public.synked_race_submissions for select to authenticated
  using (
    profile_id = auth.uid()
    and public.is_room_member(room_id)
  );

create policy "synked_race_sub_insert_own"
  on public.synked_race_submissions for insert to authenticated
  with check (
    profile_id = auth.uid()
    and public.is_room_member(room_id)
  );

-- DUR sonrası yarışa geçerken ready/round temizle
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
    delete from public.synked_race_submissions where room_id = p_room_id;
    update public.synked_races set
      seed2 = v_word,
      phase = 'race',
      round = 1,
      live_t0a = '',
      live_t0b = '',
      live_t1a = '',
      live_t1b = '',
      ready_t0a = false,
      ready_t0b = false,
      ready_t1a = false,
      ready_t1b = false,
      winner_team = null,
      updated_at = now()
    where room_id = p_room_id
    returning * into r;
    return r;
  end if;

  raise exception 'Şu an DUR yok';
end;
$$;

-- Eski canlı yazım RPC'sini kaldır; yerine gizli submit
drop function if exists public.synked_race_set_word(uuid, text);

create or replace function public.synked_race_submit_word(p_room_id uuid, p_word text)
returns public.synked_races
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.synked_races%rowtype;
  v_word text;
  slot text;
  w0a text;
  w0b text;
  w1a text;
  w1b text;
  match0 boolean;
  match1 boolean;
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
  if length(v_word) < 1 or length(v_word) > 40 then
    raise exception 'Geçersiz kelime';
  end if;

  if auth.uid() = r.team0_a then
    slot := 't0a';
    if r.ready_t0a then raise exception 'Zaten gönderdin'; end if;
  elsif auth.uid() = r.team0_b then
    slot := 't0b';
    if r.ready_t0b then raise exception 'Zaten gönderdin'; end if;
  elsif auth.uid() = r.team1_a then
    slot := 't1a';
    if r.ready_t1a then raise exception 'Zaten gönderdin'; end if;
  elsif auth.uid() = r.team1_b then
    slot := 't1b';
    if r.ready_t1b then raise exception 'Zaten gönderdin'; end if;
  else
    raise exception 'Oyuncu değilsin';
  end if;

  insert into public.synked_race_submissions (room_id, profile_id, round, word)
  values (p_room_id, auth.uid(), r.round, v_word)
  on conflict (room_id, profile_id, round)
  do update set word = excluded.word, created_at = now();

  if slot = 't0a' then
    update public.synked_races set ready_t0a = true, updated_at = now()
    where room_id = p_room_id returning * into r;
  elsif slot = 't0b' then
    update public.synked_races set ready_t0b = true, updated_at = now()
    where room_id = p_room_id returning * into r;
  elsif slot = 't1a' then
    update public.synked_races set ready_t1a = true, updated_at = now()
    where room_id = p_room_id returning * into r;
  else
    update public.synked_races set ready_t1b = true, updated_at = now()
    where room_id = p_room_id returning * into r;
  end if;

  -- Dördü de hazır değilse kelimeler gizli kalır
  if not (r.ready_t0a and r.ready_t0b and r.ready_t1a and r.ready_t1b) then
    return r;
  end if;

  select word into w0a from public.synked_race_submissions
    where room_id = p_room_id and profile_id = r.team0_a and round = r.round;
  select word into w0b from public.synked_race_submissions
    where room_id = p_room_id and profile_id = r.team0_b and round = r.round;
  select word into w1a from public.synked_race_submissions
    where room_id = p_room_id and profile_id = r.team1_a and round = r.round;
  select word into w1b from public.synked_race_submissions
    where room_id = p_room_id and profile_id = r.team1_b and round = r.round;

  w0a := coalesce(w0a, '');
  w0b := coalesce(w0b, '');
  w1a := coalesce(w1a, '');
  w1b := coalesce(w1b, '');

  match0 := public.synked_normalize(w0a) <> ''
    and public.synked_normalize(w0a) = public.synked_normalize(w0b);
  match1 := public.synked_normalize(w1a) <> ''
    and public.synked_normalize(w1a) = public.synked_normalize(w1b);

  if match0 and not match1 then
    update public.synked_races set
      live_t0a = w0a, live_t0b = w0b, live_t1a = w1a, live_t1b = w1b,
      phase = 'finished', winner_team = 0, updated_at = now()
    where room_id = p_room_id
    returning * into r;
    return r;
  end if;

  if match1 and not match0 then
    update public.synked_races set
      live_t0a = w0a, live_t0b = w0b, live_t1a = w1a, live_t1b = w1b,
      phase = 'finished', winner_team = 1, updated_at = now()
    where room_id = p_room_id
    returning * into r;
    return r;
  end if;

  if match0 and match1 then
    -- Aynı turda iki takım da tuttu → berabere
    update public.synked_races set
      live_t0a = w0a, live_t0b = w0b, live_t1a = w1a, live_t1b = w1b,
      phase = 'finished', winner_team = null, updated_at = now()
    where room_id = p_room_id
    returning * into r;
    return r;
  end if;

  -- Kimse tutmadı → kelimeleri göster, yeni tur
  update public.synked_races set
    live_t0a = w0a,
    live_t0b = w0b,
    live_t1a = w1a,
    live_t1b = w1b,
    ready_t0a = false,
    ready_t0b = false,
    ready_t1a = false,
    ready_t1b = false,
    round = r.round + 1,
    updated_at = now()
  where room_id = p_room_id
  returning * into r;

  return r;
end;
$$;

revoke all on function public.synked_race_submit_word(uuid, text) from public;
grant execute on function public.synked_race_submit_word(uuid, text) to authenticated;

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

  delete from public.synked_race_submissions where room_id = p_room_id;

  update public.synked_races set
    phase = 'spin1',
    seed1 = null,
    seed2 = null,
    round = 1,
    live_t0a = '',
    live_t0b = '',
    live_t1a = '',
    live_t1b = '',
    ready_t0a = false,
    ready_t0b = false,
    ready_t1a = false,
    ready_t1b = false,
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
