-- Sonsuz tahta (board_size = 0) + seyrek marks
-- 009 yoksa kolonları da ekle
alter table public.xox_games
  add column if not exists board_size int not null default 3;

alter table public.xox_games
  add column if not exists win_length int not null default 3;

alter table public.xox_games
  drop constraint if exists xox_games_board_size_check;

alter table public.xox_games
  drop constraint if exists xox_games_win_length_check;

alter table public.xox_games
  add constraint xox_games_board_size_check
    check (board_size in (0, 3, 5));

alter table public.xox_games
  add constraint xox_games_win_length_check
    check (win_length >= 3 and win_length <= 5);

alter table public.xox_games
  add column if not exists marks jsonb not null default '{}'::jsonb;

drop function if exists public.xox_make_move(uuid, int);

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

  -- Sonsuz mod
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
      update public.xox_games set
        marks = v_marks,
        status = 'won',
        winner_id = auth.uid(),
        updated_at = now()
      where room_id = p_room_id
      returning * into g;
    else
      update public.xox_games set
        marks = v_marks,
        next_mark = case when v_mark = 'X' then 'O' else 'X' end,
        updated_at = now()
      where room_id = p_room_id
      returning * into g;
    end if;

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
    update public.xox_games set
      board = v_board,
      status = 'won',
      winner_id = auth.uid(),
      updated_at = now()
    where room_id = p_room_id
    returning * into g;
  elsif filled >= v_n then
    update public.xox_games set
      board = v_board,
      status = 'draw',
      updated_at = now()
    where room_id = p_room_id
    returning * into g;
  else
    update public.xox_games set
      board = v_board,
      next_mark = case when v_mark = 'X' then 'O' else 'X' end,
      updated_at = now()
    where room_id = p_room_id
    returning * into g;
  end if;

  return g;
end;
$$;

revoke all on function public.xox_make_move(uuid, int, int) from public;
grant execute on function public.xox_make_move(uuid, int, int) to authenticated;

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

  v_size := coalesce(g.board_size, 3);

  if v_size = 0 then
    update public.xox_games set
      board = array[]::text[],
      marks = '{}'::jsonb,
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

revoke all on function public.xox_rematch(uuid) from public;
grant execute on function public.xox_rematch(uuid) to authenticated;
