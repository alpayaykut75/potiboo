-- XOX: değişken tahta (3x3 / 5x5) + win_length
alter table public.xox_games
  add column if not exists board_size int not null default 3
    check (board_size in (3, 5)),
  add column if not exists win_length int not null default 3
    check (win_length >= 3 and win_length <= 5);

create or replace function public.xox_make_move(p_room_id uuid, p_cell int)
returns public.xox_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.xox_games%rowtype;
  v_mark text;
  v_board text[];
  v_size int;
  v_win int;
  v_n int;
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
  v_n := v_size * v_size;

  if p_cell < 0 or p_cell >= v_n then
    raise exception 'Geçersiz kare';
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

  v_board := g.board;
  if array_length(v_board, 1) is distinct from v_n then
    raise exception 'Tahta boyutu uyuşmuyor';
  end if;

  if v_board[p_cell + 1] is distinct from '' and v_board[p_cell + 1] is not null then
    raise exception 'Kare dolu';
  end if;

  v_board[p_cell + 1] := v_mark;
  r := p_cell / v_size;
  c := p_cell % v_size;

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

revoke all on function public.xox_make_move(uuid, int) from public;
grant execute on function public.xox_make_move(uuid, int) to authenticated;

create or replace function public.xox_rematch(p_room_id uuid)
returns public.xox_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.xox_games%rowtype;
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

  v_n := coalesce(g.board_size, 3) * coalesce(g.board_size, 3);

  update public.xox_games set
    board = array_fill(''::text, array[v_n]),
    next_mark = 'X',
    status = 'playing',
    winner_id = null,
    updated_at = now()
  where room_id = p_room_id
  returning * into g;

  return g;
end;
$$;

revoke all on function public.xox_rematch(uuid) from public;
grant execute on function public.xox_rematch(uuid) to authenticated;
