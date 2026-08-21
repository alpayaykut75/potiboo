-- Toxxo: maç arası (between) + maç geçmişi şeridi

alter table public.xox_games
  add column if not exists match_history jsonb not null default '[]'::jsonb;

alter table public.xox_games
  drop constraint if exists xox_games_status_check;

alter table public.xox_games
  add constraint xox_games_status_check
    check (status in ('playing', 'won', 'draw', 'between'));

create or replace function public.xox_apply_board_result(
  p_room_id uuid,
  p_board_winner uuid,
  p_board text[],
  p_marks jsonb,
  p_move_count int
)
returns public.xox_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.xox_games%rowtype;
  v_scores jsonb;
  v_xa uuid;
  v_xb uuid;
  v_sa numeric;
  v_sb numeric;
  v_target numeric;
  v_series_winner uuid;
  v_hist jsonb;
  v_entry jsonb;
begin
  select * into g from public.xox_games where room_id = p_room_id for update;
  if not found then
    raise exception 'Oyun yok';
  end if;

  v_xa := g.x_player;
  v_xb := g.o_player;
  if v_xa is null or v_xb is null then
    raise exception 'Oyuncular eksik';
  end if;

  v_scores := coalesce(g.scores, '{}'::jsonb);
  v_sa := public.xox_score_of(v_scores, v_xa);
  v_sb := public.xox_score_of(v_scores, v_xb);

  if p_board_winner is null then
    v_sa := v_sa + 0.5;
    v_sb := v_sb + 0.5;
  elsif p_board_winner = v_xa then
    v_sa := v_sa + 1;
  elsif p_board_winner = v_xb then
    v_sb := v_sb + 1;
  else
    raise exception 'Geçersiz kazanan';
  end if;

  v_scores := jsonb_build_object(v_xa::text, v_sa, v_xb::text, v_sb);
  v_target := public.xox_series_target(g.series_length);

  v_entry := jsonb_build_object(
    'winner_id', to_jsonb(p_board_winner),
    'x_player', to_jsonb(v_xa),
    'o_player', to_jsonb(v_xb)
  );
  v_hist := coalesce(g.match_history, '[]'::jsonb) || jsonb_build_array(v_entry);

  v_series_winner := null;
  if v_sa >= v_target and v_sb < v_target then
    v_series_winner := v_xa;
  elsif v_sb >= v_target and v_sa < v_target then
    v_series_winner := v_xb;
  end if;

  -- Seri bitti → sonuç ekranı (between yok)
  if v_series_winner is not null then
    update public.xox_games set
      board = p_board,
      marks = p_marks,
      move_count = p_move_count,
      scores = v_scores,
      match_history = v_hist,
      status = 'won',
      winner_id = v_series_winner,
      updated_at = now()
    where room_id = p_room_id
    returning * into g;
    return g;
  end if;

  -- Ara geçiş: tahta kalır, X/O henüz değişmez
  update public.xox_games set
    board = p_board,
    marks = p_marks,
    move_count = p_move_count,
    scores = v_scores,
    match_history = v_hist,
    status = 'between',
    winner_id = p_board_winner,
    updated_at = now()
  where room_id = p_room_id
  returning * into g;

  return g;
end;
$$;

-- Geçişten sonraki maça (herhangi bir üye; idempotent)
create or replace function public.xox_series_continue(p_room_id uuid)
returns public.xox_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.xox_games%rowtype;
  v_size int;
  v_n int;
  v_tmp uuid;
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli';
  end if;
  if not public.is_room_member(p_room_id) then
    raise exception 'Oda üyesi değilsin';
  end if;

  select * into g from public.xox_games where room_id = p_room_id for update;
  if not found then
    raise exception 'Oyun yok';
  end if;

  if g.status <> 'between' then
    return g;
  end if;

  v_tmp := g.x_player;
  v_size := coalesce(g.board_size, 3);

  if v_size = 0 then
    update public.xox_games set
      board = array[]::text[],
      marks = '{}'::jsonb,
      move_count = 0,
      match_index = g.match_index + 1,
      x_player = g.o_player,
      o_player = v_tmp,
      next_mark = 'X',
      status = 'playing',
      winner_id = null,
      updated_at = now()
    where room_id = p_room_id
    returning * into g;
  else
    v_n := v_size * v_size;
    update public.xox_games set
      board = array_fill(''::text, array[v_n]),
      marks = '{}'::jsonb,
      move_count = 0,
      match_index = g.match_index + 1,
      x_player = g.o_player,
      o_player = v_tmp,
      next_mark = 'X',
      status = 'playing',
      winner_id = null,
      updated_at = now()
    where room_id = p_room_id
    returning * into g;
  end if;

  return g;
end;
$$;

revoke all on function public.xox_series_continue(uuid) from public;
grant execute on function public.xox_series_continue(uuid) to authenticated;

-- Rematch: geçmişi de sıfırla
create or replace function public.xox_rematch(p_room_id uuid)
returns public.xox_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.xox_games%rowtype;
  v_size int;
  v_n int;
  v_a uuid;
  v_b uuid;
  v_scores jsonb;
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli';
  end if;
  if not public.is_room_host(p_room_id) then
    raise exception 'Sadece kurucu yeniden başlatabilir';
  end if;

  select * into g from public.xox_games where room_id = p_room_id for update;
  if not found then
    raise exception 'Oyun yok';
  end if;

  v_a := g.x_player;
  v_b := g.o_player;
  if v_a is null or v_b is null then
    raise exception 'Oyuncular eksik';
  end if;

  if random() < 0.5 then
    null;
  else
    v_a := g.o_player;
    v_b := g.x_player;
  end if;

  v_scores := jsonb_build_object(v_a::text, 0, v_b::text, 0);
  v_size := coalesce(g.board_size, 3);

  if v_size = 0 then
    update public.xox_games set
      board = array[]::text[],
      marks = '{}'::jsonb,
      move_count = 0,
      match_index = 1,
      match_history = '[]'::jsonb,
      scores = v_scores,
      next_mark = 'X',
      x_player = v_a,
      o_player = v_b,
      status = 'playing',
      winner_id = null,
      updated_at = now()
    where room_id = p_room_id
    returning * into g;
  else
    v_n := v_size * v_size;
    update public.xox_games set
      board = array_fill(''::text, array[v_n]),
      marks = '{}'::jsonb,
      move_count = 0,
      match_index = 1,
      match_history = '[]'::jsonb,
      scores = v_scores,
      next_mark = 'X',
      x_player = v_a,
      o_player = v_b,
      status = 'playing',
      winner_id = null,
      updated_at = now()
    where room_id = p_room_id
    returning * into g;
  end if;

  return g;
end;
$$;

-- Turnuva: between→won da kayıt
create or replace function public.xox_games_tournament_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.status = 'won'
     and OLD.status in ('playing', 'between')
     and NEW.winner_id is not null then
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

-- Turnuva load_match: history sıfır
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
  v_x uuid;
  v_o uuid;
  v_settings jsonb;
  v_size int;
  v_win int;
  v_series int;
  v_n int;
  v_board text[];
  v_scores jsonb;
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

  select coalesce(settings, '{}'::jsonb) into v_settings
  from public.rooms where id = p_room_id;

  v_size := coalesce((v_settings ->> 'boardSize')::int, 5);
  if v_size not in (0, 3, 5) then
    v_size := 5;
  end if;
  v_win := coalesce((v_settings ->> 'winLength')::int, null);
  if v_win is null then
    v_win := case v_size when 0 then 5 when 5 then 4 else 3 end;
  end if;
  if v_win < 3 or v_win > 5 then
    v_win := case v_size when 0 then 5 when 5 then 4 else 3 end;
  end if;

  v_series := coalesce((v_settings ->> 'seriesLength')::int, 3);
  if v_series not in (1, 3, 5) then
    v_series := 3;
  end if;

  if random() < 0.5 then
    v_x := pa;
    v_o := pb;
  else
    v_x := pb;
    v_o := pa;
  end if;

  v_scores := jsonb_build_object(v_x::text, 0, v_o::text, 0);

  if v_size = 0 then
    v_board := array[]::text[];
  else
    v_n := v_size * v_size;
    v_board := array_fill(''::text, array[v_n]);
  end if;

  insert into public.xox_games as g (
    room_id, board, marks, board_size, win_length,
    next_mark, x_player, o_player, status, winner_id, updated_at,
    series_length, match_index, scores, move_count, match_history
  ) values (
    p_room_id, v_board, '{}'::jsonb, v_size, v_win,
    'X', v_x, v_o, 'playing', null, now(),
    v_series, 1, v_scores, 0, '[]'::jsonb
  )
  on conflict (room_id) do update set
    board = excluded.board,
    marks = excluded.marks,
    board_size = excluded.board_size,
    win_length = excluded.win_length,
    next_mark = 'X',
    x_player = excluded.x_player,
    o_player = excluded.o_player,
    status = 'playing',
    winner_id = null,
    series_length = excluded.series_length,
    match_index = 1,
    scores = excluded.scores,
    move_count = 0,
    match_history = '[]'::jsonb,
    updated_at = now();

  update public.xox_tournaments set
    current_match_key = p_key,
    phase = 'playing',
    updated_at = now()
  where room_id = p_room_id;
end;
$$;
