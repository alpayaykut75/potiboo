-- 1) interval_intend: eşikler dahil (4–5 koyulabilir; sadece aynı sayı pas)
-- 2) Parası biten oyuncu sırayı atlar, masada izler
-- 3) Kimse kalamazsa maç biter

create or replace function public.interval_alive_count(p_banks jsonb, p_seats uuid[])
returns int
language plpgsql
immutable
set search_path = public
as $$
declare
  v_id uuid;
  v_n int := 0;
begin
  if p_seats is null then
    return 0;
  end if;
  foreach v_id in array p_seats loop
    if coalesce((p_banks->>v_id::text)::int, 0) > 0 then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- p_after: 0-based exclusive. -1 ile baştan ara.
create or replace function public.interval_next_alive_index(
  p_banks jsonb,
  p_seats uuid[],
  p_after int
)
returns int
language plpgsql
immutable
set search_path = public
as $$
declare
  i int;
  v_len int;
  v_id uuid;
begin
  v_len := coalesce(array_length(p_seats, 1), 0);
  if v_len < 1 then
    return -1;
  end if;
  for i in (greatest(p_after, -1) + 1)..(v_len - 1) loop
    v_id := p_seats[i + 1];
    if coalesce((p_banks->>v_id::text)::int, 0) > 0 then
      return i;
    end if;
  end loop;
  return -1;
end;
$$;

create or replace function public.interval_intend(p_room_id uuid, p_amount int)
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
  if v_hi = v_lo then
    raise exception 'Aralık yok — sadece pas';
  end if;

  v_bank := coalesce((g.banks->>auth.uid()::text)::int, 0);
  v_max := least(g.pot, v_bank);
  if p_amount is null or p_amount < 1 or p_amount > v_max then
    raise exception 'Geçersiz miktar';
  end if;

  update public.interval_games set
    intent_amount = p_amount,
    last_event = jsonb_build_object(
      'kind', 'intent',
      'by', auth.uid(),
      'amount', p_amount
    ),
    updated_at = now()
  where room_id = p_room_id
  returning * into g;

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
  v_alive int;
  v_first int;
  v_c1 jsonb;
  v_c2 jsonb;
  v_pot_before int;
  v_bank int;
begin
  select * into g from public.interval_games where room_id = p_room_id for update;
  if not found then
    raise exception 'Oyun yok';
  end if;

  if public.interval_alive_count(g.banks, g.seats) < 1 then
    return public.interval_finish_match(p_room_id);
  end if;

  v_pot_before := g.pot;
  v_ante := public.interval_apply_ante(g.banks, g.seats, g.pot);
  g.banks := v_ante->'banks';
  g.pot := (v_ante->>'pot')::int;

  v_alive := public.interval_alive_count(g.banks, g.seats);
  if v_alive < 1 then
    update public.interval_games set
      banks = g.banks,
      pot = g.pot,
      updated_at = now()
    where room_id = p_room_id;
    return public.interval_finish_match(p_room_id);
  end if;

  delete from public.interval_hands where room_id = p_room_id;

  perform public.interval_reset_deck(p_room_id);

  v_drawn := public.interval_draw_n(p_room_id, v_alive * 2);

  update public.interval_secrets
  set discard = '[]'::jsonb, updated_at = now()
  where room_id = p_room_id;

  foreach v_id in array g.seats loop
    v_bank := coalesce((g.banks->>v_id::text)::int, 0);
    if v_bank < 1 then
      continue;
    end if;
    v_c1 := v_drawn->v_i;
    v_c2 := v_drawn->(v_i + 1);
    v_i := v_i + 2;
    insert into public.interval_hands (room_id, profile_id, c1, c2)
    values (p_room_id, v_id, v_c1, v_c2);
  end loop;

  v_first := public.interval_next_alive_index(g.banks, g.seats, -1);

  -- Ante duyurusu: phase=reveal, kurucu Devam → turn
  update public.interval_games set
    banks = g.banks,
    pot = g.pot,
    phase = 'reveal',
    turn_index = greatest(v_first, 0),
    turn_profile_id = case
      when v_first >= 0 then g.seats[v_first + 1]
      else null
    end,
    hand_index = g.hand_index + 1,
    intent_amount = null,
    seen_tiles = '[]'::jsonb,
    reveal_at = now(),
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
begin
  select * into g from public.interval_games where room_id = p_room_id for update;
  if not found then
    raise exception 'Oyun yok';
  end if;

  v_next := public.interval_next_alive_index(g.banks, g.seats, g.turn_index);

  if v_next < 0 then
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
