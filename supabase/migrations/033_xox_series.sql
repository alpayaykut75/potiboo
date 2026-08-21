-- Toxxo: seri (1/3/5), X/O rotasyonu, turnuvada tahta seçimi, sonsuz hamle sınırı

alter table public.xox_games
  add column if not exists series_length int not null default 3;

alter table public.xox_games
  add column if not exists match_index int not null default 1;

alter table public.xox_games
  add column if not exists scores jsonb not null default '{}'::jsonb;

alter table public.xox_games
  add column if not exists move_count int not null default 0;

alter table public.xox_games
  drop constraint if exists xox_games_series_length_check;

alter table public.xox_games
  add constraint xox_games_series_length_check
    check (series_length in (1, 3, 5));

create or replace function public.xox_series_target(p_len int)
returns numeric
language sql
immutable
as $$
  select case p_len
    when 1 then 1::numeric
    when 3 then 2::numeric
    when 5 then 3::numeric
    else 2::numeric
  end;
$$;

create or replace function public.xox_score_of(p_scores jsonb, p_id uuid)
returns numeric
language sql
immutable
as $$
  select coalesce((p_scores ->> p_id::text)::numeric, 0);
$$;

-- Sonsuz: bir işaretin en uzun kesintisiz dizisi
create or replace function public.xox_longest_run(p_marks jsonb, p_mark text)
returns int
language plpgsql
immutable
as $$
declare
  k text;
  parts text[];
  r int;
  c int;
  dr int;
  dc int;
  nr int;
  nc int;
  cnt int;
  best int := 0;
  dirs int[][] := array[
    array[0, 1],
    array[1, 0],
    array[1, 1],
    array[1, -1]
  ];
  d int[];
begin
  if p_marks is null or p_marks = '{}'::jsonb then
    return 0;
  end if;

  for k in select jsonb_object_keys(p_marks) loop
    if (p_marks ->> k) is distinct from p_mark then
      continue;
    end if;
    parts := string_to_array(k, ',');
    if array_length(parts, 1) is distinct from 2 then
      continue;
    end if;
    r := parts[1]::int;
    c := parts[2]::int;

    foreach d slice 1 in array dirs loop
      dr := d[1];
      dc := d[2];
      cnt := 1;

      nr := r + dr;
      nc := c + dc;
      while p_marks ? (nr::text || ',' || nc::text)
        and p_marks ->> (nr::text || ',' || nc::text) = p_mark loop
        cnt := cnt + 1;
        nr := nr + dr;
        nc := nc + dc;
      end loop;

      nr := r - dr;
      nc := c - dc;
      while p_marks ? (nr::text || ',' || nc::text)
        and p_marks ->> (nr::text || ',' || nc::text) = p_mark loop
        cnt := cnt + 1;
        nr := nr - dr;
        nc := nc - dc;
      end loop;

      if cnt > best then
        best := cnt;
      end if;
    end loop;
  end loop;

  return best;
end;
$$;

-- Tahta sonucu: puanla, seri bittiysa won; değilse sonraki maça geç (X/O swap)
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
  v_size int;
  v_n int;
  v_series_winner uuid;
  v_tmp uuid;
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

  -- İkisi aynı anda hedefe ulaşırsa (ör. beraberlik) seri bitmez → ekstra maç
  v_series_winner := null;
  if v_sa >= v_target and v_sb < v_target then
    v_series_winner := v_xa;
  elsif v_sb >= v_target and v_sa < v_target then
    v_series_winner := v_xb;
  end if;

  -- Seri bitti
  if v_series_winner is not null then
    update public.xox_games set
      board = p_board,
      marks = p_marks,
      move_count = p_move_count,
      scores = v_scores,
      status = 'won',
      winner_id = v_series_winner,
      updated_at = now()
    where room_id = p_room_id
    returning * into g;
    return g;
  end if;

  -- Planlanan maçlar bitti ve hedef yok → ekstra maç (beraberlik zinciri)
  -- veya henüz seri ortası → sonraki maç
  v_size := coalesce(g.board_size, 3);
  v_tmp := g.x_player;
  -- X/O el değiştir
  if v_size = 0 then
    update public.xox_games set
      board = array[]::text[],
      marks = '{}'::jsonb,
      move_count = 0,
      scores = v_scores,
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
      scores = v_scores,
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

create or replace function public.xox_make_move(
  p_room_id uuid,
  p_row int,
  p_col int
)
returns public.xox_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.xox_games%rowtype;
  v_mark text;
  v_board text[];
  v_marks jsonb;
  v_size int;
  v_win int;
  v_n int;
  v_key text;
  r int;
  c int;
  dr int;
  dc int;
  nr int;
  nc int;
  cnt int;
  win boolean := false;
  filled int := 0;
  i int;
  v_moves int;
  v_run_x int;
  v_run_o int;
  v_limit int := 60;
  v_board_winner uuid;
  dirs int[][] := array[
    array[0, 1],
    array[1, 0],
    array[1, 1],
    array[1, -1]
  ];
  d int[];
  cell_idx int;
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
  if g.status <> 'playing' then
    raise exception 'Oyun bitti';
  end if;

  v_size := coalesce(g.board_size, 3);
  v_win := coalesce(g.win_length, 3);
  v_moves := coalesce(g.move_count, 0) + 1;

  if abs(p_row) > 40 or abs(p_col) > 40 then
    raise exception 'Tahta sınırı';
  end if;

  if g.next_mark = 'X' then
    if g.x_player is distinct from auth.uid() then
      raise exception 'Sıra sende değil';
    end if;
    v_mark := 'X';
  else
    if g.o_player is distinct from auth.uid() then
      raise exception 'Sıra sende değil';
    end if;
    v_mark := 'O';
  end if;

  -- Sonsuz
  if v_size = 0 then
    v_marks := coalesce(g.marks, '{}'::jsonb);
    v_key := p_row::text || ',' || p_col::text;
    if v_marks ? v_key then
      raise exception 'Kare dolu';
    end if;
    v_marks := v_marks || jsonb_build_object(v_key, v_mark);

    foreach d slice 1 in array dirs loop
      dr := d[1];
      dc := d[2];
      cnt := 1;
      nr := p_row + dr;
      nc := p_col + dc;
      while v_marks ? (nr::text || ',' || nc::text)
        and v_marks ->> (nr::text || ',' || nc::text) = v_mark loop
        cnt := cnt + 1;
        nr := nr + dr;
        nc := nc + dc;
      end loop;
      nr := p_row - dr;
      nc := p_col - dc;
      while v_marks ? (nr::text || ',' || nc::text)
        and v_marks ->> (nr::text || ',' || nc::text) = v_mark loop
        cnt := cnt + 1;
        nr := nr - dr;
        nc := nc - dc;
      end loop;
      if cnt >= v_win then
        win := true;
        exit;
      end if;
    end loop;

    if win then
      return public.xox_apply_board_result(
        p_room_id, auth.uid(), array[]::text[], v_marks, v_moves
      );
    end if;

    if v_moves >= v_limit then
      v_run_x := public.xox_longest_run(v_marks, 'X');
      v_run_o := public.xox_longest_run(v_marks, 'O');
      if v_run_x > v_run_o then
        v_board_winner := g.x_player;
      elsif v_run_o > v_run_x then
        v_board_winner := g.o_player;
      else
        v_board_winner := null;
      end if;
      return public.xox_apply_board_result(
        p_room_id, v_board_winner, array[]::text[], v_marks, v_moves
      );
    end if;

    update public.xox_games set
      marks = v_marks,
      move_count = v_moves,
      next_mark = case when v_mark = 'X' then 'O' else 'X' end,
      updated_at = now()
    where room_id = p_room_id
    returning * into g;
    return g;
  end if;

  -- Sabit tahta
  v_n := v_size * v_size;
  if p_row < 0 or p_row >= v_size or p_col < 0 or p_col >= v_size then
    raise exception 'Geçersiz kare';
  end if;

  cell_idx := p_row * v_size + p_col;
  v_board := g.board;
  if array_length(v_board, 1) is distinct from v_n then
    raise exception 'Tahta boyutu uyuşmuyor';
  end if;

  if v_board[cell_idx + 1] is distinct from '' and v_board[cell_idx + 1] is not null then
    raise exception 'Kare dolu';
  end if;

  v_board[cell_idx + 1] := v_mark;
  r := p_row;
  c := p_col;

  foreach d slice 1 in array dirs loop
    dr := d[1];
    dc := d[2];
    cnt := 1;
    nr := r + dr;
    nc := c + dc;
    while nr >= 0 and nr < v_size and nc >= 0 and nc < v_size
      and v_board[nr * v_size + nc + 1] = v_mark loop
      cnt := cnt + 1;
      nr := nr + dr;
      nc := nc + dc;
    end loop;
    nr := r - dr;
    nc := c - dc;
    while nr >= 0 and nr < v_size and nc >= 0 and nc < v_size
      and v_board[nr * v_size + nc + 1] = v_mark loop
      cnt := cnt + 1;
      nr := nr - dr;
      nc := nc - dc;
    end loop;
    if cnt >= v_win then
      win := true;
      exit;
    end if;
  end loop;

  for i in 1..v_n loop
    if v_board[i] is not null and v_board[i] <> '' then
      filled := filled + 1;
    end if;
  end loop;

  if win then
    return public.xox_apply_board_result(
      p_room_id, auth.uid(), v_board, '{}'::jsonb, v_moves
    );
  elsif filled >= v_n then
    return public.xox_apply_board_result(
      p_room_id, null, v_board, '{}'::jsonb, v_moves
    );
  end if;

  update public.xox_games set
    board = v_board,
    move_count = v_moves,
    next_mark = case when v_mark = 'X' then 'O' else 'X' end,
    updated_at = now()
  where room_id = p_room_id
  returning * into g;
  return g;
end;
$$;

revoke all on function public.xox_make_move(uuid, int, int) from public;
grant execute on function public.xox_make_move(uuid, int, int) to authenticated;

-- Yeniden oyna: yeni seri, rastgele X
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

  -- Rastgele kim X
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

revoke all on function public.xox_rematch(uuid) from public;
grant execute on function public.xox_rematch(uuid) to authenticated;

-- Turnuva maçı: oda ayarlarından tahta + seri, rastgele X
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
    series_length, match_index, scores, move_count
  ) values (
    p_room_id, v_board, '{}'::jsonb, v_size, v_win,
    'X', v_x, v_o, 'playing', null, now(),
    v_series, 1, v_scores, 0
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
    updated_at = now();

  update public.xox_tournaments set
    current_match_key = p_key,
    phase = 'playing',
    updated_at = now()
  where room_id = p_room_id;
end;
$$;

-- Turnuvada draw reset KALDIRILDI (seri puanlaması make_move içinde)
create or replace function public.xox_games_tournament_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  return NEW;
end;
$$;

-- Seri kazanınca (status playing→won) turnuvayı ilerlet
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
