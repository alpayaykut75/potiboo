-- XOX turnuva (4/8): iki taraflı bracket, sırayla maç, berabere = tahta sıfır

create table if not exists public.xox_tournaments (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  size int not null check (size in (4, 8)),
  phase text not null default 'intro'
    check (phase in ('intro', 'playing', 'intermission', 'finished')),
  current_match_key text,
  bracket jsonb not null default '{}'::jsonb,
  champion_id uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.xox_tournaments enable row level security;

drop policy if exists "xox_tour_select" on public.xox_tournaments;
drop policy if exists "xox_tour_insert_host" on public.xox_tournaments;
drop policy if exists "xox_tour_update_member" on public.xox_tournaments;

create policy "xox_tour_select"
  on public.xox_tournaments for select to authenticated
  using (public.is_room_member(room_id));

create policy "xox_tour_insert_host"
  on public.xox_tournaments for insert to authenticated
  with check (public.is_room_host(room_id));

create policy "xox_tour_update_member"
  on public.xox_tournaments for update to authenticated
  using (public.is_room_member(room_id))
  with check (public.is_room_member(room_id));

drop policy if exists "xox_tour_delete_host" on public.xox_tournaments;
create policy "xox_tour_delete_host"
  on public.xox_tournaments for delete to authenticated
  using (public.is_room_host(room_id));

-- Bracket üretici
create or replace function public.xox_build_bracket(p_players uuid[], p_size int)
returns jsonb
language plpgsql
immutable
as $$
declare
  b jsonb := '{}'::jsonb;
  ord text[];
begin
  if p_size = 4 then
    if array_length(p_players, 1) is distinct from 4 then
      raise exception '4 oyuncu gerekli';
    end if;
    ord := array['LSF', 'RSF', 'F'];
    b := jsonb_build_object(
      'order', to_jsonb(ord),
      'matches', jsonb_build_object(
        'LSF', jsonb_build_object(
          'key', 'LSF', 'side', 'left', 'round', 'sf',
          'player_a', p_players[1], 'player_b', p_players[2],
          'winner', null, 'feeds', 'F', 'feed_slot', 'a'
        ),
        'RSF', jsonb_build_object(
          'key', 'RSF', 'side', 'right', 'round', 'sf',
          'player_a', p_players[3], 'player_b', p_players[4],
          'winner', null, 'feeds', 'F', 'feed_slot', 'b'
        ),
        'F', jsonb_build_object(
          'key', 'F', 'side', 'center', 'round', 'final',
          'player_a', null, 'player_b', null,
          'winner', null, 'feeds', null, 'feed_slot', null
        )
      )
    );
  elsif p_size = 8 then
    if array_length(p_players, 1) is distinct from 8 then
      raise exception '8 oyuncu gerekli';
    end if;
    ord := array['LQF1', 'LQF2', 'RQF1', 'RQF2', 'LSF', 'RSF', 'F'];
    b := jsonb_build_object(
      'order', to_jsonb(ord),
      'matches', jsonb_build_object(
        'LQF1', jsonb_build_object(
          'key', 'LQF1', 'side', 'left', 'round', 'qf',
          'player_a', p_players[1], 'player_b', p_players[2],
          'winner', null, 'feeds', 'LSF', 'feed_slot', 'a'
        ),
        'LQF2', jsonb_build_object(
          'key', 'LQF2', 'side', 'left', 'round', 'qf',
          'player_a', p_players[3], 'player_b', p_players[4],
          'winner', null, 'feeds', 'LSF', 'feed_slot', 'b'
        ),
        'RQF1', jsonb_build_object(
          'key', 'RQF1', 'side', 'right', 'round', 'qf',
          'player_a', p_players[5], 'player_b', p_players[6],
          'winner', null, 'feeds', 'RSF', 'feed_slot', 'a'
        ),
        'RQF2', jsonb_build_object(
          'key', 'RQF2', 'side', 'right', 'round', 'qf',
          'player_a', p_players[7], 'player_b', p_players[8],
          'winner', null, 'feeds', 'RSF', 'feed_slot', 'b'
        ),
        'LSF', jsonb_build_object(
          'key', 'LSF', 'side', 'left', 'round', 'sf',
          'player_a', null, 'player_b', null,
          'winner', null, 'feeds', 'F', 'feed_slot', 'a'
        ),
        'RSF', jsonb_build_object(
          'key', 'RSF', 'side', 'right', 'round', 'sf',
          'player_a', null, 'player_b', null,
          'winner', null, 'feeds', 'F', 'feed_slot', 'b'
        ),
        'F', jsonb_build_object(
          'key', 'F', 'side', 'center', 'round', 'final',
          'player_a', null, 'player_b', null,
          'winner', null, 'feeds', null, 'feed_slot', null
        )
      )
    );
  else
    raise exception 'Geçersiz turnuva boyutu';
  end if;
  return b;
end;
$$;

create or replace function public.xox_tournament_load_match(p_room_id uuid, p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.xox_tournaments%rowtype;
  m jsonb;
  pa uuid;
  pb uuid;
begin
  select * into t from public.xox_tournaments where room_id = p_room_id for update;
  if not found then
    raise exception 'Turnuva yok';
  end if;

  m := t.bracket -> 'matches' -> p_key;
  if m is null then
    raise exception 'Maç yok';
  end if;

  pa := nullif(m ->> 'player_a', '')::uuid;
  pb := nullif(m ->> 'player_b', '')::uuid;
  if pa is null or pb is null then
    raise exception 'Maç oyuncuları henüz hazır değil';
  end if;

  insert into public.xox_games as g (
    room_id, board, marks, board_size, win_length,
    next_mark, x_player, o_player, status, winner_id, updated_at
  ) values (
    p_room_id,
    array_fill(''::text, array[9]),
    '{}'::jsonb,
    3, 3,
    'X', pa, pb, 'playing', null, now()
  )
  on conflict (room_id) do update set
    board = excluded.board,
    marks = excluded.marks,
    board_size = 3,
    win_length = 3,
    next_mark = 'X',
    x_player = excluded.x_player,
    o_player = excluded.o_player,
    status = 'playing',
    winner_id = null,
    updated_at = now();

  update public.xox_tournaments set
    current_match_key = p_key,
    phase = 'playing',
    updated_at = now()
  where room_id = p_room_id;
end;
$$;

create or replace function public.xox_tournament_start(p_room_id uuid)
returns public.xox_tournaments
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.xox_tournaments%rowtype;
  ids uuid[];
  n int;
  b jsonb;
  first_key text;
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli';
  end if;
  if not public.is_room_host(p_room_id) then
    raise exception 'Sadece kurucu başlatabilir';
  end if;

  select array_agg(profile_id order by join_order)
  into ids
  from public.room_players
  where room_id = p_room_id;

  n := coalesce(array_length(ids, 1), 0);
  if n not in (4, 8) then
    raise exception 'Turnuva için 4 veya 8 oyuncu gerekli';
  end if;

  b := public.xox_build_bracket(ids, n);
  first_key := b -> 'order' ->> 0;

  insert into public.xox_tournaments as xt (
    room_id, size, phase, current_match_key, bracket, champion_id, updated_at
  ) values (
    p_room_id, n, 'intro', first_key, b, null, now()
  )
  on conflict (room_id) do update set
    size = excluded.size,
    phase = 'intro',
    current_match_key = excluded.current_match_key,
    bracket = excluded.bracket,
    champion_id = null,
    updated_at = now()
  returning * into t;

  return t;
end;
$$;

revoke all on function public.xox_tournament_start(uuid) from public;
grant execute on function public.xox_tournament_start(uuid) to authenticated;

create or replace function public.xox_tournament_continue(p_room_id uuid)
returns public.xox_tournaments
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.xox_tournaments%rowtype;
  key text;
  m jsonb;
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli';
  end if;
  if not public.is_room_member(p_room_id) then
    raise exception 'Oda üyesi değilsin';
  end if;

  select * into t from public.xox_tournaments where room_id = p_room_id for update;
  if not found then
    raise exception 'Turnuva yok';
  end if;
  if t.phase = 'finished' then
    raise exception 'Turnuva bitti';
  end if;
  if t.phase not in ('intro', 'intermission') then
    raise exception 'Şu an devam edilemez';
  end if;

  key := t.current_match_key;
  if key is null then
    raise exception 'Sonraki maç yok';
  end if;

  m := t.bracket -> 'matches' -> key;
  if (m ->> 'winner') is not null then
    raise exception 'Bu maç zaten bitti';
  end if;

  perform public.xox_tournament_load_match(p_room_id, key);

  select * into t from public.xox_tournaments where room_id = p_room_id;
  return t;
end;
$$;

revoke all on function public.xox_tournament_continue(uuid) from public;
grant execute on function public.xox_tournament_continue(uuid) to authenticated;

create or replace function public.xox_tournament_record_win(p_room_id uuid, p_winner uuid)
returns public.xox_tournaments
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.xox_tournaments%rowtype;
  key text;
  m jsonb;
  feeds text;
  feed_slot text;
  parent jsonb;
  ord jsonb;
  i int;
  next_key text;
  found_next boolean := false;
begin
  select * into t from public.xox_tournaments where room_id = p_room_id for update;
  if not found then
    return null;
  end if;
  if t.phase <> 'playing' then
    return t;
  end if;

  key := t.current_match_key;
  m := t.bracket -> 'matches' -> key;
  if m is null then
    return t;
  end if;

  -- Kazananı yaz
  m := m || jsonb_build_object('winner', p_winner);
  t.bracket := jsonb_set(t.bracket, array['matches', key], m, true);

  feeds := m ->> 'feeds';
  feed_slot := m ->> 'feed_slot';
  if feeds is not null then
    parent := t.bracket -> 'matches' -> feeds;
    if feed_slot = 'a' then
      parent := parent || jsonb_build_object('player_a', p_winner);
    else
      parent := parent || jsonb_build_object('player_b', p_winner);
    end if;
    t.bracket := jsonb_set(t.bracket, array['matches', feeds], parent, true);
  end if;

  -- Final mi?
  if key = 'F' then
    update public.xox_tournaments set
      bracket = t.bracket,
      phase = 'finished',
      champion_id = p_winner,
      updated_at = now()
    where room_id = p_room_id
    returning * into t;
    return t;
  end if;

  -- Sonraki oynanmamış maç
  ord := t.bracket -> 'order';
  for i in 0 .. jsonb_array_length(ord) - 1 loop
    next_key := ord ->> i;
    m := t.bracket -> 'matches' -> next_key;
    if (m ->> 'winner') is null
       and nullif(m ->> 'player_a', '') is not null
       and nullif(m ->> 'player_b', '') is not null then
      found_next := true;
      exit;
    end if;
  end loop;

  if found_next then
    update public.xox_tournaments set
      bracket = t.bracket,
      phase = 'intermission',
      current_match_key = next_key,
      updated_at = now()
    where room_id = p_room_id
    returning * into t;
  else
    update public.xox_tournaments set
      bracket = t.bracket,
      phase = 'intermission',
      updated_at = now()
    where room_id = p_room_id
    returning * into t;
  end if;

  return t;
end;
$$;

-- make_move: turnuvada draw→sıfırla, won→record_win
-- Mevcut fonksiyonu recreate: sadece bitiş dallarını saracağız via wrapper trigger BEFORE UPDATE

create or replace function public.xox_games_tournament_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.xox_tournaments%rowtype;
begin
  select * into t from public.xox_tournaments
  where room_id = NEW.room_id
    and phase in ('playing', 'intro', 'intermission', 'finished');

  if not found then
    return NEW;
  end if;

  -- Turnuvada berabere olmaz
  if NEW.status = 'draw' and OLD.status = 'playing' then
    NEW.status := 'playing';
    NEW.winner_id := null;
    NEW.next_mark := 'X';
    NEW.marks := '{}'::jsonb;
    if coalesce(NEW.board_size, 3) = 0 then
      NEW.board := array[]::text[];
    else
      NEW.board := array_fill(''::text, array[coalesce(NEW.board_size, 3) * coalesce(NEW.board_size, 3)]);
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists xox_games_tournament_before_update on public.xox_games;
create trigger xox_games_tournament_before_update
  before update on public.xox_games
  for each row
  execute procedure public.xox_games_tournament_before_update();

create or replace function public.xox_games_tournament_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.status = 'won' and OLD.status = 'playing' and NEW.winner_id is not null then
    if exists (
      select 1 from public.xox_tournaments
      where room_id = NEW.room_id and phase = 'playing'
    ) then
      perform public.xox_tournament_record_win(NEW.room_id, NEW.winner_id);
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists xox_games_tournament_after_update on public.xox_games;
create trigger xox_games_tournament_after_update
  after update on public.xox_games
  for each row
  execute procedure public.xox_games_tournament_after_update();

do $$
begin
  alter publication supabase_realtime add table public.xox_tournaments;
exception when duplicate_object then null;
end $$;
