-- XOX oyun state (3x3 şimdilik; boardSize settings'te)
create table if not exists public.xox_games (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  board text[] not null default array['','','','','','','','','']::text[],
  next_mark text not null default 'X'
    check (next_mark in ('X', 'O')),
  x_player uuid references public.profiles(id),
  o_player uuid references public.profiles(id),
  status text not null default 'playing'
    check (status in ('playing', 'won', 'draw')),
  winner_id uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.xox_games enable row level security;

drop policy if exists "xox_select_member" on public.xox_games;
drop policy if exists "xox_insert_host" on public.xox_games;
drop policy if exists "xox_update_member" on public.xox_games;

create policy "xox_select_member"
  on public.xox_games for select to authenticated
  using (public.is_room_member(room_id));

create policy "xox_insert_host"
  on public.xox_games for insert to authenticated
  with check (public.is_room_host(room_id));

create policy "xox_update_member"
  on public.xox_games for update to authenticated
  using (public.is_room_member(room_id))
  with check (public.is_room_member(room_id));

-- Atomik hamle
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
  i int;
  win boolean := false;
  lines int[][] := array[
    array[1,2,3], array[4,5,6], array[7,8,9],
    array[1,4,7], array[2,5,8], array[3,6,9],
    array[1,5,9], array[3,5,7]
  ];
  line int[];
  filled int := 0;
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli';
  end if;
  if p_cell < 0 or p_cell > 8 then
    raise exception 'Geçersiz kare';
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
  -- 1-based array in PG; cell 0..8 maps to index 1..9
  if v_board[p_cell + 1] is distinct from '' and v_board[p_cell + 1] is not null then
    raise exception 'Kare dolu';
  end if;

  v_board[p_cell + 1] := v_mark;

  foreach line slice 1 in array lines loop
    if v_board[line[1]] = v_mark
       and v_board[line[2]] = v_mark
       and v_board[line[3]] = v_mark then
      win := true;
      exit;
    end if;
  end loop;

  for i in 1..9 loop
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
  elsif filled >= 9 then
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

-- Rematch: tahtayı sıfırla (host)
create or replace function public.xox_rematch(p_room_id uuid)
returns public.xox_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.xox_games%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli';
  end if;
  if not public.is_room_host(p_room_id) then
    raise exception 'Sadece kurucu yeniden başlatabilir';
  end if;

  update public.xox_games set
    board = array['','','','','','','','','']::text[],
    next_mark = 'X',
    status = 'playing',
    winner_id = null,
    updated_at = now()
  where room_id = p_room_id
  returning * into g;

  if not found then
    raise exception 'Oyun yok';
  end if;
  return g;
end;
$$;

revoke all on function public.xox_rematch(uuid) from public;
grant execute on function public.xox_rematch(uuid) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.xox_games;
exception when duplicate_object then null;
end $$;
