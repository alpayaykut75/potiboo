-- Interval: maç başı ante, sıradaki el herkese açık, 5 sn çekiliş

alter table public.interval_games drop constraint if exists interval_games_phase_check;
alter table public.interval_games
  add constraint interval_games_phase_check
  check (phase in ('match_start', 'turn', 'reveal', 'hand_end', 'match_end'));

alter table public.interval_games
  add column if not exists public_c1 jsonb,
  add column if not exists public_c2 jsonb,
  add column if not exists reveal_at timestamptz;

create or replace function public.interval_publish_turn(p_room_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.interval_hands%rowtype;
begin
  if p_profile_id is null then
    update public.interval_games
    set public_c1 = null, public_c2 = null
    where room_id = p_room_id;
    return;
  end if;

  select * into h
  from public.interval_hands
  where room_id = p_room_id and profile_id = p_profile_id;

  if not found then
    update public.interval_games
    set public_c1 = null, public_c2 = null
    where room_id = p_room_id;
    return;
  end if;

  update public.interval_games
  set public_c1 = h.c1, public_c2 = h.c2
  where room_id = p_room_id;
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
  v_pot_before int;
begin
  select * into g from public.interval_games where room_id = p_room_id for update;
  if not found then
    raise exception 'Oyun yok';
  end if;

  v_pot_before := g.pot;
  v_ante := public.interval_apply_ante(g.banks, g.seats, g.pot);
  g.banks := v_ante->'banks';
  g.pot := (v_ante->>'pot')::int;

  delete from public.interval_hands where room_id = p_room_id;

  perform public.interval_reset_deck(p_room_id);

  v_n := coalesce(array_length(g.seats, 1), 0);
  v_drawn := public.interval_draw_n(p_room_id, v_n * 2);

  update public.interval_secrets
  set discard = '[]'::jsonb, updated_at = now()
  where room_id = p_room_id;

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
    intent_amount = null,
    seen_tiles = '[]'::jsonb,
    reveal_at = null,
    last_event = jsonb_build_object(
      'kind', 'ante',
      'per', 10,
      'from_pot', v_pot_before,
      'to_pot', g.pot,
      'hand', g.hand_index + 1
    ),
    winner_id = null,
    updated_at = now()
  where room_id = p_room_id
  returning * into g;

  perform public.interval_publish_turn(p_room_id, g.turn_profile_id);

  select * into g from public.interval_games where room_id = p_room_id;

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
      intent_amount = null,
      public_c1 = null,
      public_c2 = null,
      reveal_at = null,
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
    intent_amount = null,
    reveal_at = null,
    updated_at = now()
  where room_id = p_room_id
  returning * into g;

  perform public.interval_publish_turn(p_room_id, g.turn_profile_id);
  select * into g from public.interval_games where room_id = p_room_id;
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
  v_seats uuid[];
  v_banks jsonb := '{}'::jsonb;
  v_id uuid;
  v_total int;
  g public.interval_games%rowtype;
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

  perform public.interval_reset_deck(p_room_id);
  delete from public.interval_hands where room_id = p_room_id;

  insert into public.interval_games (
    room_id, seats, banks, pot, phase, turn_profile_id, turn_index,
    hand_index, hand_total, intent_amount, seen_tiles,
    public_c1, public_c2, reveal_at, last_event, winner_id
  ) values (
    p_room_id, v_seats, v_banks, 0, 'match_start', null, 0,
    0, v_total, null, '[]'::jsonb,
    null, null, null, null, null
  )
  on conflict (room_id) do update set
    seats = excluded.seats,
    banks = excluded.banks,
    pot = 0,
    phase = 'match_start',
    turn_profile_id = null,
    turn_index = 0,
    hand_index = 0,
    hand_total = excluded.hand_total,
    intent_amount = null,
    seen_tiles = '[]'::jsonb,
    public_c1 = null,
    public_c2 = null,
    reveal_at = null,
    last_event = null,
    winner_id = null,
    updated_at = now()
  returning * into g;

  update public.rooms
  set status = 'playing', current_round = 0
  where id = p_room_id;

  return g;
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
  v_amount int;
  v_drawn jsonb;
  v_tile jsonb;
  v_val int;
  v_payout int;
  v_pot int;
  v_pot_before int;
  v_banks jsonb;
  v_seen jsonb;
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

  v_amount := coalesce(p_amount, g.intent_amount);
  v_bank := coalesce((g.banks->>auth.uid()::text)::int, 0);
  v_max := least(g.pot, v_bank);
  if v_amount is null or v_amount < 1 or v_amount > v_max then
    raise exception 'Geçersiz miktar';
  end if;

  v_pot_before := g.pot;
  v_drawn := public.interval_draw_n(p_room_id, 1);
  v_tile := v_drawn->0;
  v_val := (v_tile->>'value')::int;

  v_banks := g.banks;
  v_banks := jsonb_set(v_banks, array[auth.uid()::text], to_jsonb(v_bank - v_amount));
  v_pot := g.pot + v_amount;
  v_seen := coalesce(g.seen_tiles, '[]'::jsonb) || jsonb_build_array(v_tile);

  if v_val > v_lo and v_val < v_hi then
    v_payout := v_amount * 2;
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
      intent_amount = null,
      seen_tiles = v_seen,
      reveal_at = now() + interval '5 seconds',
      last_event = jsonb_build_object(
        'kind', 'hit',
        'by', auth.uid(),
        'stake', v_amount,
        'drawn', v_tile,
        'lo', v_lo,
        'hi', v_hi,
        'payout', v_payout,
        'pot_before', v_pot_before,
        'pot_after', v_pot
      ),
      updated_at = now()
    where room_id = p_room_id
    returning * into g;
  else
    update public.interval_games set
      banks = v_banks,
      pot = v_pot,
      phase = 'reveal',
      intent_amount = null,
      seen_tiles = v_seen,
      reveal_at = now() + interval '5 seconds',
      last_event = jsonb_build_object(
        'kind', 'miss',
        'by', auth.uid(),
        'stake', v_amount,
        'drawn', v_tile,
        'lo', v_lo,
        'hi', v_hi,
        'pot_before', v_pot_before,
        'pot_after', v_pot
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

  if g.phase = 'match_start' then
    return public.interval_deal_hand(p_room_id);
  end if;

  if g.phase = 'reveal' then
    if g.reveal_at is not null and g.reveal_at > now() then
      raise exception 'Henüz açılmadı';
    end if;
    return public.interval_advance(p_room_id);
  end if;

  if g.phase = 'hand_end' then
    return public.interval_deal_hand(p_room_id);
  end if;

  raise exception 'Devam edilemez';
end;
$$;
