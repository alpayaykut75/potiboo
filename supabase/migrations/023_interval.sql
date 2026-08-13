-- Interval: 1–10 × 5 renk taş, aralıkta çek, puan (para yok)

alter table public.rooms drop constraint if exists rooms_game_type_check;
alter table public.rooms
  add constraint rooms_game_type_check
  check (game_type in (
    'isim_sehir',
    'xox',
    'synked',
    'wordle',
    'amiral',
    'tabu',
    'kizma_birader',
    'onluk',
    'interval'
  ));

create table if not exists public.interval_games (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  seats uuid[] not null default '{}',
  banks jsonb not null default '{}'::jsonb,
  pot int not null default 0 check (pot >= 0),
  phase text not null default 'turn'
    check (phase in ('turn', 'reveal', 'hand_end', 'match_end')),
  turn_profile_id uuid references public.profiles(id),
  turn_index int not null default 0,
  hand_index int not null default 0,
  hand_total int not null default 5 check (hand_total in (3, 5, 10)),
  last_event jsonb,
  winner_id uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

-- Deste: istemci SELECT yok (yalnızca security definer)
create table if not exists public.interval_secrets (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  deck jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- El: yalnız kendi satırı okunur
create table if not exists public.interval_hands (
  room_id uuid not null references public.rooms(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  c1 jsonb not null,
  c2 jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (room_id, profile_id)
);

alter table public.interval_games enable row level security;
alter table public.interval_secrets enable row level security;
alter table public.interval_hands enable row level security;

drop policy if exists "interval_select_member" on public.interval_games;
drop policy if exists "interval_hand_select_own" on public.interval_hands;

create policy "interval_select_member"
  on public.interval_games for select to authenticated
  using (public.is_room_member(room_id));

create policy "interval_hand_select_own"
  on public.interval_hands for select to authenticated
  using (profile_id = auth.uid() and public.is_room_member(room_id));

-- secrets: politika yok → authenticated erişemez

do $$
begin
  alter publication supabase_realtime add table public.interval_games;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.interval_hands;
exception
  when duplicate_object then null;
end $$;

create or replace function public.interval_hand_total(p_room_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  select nullif(settings->>'roundCount', '')::int
  into v_n
  from public.rooms
  where id = p_room_id;

  if v_n in (3, 5, 10) then
    return v_n;
  end if;
  return 5;
exception
  when others then
    return 5;
end;
$$;

create or replace function public.interval_build_deck()
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object('value', v, 'color', c)
    order by c, v
  ), '[]'::jsonb)
  from (
    values ('cyan'), ('green'), ('red'), ('gold'), ('purple')
  ) as colors(c)
  cross join generate_series(1, 10) as g(v);
$$;

create or replace function public.interval_shuffle(p_deck jsonb)
returns jsonb
language sql
volatile
as $$
  select coalesce(jsonb_agg(tile order by random()), '[]'::jsonb)
  from jsonb_array_elements(p_deck) as t(tile);
$$;

create or replace function public.interval_draw_n(p_room_id uuid, p_n int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deck jsonb;
  v_out jsonb := '[]'::jsonb;
  v_i int;
  v_tile jsonb;
begin
  if p_n < 1 then
    return '[]'::jsonb;
  end if;

  select deck into v_deck
  from public.interval_secrets
  where room_id = p_room_id
  for update;

  if v_deck is null then
    raise exception 'Deste yok';
  end if;

  if jsonb_array_length(v_deck) < p_n then
    v_deck := public.interval_shuffle(public.interval_build_deck());
  end if;

  for v_i in 1..p_n loop
    v_tile := v_deck->0;
    v_out := v_out || jsonb_build_array(v_tile);
    v_deck := v_deck - 0;
  end loop;

  update public.interval_secrets
  set deck = v_deck, updated_at = now()
  where room_id = p_room_id;

  return v_out;
end;
$$;

create or replace function public.interval_apply_ante(p_banks jsonb, p_seats uuid[], p_pot int)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_banks jsonb := coalesce(p_banks, '{}'::jsonb);
  v_pot int := coalesce(p_pot, 0);
  v_id uuid;
  v_bank int;
  v_pay int;
begin
  foreach v_id in array p_seats loop
    v_bank := coalesce((v_banks->>v_id::text)::int, 0);
    v_pay := least(10, greatest(0, v_bank));
    v_banks := jsonb_set(v_banks, array[v_id::text], to_jsonb(v_bank - v_pay));
    v_pot := v_pot + v_pay;
  end loop;
  return jsonb_build_object('banks', v_banks, 'pot', v_pot);
end;
$$;

create or replace function public.interval_finish_match(p_room_id uuid)
returns public.interval_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.interval_games%rowtype;
  v_burn int;
  v_best int := -1;
  v_winner uuid;
  v_id uuid;
  v_bank int;
  v_ties int := 0;
begin
  select * into g from public.interval_games where room_id = p_room_id for update;
  if not found then
    raise exception 'Oyun yok';
  end if;

  v_burn := g.pot;

  foreach v_id in array g.seats loop
    v_bank := coalesce((g.banks->>v_id::text)::int, 0);
    if v_bank > v_best then
      v_best := v_bank;
      v_winner := v_id;
      v_ties := 1;
    elsif v_bank = v_best then
      v_ties := v_ties + 1;
    end if;
  end loop;

  if v_ties <> 1 then
    v_winner := null;
  end if;

  update public.interval_games set
    pot = 0,
    phase = 'match_end',
    turn_profile_id = null,
    winner_id = v_winner,
    last_event = jsonb_build_object('kind', 'burn', 'pot', v_burn),
    updated_at = now()
  where room_id = p_room_id
  returning * into g;

  update public.rooms set status = 'finished' where id = p_room_id;

  delete from public.interval_hands where room_id = p_room_id;

  return g;
end;
$$;

create or replace function public.interval_deal_hand(p_room_id uuid)
returns public.interval_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.interval_games%rowtype;
  v_ante jsonb;
  v_drawn jsonb;
  v_id uuid;
  v_i int := 0;
  v_n int;
  v_c1 jsonb;
  v_c2 jsonb;
begin
  select * into g from public.interval_games where room_id = p_room_id for update;
  if not found then
    raise exception 'Oyun yok';
  end if;

  v_ante := public.interval_apply_ante(g.banks, g.seats, g.pot);
  g.banks := v_ante->'banks';
  g.pot := (v_ante->>'pot')::int;

  delete from public.interval_hands where room_id = p_room_id;

  v_n := coalesce(array_length(g.seats, 1), 0);
  v_drawn := public.interval_draw_n(p_room_id, v_n * 2);

  foreach v_id in array g.seats loop
    v_c1 := v_drawn->v_i;
    v_c2 := v_drawn->(v_i + 1);
    v_i := v_i + 2;
    insert into public.interval_hands (room_id, profile_id, c1, c2)
    values (p_room_id, v_id, v_c1, v_c2);
  end loop;

  update public.interval_games set
    banks = g.banks,
    pot = g.pot,
    phase = 'turn',
    turn_index = 0,
    turn_profile_id = g.seats[1],
    hand_index = g.hand_index + 1,
    last_event = null,
    winner_id = null,
    updated_at = now()
  where room_id = p_room_id
  returning * into g;

  update public.rooms
  set status = 'playing', current_round = g.hand_index
  where id = p_room_id;

  return g;
end;
$$;

create or replace function public.interval_advance(p_room_id uuid)
returns public.interval_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.interval_games%rowtype;
  v_next int;
  v_len int;
begin
  select * into g from public.interval_games where room_id = p_room_id for update;
  if not found then
    raise exception 'Oyun yok';
  end if;

  v_len := coalesce(array_length(g.seats, 1), 0);
  v_next := g.turn_index + 1;

  if v_next >= v_len then
    if g.hand_index >= g.hand_total then
      return public.interval_finish_match(p_room_id);
    end if;

    update public.interval_games set
      phase = 'hand_end',
      turn_profile_id = null,
      last_event = jsonb_build_object(
        'kind', 'hand_end',
        'pot', g.pot,
        'hand', g.hand_index
      ),
      updated_at = now()
    where room_id = p_room_id
    returning * into g;
    return g;
  end if;

  update public.interval_games set
    phase = 'turn',
    turn_index = v_next,
    turn_profile_id = g.seats[v_next + 1],
    updated_at = now()
  where room_id = p_room_id
  returning * into g;

  return g;
end;
$$;

create or replace function public.interval_start(p_room_id uuid)
returns public.interval_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.interval_games%rowtype;
  v_seats uuid[];
  v_banks jsonb := '{}'::jsonb;
  v_id uuid;
  v_total int;
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli';
  end if;
  if not public.is_room_host(p_room_id) then
    raise exception 'Sadece kurucu';
  end if;

  select array_agg(profile_id order by join_order)
  into v_seats
  from public.room_players
  where room_id = p_room_id;

  if v_seats is null or coalesce(array_length(v_seats, 1), 0) < 2
     or coalesce(array_length(v_seats, 1), 0) > 8 then
    raise exception 'Interval için 2–8 oyuncu gerekli';
  end if;

  foreach v_id in array v_seats loop
    v_banks := jsonb_set(v_banks, array[v_id::text], '100'::jsonb);
  end loop;

  v_total := public.interval_hand_total(p_room_id);

  insert into public.interval_secrets (room_id, deck)
  values (p_room_id, public.interval_shuffle(public.interval_build_deck()))
  on conflict (room_id) do update
  set deck = excluded.deck, updated_at = now();

  insert into public.interval_games (
    room_id, seats, banks, pot, phase, turn_profile_id, turn_index,
    hand_index, hand_total, last_event, winner_id
  ) values (
    p_room_id, v_seats, v_banks, 0, 'turn', null, 0,
    0, v_total, null, null
  )
  on conflict (room_id) do update set
    seats = excluded.seats,
    banks = excluded.banks,
    pot = 0,
    phase = 'turn',
    turn_profile_id = null,
    turn_index = 0,
    hand_index = 0,
    hand_total = excluded.hand_total,
    last_event = null,
    winner_id = null,
    updated_at = now();

  update public.rooms
  set status = 'playing', current_round = 1
  where id = p_room_id;

  return public.interval_deal_hand(p_room_id);
end;
$$;

create or replace function public.interval_pass(p_room_id uuid)
returns public.interval_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.interval_games%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli';
  end if;
  if not public.is_room_member(p_room_id) then
    raise exception 'Oda üyesi değilsin';
  end if;

  select * into g from public.interval_games where room_id = p_room_id for update;
  if not found then
    raise exception 'Oyun yok';
  end if;
  if g.phase <> 'turn' then
    raise exception 'Sıra fazında değil';
  end if;
  if g.turn_profile_id is distinct from auth.uid() then
    raise exception 'Sıra sende değil';
  end if;

  update public.interval_games set
    last_event = jsonb_build_object('kind', 'pass', 'by', auth.uid()),
    updated_at = now()
  where room_id = p_room_id;

  return public.interval_advance(p_room_id);
end;
$$;

create or replace function public.interval_bet(p_room_id uuid, p_amount int)
returns public.interval_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.interval_games%rowtype;
  h public.interval_hands%rowtype;
  v_lo int;
  v_hi int;
  v_bank int;
  v_max int;
  v_drawn jsonb;
  v_tile jsonb;
  v_val int;
  v_payout int;
  v_pot int;
  v_banks jsonb;
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli';
  end if;
  if not public.is_room_member(p_room_id) then
    raise exception 'Oda üyesi değilsin';
  end if;

  select * into g from public.interval_games where room_id = p_room_id for update;
  if not found then
    raise exception 'Oyun yok';
  end if;
  if g.phase <> 'turn' then
    raise exception 'Sıra fazında değil';
  end if;
  if g.turn_profile_id is distinct from auth.uid() then
    raise exception 'Sıra sende değil';
  end if;

  select * into h
  from public.interval_hands
  where room_id = p_room_id and profile_id = auth.uid();
  if not found then
    raise exception 'El yok';
  end if;

  v_lo := least((h.c1->>'value')::int, (h.c2->>'value')::int);
  v_hi := greatest((h.c1->>'value')::int, (h.c2->>'value')::int);
  if v_hi - v_lo <= 1 then
    raise exception 'Aralık yok — sadece pas';
  end if;

  v_bank := coalesce((g.banks->>auth.uid()::text)::int, 0);
  v_max := least(g.pot, v_bank);
  if p_amount is null or p_amount < 1 or p_amount > v_max then
    raise exception 'Geçersiz miktar';
  end if;

  v_drawn := public.interval_draw_n(p_room_id, 1);
  v_tile := v_drawn->0;
  v_val := (v_tile->>'value')::int;

  v_banks := g.banks;
  v_banks := jsonb_set(v_banks, array[auth.uid()::text], to_jsonb(v_bank - p_amount));
  v_pot := g.pot + p_amount;

  if v_val > v_lo and v_val < v_hi then
    v_payout := p_amount * 2;
    if v_payout > v_pot then
      raise exception 'Orta yetersiz';
    end if;
    v_pot := v_pot - v_payout;
    v_banks := jsonb_set(
      v_banks,
      array[auth.uid()::text],
      to_jsonb(coalesce((v_banks->>auth.uid()::text)::int, 0) + v_payout)
    );

    update public.interval_games set
      banks = v_banks,
      pot = v_pot,
      phase = 'reveal',
      last_event = jsonb_build_object(
        'kind', 'hit',
        'by', auth.uid(),
        'stake', p_amount,
        'drawn', v_tile,
        'lo', v_lo,
        'hi', v_hi,
        'payout', v_payout
      ),
      updated_at = now()
    where room_id = p_room_id
    returning * into g;
  else
    update public.interval_games set
      banks = v_banks,
      pot = v_pot,
      phase = 'reveal',
      last_event = jsonb_build_object(
        'kind', 'miss',
        'by', auth.uid(),
        'stake', p_amount,
        'drawn', v_tile,
        'lo', v_lo,
        'hi', v_hi
      ),
      updated_at = now()
    where room_id = p_room_id
    returning * into g;
  end if;

  return g;
end;
$$;

create or replace function public.interval_continue(p_room_id uuid)
returns public.interval_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.interval_games%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli';
  end if;
  if not public.is_room_member(p_room_id) then
    raise exception 'Oda üyesi değilsin';
  end if;

  select * into g from public.interval_games where room_id = p_room_id for update;
  if not found then
    raise exception 'Oyun yok';
  end if;

  if g.phase = 'reveal' then
    return public.interval_advance(p_room_id);
  end if;

  if g.phase = 'hand_end' then
    return public.interval_deal_hand(p_room_id);
  end if;

  raise exception 'Devam edilemez';
end;
$$;

create or replace function public.interval_rematch(p_room_id uuid)
returns public.interval_games
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli';
  end if;
  if not public.is_room_host(p_room_id) then
    raise exception 'Sadece kurucu';
  end if;

  return public.interval_start(p_room_id);
end;
$$;

grant execute on function public.interval_hand_total(uuid) to authenticated;
grant execute on function public.interval_start(uuid) to authenticated;
grant execute on function public.interval_pass(uuid) to authenticated;
grant execute on function public.interval_bet(uuid, int) to authenticated;
grant execute on function public.interval_continue(uuid) to authenticated;
grant execute on function public.interval_rematch(uuid) to authenticated;
